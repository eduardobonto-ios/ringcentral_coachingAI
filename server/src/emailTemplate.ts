import type { Analysis, Turn } from './coaching.js';
import { DIMENSIONS } from './rubric.js';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function buildCoachingEmail(opts: {
  agentName: string;
  recordedAt: string;
  turns: Turn[];
  analysis: Analysis;
}): { subject: string; html: string } {
  const { agentName, analysis, turns } = opts;
  const firstName = agentName.split(' ')[0];

  const subject = `Your coaching notes — ${new Date(opts.recordedAt).toLocaleDateString()}`;

  const scoreRows = analysis.scores
    .map((s) => {
      const dim = DIMENSIONS.find((d) => d.key === s.key);
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${dim?.label ?? s.key}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;font-weight:600">${s.score}/5</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;color:#555">${s.rationale}</td>
      </tr>`;
    })
    .join('');

  const strengths = analysis.strengths
    .map((s) => `<li><strong>${s.title}</strong> — ${s.detail}</li>`)
    .join('');

  const improvements = analysis.improvements
    .map(
      (i) => `<li style="margin-bottom:10px">
        <strong>${i.title}</strong> — ${i.detail}<br/>
        <span style="color:#b91c1c">You said:</span> "${i.instead}"<br/>
        <span style="color:#15803d">Try:</span> "${i.say}"
      </li>`,
    )
    .join('');

  const transcript = turns
    .map(
      (t) =>
        `<div style="margin-bottom:6px"><span style="color:#888;font-family:monospace">[${mmss(t.start)}] ${t.speaker}:</span> ${t.text}</div>`,
    )
    .join('');

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
    <h2 style="margin-bottom:0">Hi ${firstName}, here's coaching on your recent call</h2>
    <p style="color:#555;margin-top:4px">A conversation worth revisiting — not a verdict.</p>

    <h3>Keep doing this</h3>
    <ul>${strengths}</ul>

    <h3>One opportunity to try next time</h3>
    <ul style="padding-left:18px">${improvements}</ul>

    <h3>Next shift</h3>
    <p>${analysis.practiceAction}</p>

    <h3>Patterns to notice</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">${scoreRows}</table>

    <h3 style="margin-top:28px">Full transcript</h3>
    <div style="background:#f7f7f7;padding:14px;border-radius:6px;font-size:13px;line-height:1.5">${transcript}</div>

    <p style="color:#999;font-size:12px;margin-top:28px">Automated coaching from the Coaching Workspace, using coaching rubric ${analysis.rubricVersion}.</p>
  </div>`;

  return { subject, html };
}
