// Builds the public deployment with the real Welsford call plus 5 synthetic
// demo calls (varied scores) for a fuller-looking call list. Fully static:
// reads committed snapshots and audio, no live backend needed, so this
// builds fine on Vercel's remote servers.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_CALLS, overallScore, bandFor, RUBRIC_VERSION } from './demo-assets/extra-calls-data.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assets = path.join(root, 'scripts', 'demo-assets');

function audioDataUri(mp3Path) {
  return `data:audio/mpeg;base64,${readFileSync(mp3Path).toString('base64')}`;
}

function buildExtraCall(def, manifestEntry) {
  const score = overallScore(def.scores);
  const band = bandFor(score);
  const summary = {
    id: def.id,
    recorded_at: def.recorded_at,
    duration_sec: manifestEntry.duration_sec,
    status: 'analyzed',
    source: 'manual-upload',
    direction: 'inbound',
    agent_name: manifestEntry.agent_name,
    agent_email: def.agent_email,
    agent_role: def.agent_role,
    overall_score: score,
    band,
    outcome: def.outcome,
    flags_json: JSON.stringify(def.flags),
    email_status: 'sent',
    sent_at: def.recorded_at,
    to_email: def.agent_email,
  };

  const analysis = {
    rubricVersion: RUBRIC_VERSION,
    overallScore: score,
    band,
    outcome: def.outcome,
    scores: def.scores,
    strengths: def.strengths,
    improvements: def.improvements,
    practiceAction: def.practiceAction,
    flags: def.flags,
  };

  const detail = {
    id: def.id,
    recorded_at: def.recorded_at,
    duration_sec: manifestEntry.duration_sec,
    direction: summary.direction,
    status: 'analyzed',
    audio_path: `${def.id}.mp3`,
    agent_name: manifestEntry.agent_name,
    agent_email: def.agent_email,
    agent_role: def.agent_role,
    engine: 'whisper-small.en (local, int8) + silero VAD',
    turns: manifestEntry.turns,
    analysis,
    email: { status: 'sent', to: def.agent_email, subject: 'Your coaching notes from this week', sentAt: def.recorded_at },
  };

  const emailHtml = `<!doctype html>
<html>
  <body style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #222;">
    <p>Hi ${manifestEntry.agent_name.split(' ')[0]},</p>
    <p>Quick coaching note from your call on ${new Date(def.recorded_at).toLocaleDateString()}:</p>
    <p><strong>What went well:</strong> ${def.strengths[0].detail}</p>
    <p><strong>Where to improve:</strong> ${def.improvements[0].detail}</p>
    <p><strong>Try this next time:</strong> ${def.improvements[0].say}</p>
    <p>${def.practiceAction}</p>
  </body>
</html>`;

  const audio = audioDataUri(path.join(assets, 'extra-calls', `${def.id}.mp3`));

  return { summary, detail, emailHtml, audio };
}

function main() {
  const realSeed = JSON.parse(readFileSync(path.join(assets, 'real-seed-data.json'), 'utf8'));
  const realCallId = Object.keys(realSeed.details)[0];
  const realAudio = audioDataUri(path.join(assets, 'real-call.mp3'));

  const manifest = JSON.parse(readFileSync(path.join(assets, 'extra-calls', 'manifest.json'), 'utf8'));

  const calls = [...realSeed.calls];
  const details = { ...realSeed.details };
  const emails = { ...realSeed.emails };
  const audio = { [realCallId]: realAudio };

  for (const def of EXTRA_CALLS) {
    const built = buildExtraCall(def, manifest[def.id]);
    calls.push(built.summary);
    details[def.id] = built.detail;
    emails[def.id] = built.emailHtml;
    audio[def.id] = built.audio;
  }

  const seed = { calls, details, rubric: realSeed.rubric, emails, audio };

  console.log(`Baked ${calls.length} calls (1 real + ${EXTRA_CALLS.length} synthetic).`);

  console.log('Running vite build ...');
  execSync('npx vite build', { cwd: root, stdio: 'inherit' });

  const indexPath = path.join(root, 'dist', 'index.html');
  let html = readFileSync(indexPath, 'utf8');
  const seedScript = `<script>window.__SEED__ = ${JSON.stringify(seed)};</script>\n  `;
  if (!html.includes('<script type="module"')) {
    throw new Error('Could not find the module script tag in dist/index.html to inject the seed before.');
  }
  html = html.replace('<script type="module"', `${seedScript}<script type="module"`);
  writeFileSync(indexPath, html);

  console.log(`Full build ready in dist/ (${(html.length / 1024 / 1024).toFixed(1)}MB index.html).`);
}

main();
