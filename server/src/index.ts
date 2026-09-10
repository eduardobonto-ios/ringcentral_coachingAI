import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCallSummaries, getCallDetail, getEmailBody } from './db.js';
import { DIMENSIONS, RUBRIC_VERSION } from './rubric.js';
import { processRecording, type Agent } from './pipeline.js';
import { startWeeklyReportCron } from './weeklyReport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, '..', 'audio');

const app = express();
const upload = multer({ dest: AUDIO_DIR });

app.use('/audio', express.static(AUDIO_DIR));

app.get('/api/calls', (_req, res) => {
  res.json({ calls: listCallSummaries() });
});

app.get('/api/rubric', (_req, res) => {
  res.json({ version: RUBRIC_VERSION, dimensions: DIMENSIONS });
});

app.get('/api/calls/:id', (req, res) => {
  const row = getCallDetail(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'not found' });
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

app.get('/api/calls/:id/email', (req, res) => {
  const row = getEmailBody(req.params.id);
  if (!row) return res.status(404).send('No email for this call yet.');
  res.type('html').send(row.body_html);
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
