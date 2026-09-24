// Builds the public demo deployment: a static bundle with a fully synthetic
// sample call baked in as `window.__SEED__` (src/api.ts reads that instead of
// calling the server when it's present). Unlike build-preview.mjs, this does
// NOT talk to the local coaching API or use any real customer data — the
// transcript, names, and audio (scripts/demo-assets/sample-call.mp3, spoken
// by macOS `say`) are all fictional, so this is safe to commit and to build
// on a remote CI machine with no backend reachable.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const RUBRIC = {
  version: '2026.1',
  dimensions: [
    { key: 'empathy', label: 'Empathy', weight: 25, description: "Acknowledges the customer's frustration or situation before problem-solving; tone matches the moment." },
    { key: 'communication', label: 'Communication', weight: 20, description: 'Clear, jargon-free explanations; confirms understanding; avoids talking over the customer.' },
    { key: 'professionalism', label: 'Professionalism', weight: 15, description: 'Courteous throughout, even under pressure; no defensiveness, sarcasm, or dismissiveness.' },
    { key: 'process', label: 'Process Adherence', weight: 20, description: 'Follows required steps (verification, documentation, escalation path) for the call type.' },
    { key: 'resolution', label: 'Issue Resolution', weight: 20, description: 'Diagnoses the actual concern and either resolves it or sets a clear, correct next step.' },
  ],
};

const CALL_ID = 'demo-0001';

const TURNS = [
  { start: 0, speaker: 'customer', text: "Hi, I'm calling about an order I placed last week. It's a two inch bronze gate valve, and it arrived with a crack in the housing." },
  { start: 8, speaker: 'agent', text: "Okay, what's the order number?" },
  { start: 11, speaker: 'customer', text: "I don't have it in front of me. Can you look it up by my name? It's Casey Nguyen." },
  { start: 16, speaker: 'agent', text: 'Sure, one second. Yeah, I see it. Order shipped Tuesday.' },
  { start: 22, speaker: 'customer', text: "Right, but it arrived broken. I need a replacement fast, we've got a job waiting on this." },
  { start: 28, speaker: 'agent', text: "We can send a replacement, that's not a problem." },
  { start: 32, speaker: 'customer', text: 'Okay. When would that ship?' },
  { start: 34, speaker: 'agent', text: "I'll get it into the queue today, should go out this week." },
  { start: 38, speaker: 'customer', text: 'This week? I really need it sooner than that if possible.' },
  { start: 42, speaker: 'agent', text: "I'll flag it as urgent. That's the best I can do from here." },
  { start: 47, speaker: 'customer', text: "Alright, I guess that'll have to work. Thanks." },
];

// Each dimension score is 0-5, matching the live rubric (server/src/coaching.ts) — same
// convention the CallDetail UI assumes when it renders "score/5" bars.
const SCORES = [
  {
    key: 'empathy', label: 'Empathy', score: 1.75,
    rationale: "Never acknowledges that a cracked part is holding up the customer's job before moving to logistics.",
    evidence: [{ t: 22, quote: "I need a replacement fast, we've got a job waiting on this." }],
  },
  {
    key: 'communication', label: 'Communication', score: 3,
    rationale: "Confirms the order but gives a vague window (\"this week\") instead of a specific date.",
    evidence: [{ t: 34, quote: "I'll get it into the queue today, should go out this week." }],
  },
  {
    key: 'professionalism', label: 'Professionalism', score: 3.75,
    rationale: 'Stays courteous and cooperative throughout, no defensiveness under repeated pushback.',
    evidence: [{ t: 42, quote: "I'll flag it as urgent. That's the best I can do from here." }],
  },
  {
    key: 'process', label: 'Process Adherence', score: 2.75,
    rationale: 'Looks up the order correctly but never confirms shipping address or reads back tracking before ending the call.',
    evidence: [{ t: 16, quote: 'Sure, one second. Yeah, I see it. Order shipped Tuesday.' }],
  },
  {
    key: 'resolution', label: 'Issue Resolution', score: 3,
    rationale: "Agrees to send a replacement but won't commit to an expedited timeline despite being asked twice.",
    evidence: [{ t: 38, quote: 'This week? I really need it sooner than that if possible.' }],
  },
];

