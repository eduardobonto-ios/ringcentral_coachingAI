import cron from 'node-cron';
import { db } from './db.js';
import { sendEmail } from './email.js';

type AgentWeekRow = {
  agent_name: string;
  calls: number;
  avg_score: number | null;
  min_score: number | null;
  flagged: number;
};

function buildReportHtml(rows: AgentWeekRow[], weekOf: string): string {
  const body = rows
    .map(
      (r) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${r.agent_name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right">${r.calls}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right">${r.avg_score ?? '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;color:${(r.flagged ?? 0) > 0 ? '#b91c1c' : '#555'}">${r.flagged}</td>
      </tr>`,
    )
    .join('');

  return `
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
    <h2>Weekly coaching report — week of ${weekOf}</h2>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead>
        <tr style="text-align:left">
          <th style="padding:6px 10px;border-bottom:2px solid #333">Agent</th>
          <th style="padding:6px 10px;border-bottom:2px solid #333;text-align:right">Calls reviewed</th>
          <th style="padding:6px 10px;border-bottom:2px solid #333;text-align:right">Avg score</th>
          <th style="padding:6px 10px;border-bottom:2px solid #333;text-align:right">Needs intervention</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="4" style="padding:10px;color:#999">No calls reviewed this week.</td></tr>'}</tbody>
    </table>
    <p style="color:#999;font-size:12px;margin-top:20px">Automated weekly summary from the Call Monitoring & Coaching System.</p>
  </div>`;
}

export async function sendWeeklyReport(): Promise<{ ok: boolean; error?: string }> {
  const managerEmail = process.env.MANAGER_EMAIL;
  if (!managerEmail) return { ok: false, error: 'MANAGER_EMAIL not set' };

  const rows = db
    .prepare(
      `SELECT
        a.name AS agent_name,
        COUNT(*) AS calls,
        ROUND(AVG(json_extract(c.analysis_json, '$.overallScore'))) AS avg_score,
        MIN(json_extract(c.analysis_json, '$.overallScore')) AS min_score,
        SUM(CASE WHEN json_extract(c.analysis_json, '$.overallScore') < 40 THEN 1 ELSE 0 END) AS flagged
      FROM calls c
      JOIN agents a ON a.id = c.agent_id
      WHERE c.recorded_at >= datetime('now', '-7 days')
        AND c.analysis_json IS NOT NULL
      GROUP BY a.id
      ORDER BY avg_score ASC`,
    )
    .all() as AgentWeekRow[];

  const weekOf = new Date(Date.now() - 7 * 86400_000).toLocaleDateString();
  const html = buildReportHtml(rows, weekOf);
  return sendEmail({ to: managerEmail, subject: `Weekly coaching report — week of ${weekOf}`, html });
}

/** Every Monday 8am. Reused as-is once RingCentral feeds real weekly volume. */
export function startWeeklyReportCron() {
  cron.schedule('0 8 * * 1', () => {
    sendWeeklyReport()
      .then((r) => (r.ok ? console.log('[weeklyReport] sent') : console.warn('[weeklyReport] skipped:', r.error)))
      .catch((e) => console.error('[weeklyReport] failed:', e));
  });
}
