import cron from 'node-cron';
import { coachingEmailsEnabled } from './pipeline.js';
import { db } from './db.js';
import { sendEmail } from './email.js';

type AgentAnalysis = {
  band: string;
  strengths: { title: string; detail: string }[];
  improvements: { title: string; detail: string }[];
};

type Trend = 'attention' | 'mixed' | 'strong' | 'no-data';

type AgentWeekRow = {
  agent_name: string;
  calls: number;
  trend: Trend;
  topStrength: string | null;
  topOpportunity: string | null;
};

// Same trend-first, no-numbers approach as the in-app daily rollup (src/dailyRollup.ts) —
// this report is meant to point a manager at where to coach, not rank agents by score.
const TREND_RANK: Record<Trend, number> = { attention: 0, mixed: 1, strong: 2, 'no-data': 3 };
const TREND_LABEL: Record<Trend, string> = {
  attention: 'Needs attention',
  mixed: 'Mixed week',
  strong: 'Steady week',
  'no-data': 'No coached calls',
};
const TREND_COLOR: Record<Trend, string> = {
  attention: '#b91c1c',
  mixed: '#92400e',
  strong: '#15803d',
  'no-data': '#999',
};

function mostCommon(items: string[]): string | null {
  if (!items.length) return null;
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function trendFor(analyses: AgentAnalysis[]): Trend {
  if (!analyses.length) return 'no-data';
  const counts = { strong: 0, mixed: 0, attention: 0 };
  for (const a of analyses) {
    if (a.band === 'strong') counts.strong += 1;
    else if (a.band === 'needs-intervention') counts.attention += 1;
    else counts.mixed += 1;
  }
  if (counts.attention > 0 && counts.attention >= analyses.length / 2) return 'attention';
  if (counts.strong >= analyses.length / 2) return 'strong';
  return 'mixed';
}

function buildReportHtml(rows: AgentWeekRow[], weekOf: string): string {
  const body = rows
    .map(
      (r) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${r.agent_name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right">${r.calls}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;color:${TREND_COLOR[r.trend]};font-weight:600">${TREND_LABEL[r.trend]}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;color:#555">${r.topOpportunity ?? '—'}</td>
      </tr>`,
    )
    .join('');

  return `
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
    <h2 style="margin-bottom:0">Weekly coaching report — week of ${weekOf}</h2>
    <p style="color:#555;margin-top:4px">Where to focus coaching this week — not a ranking.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead>
        <tr style="text-align:left">
          <th style="padding:6px 10px;border-bottom:2px solid #333">Agent</th>
          <th style="padding:6px 10px;border-bottom:2px solid #333;text-align:right">Calls coached</th>
          <th style="padding:6px 10px;border-bottom:2px solid #333">This week</th>
          <th style="padding:6px 10px;border-bottom:2px solid #333">Where to focus</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="4" style="padding:10px;color:#999">No calls coached this week.</td></tr>'}</tbody>
    </table>
    <p style="color:#999;font-size:12px;margin-top:20px">Automated weekly summary from the Coaching Workspace.</p>
  </div>`;
}

export async function sendWeeklyReport(): Promise<{ ok: boolean; error?: string }> {
  const managerEmail = process.env.MANAGER_EMAIL;
  if (!managerEmail) return { ok: false, error: 'MANAGER_EMAIL not set' };

  const raw = db
    .prepare(
      `SELECT a.name AS agent_name, c.analysis_json
       FROM calls c
       JOIN agents a ON a.id = c.agent_id
       WHERE c.recorded_at >= datetime('now', '-7 days')
         AND c.analysis_json IS NOT NULL
       ORDER BY a.name`,
    )
    .all() as { agent_name: string; analysis_json: string }[];

  const byAgent = new Map<string, AgentAnalysis[]>();
  for (const row of raw) {
    const analysis = JSON.parse(row.analysis_json) as AgentAnalysis;
    const list = byAgent.get(row.agent_name) ?? [];
    list.push(analysis);
    byAgent.set(row.agent_name, list);
  }

  const rows: AgentWeekRow[] = [...byAgent.entries()]
    .map(([agent_name, analyses]) => ({
      agent_name,
      calls: analyses.length,
      trend: trendFor(analyses),
      topStrength: mostCommon(analyses.flatMap((a) => a.strengths.map((s) => s.title))),
      topOpportunity: mostCommon(analyses.flatMap((a) => a.improvements.map((i) => i.title))),
    }))
    .sort((a, b) => TREND_RANK[a.trend] - TREND_RANK[b.trend]);

  if (!coachingEmailsEnabled()) return { ok: false, error: 'outbound mail is disabled (COACHING_EMAILS_ENABLED)' };

  const weekOf = new Date(Date.now() - 7 * 86400_000).toLocaleDateString();
  const html = buildReportHtml(rows, weekOf);
  return sendEmail({ to: managerEmail, subject: `Weekly coaching report — week of ${weekOf}`, html });
}

/**
 * Every Monday 8am — but only when outbound mail is enabled.
 *
 * This is a second, independent mail path: it goes to MANAGER_EMAIL rather than to agents, so
 * suppressing coaching mail alone would still have sent a named per-agent summary out every
 * Monday. COACHING_EMAILS_ENABLED governs everything this system sends.
 */
export function startWeeklyReportCron() {
  if (!coachingEmailsEnabled()) {
    console.log('[weeklyReport] outbound mail disabled (COACHING_EMAILS_ENABLED) — weekly report will not send.');
    return;
  }

  cron.schedule('0 8 * * 1', () => {
    sendWeeklyReport()
      .then((r) => (r.ok ? console.log('[weeklyReport] sent') : console.warn('[weeklyReport] skipped:', r.error)))
      .catch((e) => console.error('[weeklyReport] failed:', e));
  });
}