const overallScore = Math.round(
  SCORES.reduce((sum, s, i) => sum + (s.score / 5) * RUBRIC.dimensions[i].weight, 0),
);

const ANALYSIS = {
  rubricVersion: RUBRIC.version,
  overallScore,
  band: 'needs-improvement',
  outcome: 'resolved',
  scores: SCORES,
  strengths: [
    { title: 'Stayed calm and cooperative', detail: 'Agreed to send a replacement without pushback or friction, and confirmed the order quickly.' },
  ],
  improvements: [
    {
      title: "Acknowledge the customer's situation first",
      detail: 'The rep moved straight to logistics without validating that a cracked part on a live job is stressful.',
      instead: "\"Okay, what's the order number?\"",
      say: "\"That's frustrating, especially with a job waiting on it. Let's get this fixed for you right away — do you have the order number handy?\"",
    },
    {
      title: 'Give a concrete ship date, not a window',
      detail: '"This week" leaves the customer guessing and having to push twice for urgency.',
      instead: "\"I'll get it into the queue today, should go out this week.\"",
      say: "\"I'm marking this as a rush replacement — it'll ship tomorrow and you'll have tracking by end of day.\"",
    },
  ],
  practiceAction: "On the next call, open with a one-sentence acknowledgement of the customer's situation before asking any lookup questions.",
  flags: ['no urgency acknowledged', 'vague shipping timeline', 'did not confirm shipping address'],
};

const CALL_SUMMARY = {
  id: CALL_ID,
  recorded_at: '2026-09-08T15:30:00.000Z',
  duration_sec: 50,
  status: 'analyzed',
  source: 'manual-upload',
  direction: 'inbound',
  agent_name: 'Jordan Rivera',
  agent_email: 'jordan.rivera@example.com',
  agent_role: 'Customer Service Rep',
  overall_score: overallScore,
  band: ANALYSIS.band,
  outcome: ANALYSIS.outcome,
  flags_json: JSON.stringify(ANALYSIS.flags),
  email_status: 'sent',
  sent_at: '2026-09-08T16:00:00.000Z',
  to_email: 'jordan.rivera@example.com',
};

const CALL_DETAIL = {
  id: CALL_ID,
  recorded_at: CALL_SUMMARY.recorded_at,
  duration_sec: CALL_SUMMARY.duration_sec,
  direction: CALL_SUMMARY.direction,
  status: CALL_SUMMARY.status,
  audio_path: 'sample-call.mp3',
  agent_name: CALL_SUMMARY.agent_name,
  agent_email: CALL_SUMMARY.agent_email,
  agent_role: CALL_SUMMARY.agent_role,
  engine: 'whisper-small.en (local, int8) + silero VAD',
  turns: TURNS,
  analysis: ANALYSIS,
  email: { status: 'sent', to: CALL_SUMMARY.to_email, subject: 'Your coaching notes from this week', sentAt: CALL_SUMMARY.sent_at },
};

const EMAIL_HTML = `<!doctype html>
<html>
  <body style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #222;">
    <p>Hi Jordan,</p>
    <p>Quick coaching note from your call on ${new Date(CALL_SUMMARY.recorded_at).toLocaleDateString()}:</p>
    <p><strong>What went well:</strong> ${ANALYSIS.strengths[0].detail}</p>
    <p><strong>Where to improve:</strong> ${ANALYSIS.improvements[0].detail}</p>
    <p><strong>Try this next time:</strong> ${ANALYSIS.improvements[0].say}</p>
    <p>${ANALYSIS.practiceAction}</p>
  </body>
</html>`;

function main() {
  const audioPath = path.join(root, 'scripts', 'demo-assets', 'sample-call.mp3');
  const audioDataUri = `data:audio/mpeg;base64,${readFileSync(audioPath).toString('base64')}`;

  const seed = {
    calls: [CALL_SUMMARY],
    details: { [CALL_ID]: CALL_DETAIL },
    rubric: RUBRIC,
    emails: { [CALL_ID]: EMAIL_HTML },
    audio: { [CALL_ID]: audioDataUri },
  };

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

  console.log(`Demo build ready in dist/ (${(html.length / 1024 / 1024).toFixed(1)}MB index.html, all data synthetic).`);
}

main();
