import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new Database(path.join(__dirname, '..', 'data', 'coaching.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    recorded_at TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    status TEXT NOT NULL,             -- uploaded | transcribed | needs-analysis | analyzed
    source TEXT NOT NULL,             -- manual-upload | ringcentral
    direction TEXT NOT NULL,          -- inbound | outbound | unknown
    agent_id TEXT NOT NULL REFERENCES agents(id),
    audio_path TEXT NOT NULL,
    engine TEXT,                      -- transcription engine used
    transcript_json TEXT,             -- Turn[]
    analysis_json TEXT,               -- CallDetail['analysis']
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS emails (
    call_id TEXT PRIMARY KEY REFERENCES calls(id),
    status TEXT NOT NULL,             -- sent | dry-run | failed
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    sent_at TEXT,
    error TEXT
  );
`);

export function upsertAgent(agent: { id: string; name: string; email: string; role: string }) {
  db.prepare(
    `INSERT INTO agents (id, name, email, role) VALUES (@id, @name, @email, @role)
     ON CONFLICT(id) DO UPDATE SET name=@name, email=@email, role=@role`,
  ).run(agent);
}

export const listCallSummaries = () =>
  db
    .prepare(
      `SELECT
        c.id, c.recorded_at, c.duration_sec, c.status, c.source, c.direction,
        a.name AS agent_name, a.email AS agent_email, a.role AS agent_role,
        json_extract(c.analysis_json, '$.overallScore') AS overall_score,
        json_extract(c.analysis_json, '$.band') AS band,
        json_extract(c.analysis_json, '$.outcome') AS outcome,
        json_extract(c.analysis_json, '$.flags') AS flags_json,
        e.status AS email_status, e.sent_at, e.to_email
      FROM calls c
      JOIN agents a ON a.id = c.agent_id
      LEFT JOIN emails e ON e.call_id = c.id
      ORDER BY c.recorded_at DESC`,
    )
    .all();

export const getCallDetail = (id: string) =>
  db
    .prepare(
      `SELECT
        c.id, c.recorded_at, c.duration_sec, c.status, c.audio_path, c.engine,
        c.transcript_json, c.analysis_json,
        a.name AS agent_name, a.email AS agent_email, a.role AS agent_role,
        e.status AS email_status, e.to_email, e.subject AS email_subject, e.sent_at AS email_sent_at
      FROM calls c
      JOIN agents a ON a.id = c.agent_id
      LEFT JOIN emails e ON e.call_id = c.id
      WHERE c.id = ?`,
    )
    .get(id);

export const getEmailBody = (callId: string) =>
  db.prepare(`SELECT body_html FROM emails WHERE call_id = ?`).get(callId) as { body_html: string } | undefined;

export function insertCall(row: {
  id: string;
  recorded_at: string;
  duration_sec: number;
  status: string;
  source: string;
  direction: string;
  agent_id: string;
  audio_path: string;
  engine: string | null;
  transcript_json: string | null;
  analysis_json: string | null;
}) {
  db.prepare(
    `INSERT INTO calls (id, recorded_at, duration_sec, status, source, direction, agent_id, audio_path, engine, transcript_json, analysis_json, created_at)
     VALUES (@id, @recorded_at, @duration_sec, @status, @source, @direction, @agent_id, @audio_path, @engine, @transcript_json, @analysis_json, @created_at)`,
  ).run({ ...row, created_at: new Date().toISOString() });
}

export function updateCallAnalysis(id: string, analysisJson: string, status: string) {
  db.prepare(`UPDATE calls SET analysis_json = ?, status = ? WHERE id = ?`).run(analysisJson, status, id);
}

export function upsertEmail(row: {
  call_id: string;
  status: string;
  to_email: string;
  subject: string;
  body_html: string;
  sent_at: string | null;
  error?: string | null;
}) {
  db.prepare(
    `INSERT INTO emails (call_id, status, to_email, subject, body_html, sent_at, error)
     VALUES (@call_id, @status, @to_email, @subject, @body_html, @sent_at, @error)
     ON CONFLICT(call_id) DO UPDATE SET status=@status, to_email=@to_email, subject=@subject, body_html=@body_html, sent_at=@sent_at, error=@error`,
  ).run({ error: null, ...row });
}
