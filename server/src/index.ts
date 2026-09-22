import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listCallSummaries, getCallDetail, getEmailBody, updateCallAnalysis } from './db.js';
import { DIMENSIONS, RUBRIC_VERSION } from './rubric.js';
import { processRecording, emailCoaching, coachingEmailsEnabled, type Agent } from './pipeline.js';
import { analyzeCall } from './coaching.js';
import { startWeeklyReportCron } from './weeklyReport.js';
import { startRingCentralSyncCron } from './ringcentralSync.js';
import { listCallsForDay, coachOneCall } from './ringcentralOnDemand.js';
import { requireAuth, canAccessAgentEmail, departmentByEmail } from './auth.js';
import { signedRecordingUrl } from './storage.js';

// Uploads are staged here only until they reach Supabase Storage.
const AUDIO_DIR = path.join(os.tmpdir(), 'coaching-audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const app = express();
const upload = multer({ dest: AUDIO_DIR });

/**
 * CORS, for deployments where the API is not same-origin with the frontend.
 *
 * Not needed on Vercel, where api/index.ts serves this app under the same domain, nor locally
 * behind Vite's proxy — in both, CORS_ORIGINS stays empty and nothing here applies. It exists
 * for a split deployment: the container in server/Dockerfile, or Azure later.
 *
 * Hand-rolled rather than pulling in `cors`: it is an allowlist and a preflight, and the list
 * should stay explicit and visible, because these routes serve recordings of real customer
 * conversations and a reflected-origin wildcard would be wrong.
 */
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin.replace(/\/$/, ''))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && allowedOrigins.length ? 204 : 403);
  next();
});

// Lets a host (Railway, Render, Azure Container Apps) confirm the process is up without
// authenticating. Deliberately reveals nothing about the data.
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api', express.json());
app.use('/api', requireAuth);

app.get('/api/calls', async (req, res) => {
  const all = (await listCallSummaries()) as any[];
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
  const row = (await getCallDetail(req.params.id)) as any;
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!(await canAccessAgentEmail(req.user!, row.agent_email))) return res.status(403).json({ error: 'forbidden' });
  res.json({
    id: row.id,
    recorded_at: row.recorded_at,
    duration_sec: row.duration_sec,
    status: row.status,
    audio_path: row.audio_path,
    audio_url: await signedRecordingUrl(row.audio_path),
    agent_name: row.agent_name,
    agent_email: row.agent_email,
    agent_role: row.agent_role,
    engine: row.engine,
    turns: row.transcript_json ?? [],
    analysis: row.analysis_json ?? null,
    email: row.email_status
      ? { status: row.email_status, to: row.to_email, subject: row.email_subject, sentAt: row.email_sent_at }
      : null,
  });
});

app.get('/api/calls/:id/email', async (req, res) => {
  const call = (await getCallDetail(req.params.id)) as any;
  if (!call) return res.status(404).send('No email for this call yet.');
  if (!(await canAccessAgentEmail(req.user!, call.agent_email))) return res.status(403).send('forbidden');
  const row = await getEmailBody(req.params.id);
  if (!row) return res.status(404).send('No email for this call yet.');
  res.type('html').send(row.body_html);
});

// On-demand coaching: run AI analysis for a call that was transcribed but never scored
// (e.g. ANTHROPIC_API_KEY was unset at ingestion, or auto-analysis was deliberately skipped).
// This is what "Coach me on this call" calls when a call has no analysis yet.
app.post('/api/calls/:id/analyze', async (req, res) => {
  try {
    const row = (await getCallDetail(req.params.id)) as any;
    if (!row) return res.status(404).send('not found');
    if (!(await canAccessAgentEmail(req.user!, row.agent_email))) return res.status(403).send('forbidden');
    if (row.analysis_json) return res.json({ status: 'already-analyzed' });
    if (!row.transcript_json) return res.status(409).send('No transcript available yet for this call.');

    const rawTurns = row.transcript_json as { start: number; text: string }[];
    const segments = rawTurns.map((t) => ({ start: t.start, end: t.start, text: t.text }));

    const { turns, analysis } = await analyzeCall({
      segments,
      agentName: row.agent_name,
      agentRole: row.agent_role,
    });

    await updateCallAnalysis(req.params.id, turns, analysis, 'analyzed');

    // Only mail an agent coaching they asked for themselves. An admin or manager reading
    // someone else's call is reviewing it, not requesting feedback on their behalf — and this
    // route is reachable from the call list, so the old unconditional send meant browsing
    // somebody's call could put an AI critique in their inbox.
    const selfRequested = req.user!.email === row.agent_email;
    if (selfRequested && coachingEmailsEnabled()) {
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
    }

    res.json({ status: 'analyzed' });
  } catch (e) {
    console.error(e);
    res.status(500).send(String((e as Error).message));
  }
});

// --- on-demand coaching ------------------------------------------------------------------
//
// Listing costs one call-log read and downloads nothing, so browsing a day is free and instant.
// Coaching one call is the only thing that spends money, and the agent chooses when.

app.get('/api/ringcentral/calls', async (req, res) => {
  try {
    const date = String(req.query.date ?? '');
    const calls = await listCallsForDay({
      date,
      email: req.user!.email,
      isAdmin: req.user!.role === 'admin',
    });
    res.json({ date, calls });
  } catch (e) {
    const message = (e as Error).message;
    // A bad date is the caller's fault; anything else is ours or RingCentral's.
    res.status(/^Invalid date/.test(message) ? 400 : 500).json({ error: message });
  }
});

app.post('/api/ringcentral/coach', async (req, res) => {
  try {
    const { date, recordingId } = req.body ?? {};
    if (!date || !recordingId) return res.status(400).json({ error: 'date and recordingId are required' });

    const result = await coachOneCall({
      date: String(date),
      recordingId: String(recordingId),
      email: req.user!.email,
      isAdmin: req.user!.role === 'admin',
    });
    res.json(result);
  } catch (e) {
    const message = (e as Error).message;
    res.status(/not available to coach/.test(message) ? 403 : 500).json({ error: message });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'file is required' });

    // Manual upload always attributes the call to whoever is signed in and uploading it — there's
    // no agent picker yet, so uploading on someone else's behalf isn't supported.
    const agent: Agent = {
      id: req.user!.id,
      name: req.user!.fullName || req.user!.email,
      email: req.user!.email,
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

// Exported so the app can be mounted by a host — a serverless handler, a container, or the
// block below. Importing this module must not bind a port or start timers: on serverless every
// invocation would re-register the crons, and node-cron timers do not survive a frozen function
// anyway.
export { app };

/**
 * Only when run directly (npm run dev / npm start), never when imported.
 *
 * The crons live here rather than at module scope for the same reason: a long-running host is
 * the only place they can actually fire. The nightly RingCentral sync takes 30-45 minutes for a
 * full day of calls, well past any serverless timeout, so it needs a persistent process.
 */
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const port = Number(process.env.PORT) || 8787;
  app.listen(port, () => {
    console.log(`coaching-api listening on http://localhost:${port}`);
    startWeeklyReportCron();
    // Off by default: coaching is requested per call now, so the nightly batch would transcribe
    // calls nobody asked about. Kept for backfilling a range (npm run rc:sync), and switchable
    // back on with RC_NIGHTLY_SYNC=true for a host that can run for 30-45 minutes.
    if (process.env.RC_NIGHTLY_SYNC === 'true') startRingCentralSyncCron();
    else console.log('[rc-sync] nightly batch disabled — coaching is on-demand (RC_NIGHTLY_SYNC=true to re-enable).');
  });
}
