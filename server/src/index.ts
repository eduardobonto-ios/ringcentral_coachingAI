import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCallSummaries, getCallDetail, getEmailBody, updateCallAnalysis } from './db.js';
import { DIMENSIONS, RUBRIC_VERSION } from './rubric.js';
import { processRecording, emailCoaching, type Agent } from './pipeline.js';
import { analyzeCall } from './coaching.js';
import { startWeeklyReportCron } from './weeklyReport.js';
import { requireAuth, canAccessAgentEmail, departmentByEmail } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, '..', 'audio');

const app = express();
const upload = multer({ dest: AUDIO_DIR });

// NOTE: recordings are served unauthenticated — the audio player streams straight from here.
// Locking this down too needs range-request-aware auth (or signed URLs), which is a follow-up.
app.use('/audio', express.static(AUDIO_DIR));

app.use('/api', requireAuth);

app.get('/api/calls', async (req, res) => {
  const all = listCallSummaries() as any[];
  const user = req.user!;
  if (user.role === 'admin') return res.json({ calls: all });
  if (user.position === 'manager') {
    const depts = await departmentByEmail();
    return res.json({ calls: all.filter((c) => user.department !== null && depts[c.agent_email] === user.department) });
  }
  res.json({ calls: all.filter((c) => c.agent_email === user.email) });
});

app.get('/api/rubric', (_req, res) => {
  res.json({ version: RUBRIC_VERSION, dimensions: DIMENSIONS });
});

app.get('/api/calls/:id', async (req, res) => {
  const row = getCallDetail(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!(await canAccessAgentEmail(req.user!, row.agent_email))) return res.status(403).json({ error: 'forbidden' });
  res.json({
    id: row.id,
    recorded_at: row.recorded_at,
    duration_sec: row.duration_sec,
    status: row.status,
    audio_path: row.audio_path,
    agent_name: row.agent_name,
    agent_email: row.agent_email,
    agent_role: row.agent_role,
    engine: row.engine,
    turns: row.transcript_json ? JSON.parse(row.transcript_json) : [],
    analysis: row.analysis_json ? JSON.parse(row.analysis_json) : null,
    email: row.email_status
      ? { status: row.email_status, to: row.to_email, subject: row.email_subject, sentAt: row.email_sent_at }
      : null,
  });
});

app.get('/api/calls/:id/email', async (req, res) => {
  const call = getCallDetail(req.params.id) as any;
  if (!call) return res.status(404).send('No email for this call yet.');
  if (!(await canAccessAgentEmail(req.user!, call.agent_email))) return res.status(403).send('forbidden');
  const row = getEmailBody(req.params.id);
  if (!row) return res.status(404).send('No email for this call yet.');
  res.type('html').send(row.body_html);
});

// On-demand coaching: run AI analysis for a call that was transcribed but never scored
// (e.g. ANTHROPIC_API_KEY was unset at ingestion, or auto-analysis was deliberately skipped).
// This is what "Coach me on this call" calls when a call has no analysis yet.
app.post('/api/calls/:id/analyze', async (req, res) => {
  try {
    const row = getCallDetail(req.params.id) as any;
    if (!row) return res.status(404).send('not found');
    if (!(await canAccessAgentEmail(req.user!, row.agent_email))) return res.status(403).send('forbidden');
    if (row.analysis_json) return res.json({ status: 'already-analyzed' });
    if (!row.transcript_json) return res.status(409).send('No transcript available yet for this call.');

    const rawTurns = JSON.parse(row.transcript_json) as { start: number; text: string }[];
    const segments = rawTurns.map((t) => ({ start: t.start, end: t.start, text: t.text }));

    const { turns, analysis } = await analyzeCall({
      segments,
      agentName: row.agent_name,
      agentRole: row.agent_role,
    });

    updateCallAnalysis(req.params.id, JSON.stringify(turns), JSON.stringify(analysis), 'analyzed');

    try {
      await emailCoaching(
        req.params.id,
        { id: '', name: row.agent_name, email: row.agent_email, role: row.agent_role },
        row.recorded_at,
        turns,
        analysis,
      );
    } catch (e) {
      console.warn(`[analyze] coaching email failed for ${req.params.id}: ${(e as Error).message}`);
    }

    res.json({ status: 'analyzed' });
  } catch (e) {
    console.error(e);
    res.status(500).send(String((e as Error).message));
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const agentId = req.body.agentId as string;
    if (!file) return res.status(400).json({ error: 'file is required' });

    // TODO: replace with a real agent directory lookup once one exists.
    const agent: Agent = {
      id: agentId || 'agent-001',
      name: 'Sample Agent',
      email: process.env.MANAGER_EMAIL || 'agent@example.com',
      role: 'Customer Service Rep',
    };

    const { callId } = await processRecording({
      audioPath: file.path,
      audioFilename: file.filename,
      recordedAt: new Date().toISOString(),
      source: 'manual-upload',
      direction: 'unknown',
      agent,
    });
    res.json({ callId });
  } catch (e) {
    console.error(e);
    res.status(500).send(String((e as Error).message));
  }
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`coaching-api listening on http://localhost:${port}`);
  startWeeklyReportCron();
});
