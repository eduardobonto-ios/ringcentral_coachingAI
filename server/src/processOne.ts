// One-off runner for testing the pipeline against a local MP3 before RingCentral access exists.
// Usage: npm run process -- <audio_path> <agent_name> <agent_email> <agent_role> [manual_analysis.json]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { transcribe } from './transcribe.js';
import { analyzeCall, type Analysis, type Turn } from './coaching.js';
import { insertCall, upsertAgent } from './db.js';
import { emailCoaching, type Agent } from './pipeline.js';

async function main() {
  const [audioPathArg, name, email, role, manualAnalysisPath] = process.argv.slice(2);
  if (!audioPathArg) throw new Error('usage: process <audio_path> <agent_name> <agent_email> <agent_role> [manual_analysis.json]');

  const agent: Agent = { id: 'agent-001', name, email, role };
  await upsertAgent(agent);

  const destName = `${Date.now()}-${path.basename(audioPathArg)}`;
  const destPath = path.join(new URL('../audio/', import.meta.url).pathname, destName);
  fs.copyFileSync(audioPathArg, destPath);

  console.log('Transcribing...');
  const raw = await transcribe(destPath);
  console.log(`Got ${raw.segments.length} segments, ${raw.duration.toFixed(1)}s`);

  let turns: Turn[];
  let analysis: Analysis;

  if (manualAnalysisPath) {
    const manual = JSON.parse(fs.readFileSync(manualAnalysisPath, 'utf8'));
    turns = manual.turns;
    analysis = manual.analysis;
  } else {
    console.log('Analyzing via Anthropic API...');
    const result = await analyzeCall({ segments: raw.segments, agentName: name, agentRole: role });
    turns = result.turns;
    analysis = result.analysis;
  }

  const callId = randomUUID();
  await insertCall({
    id: callId,
    recorded_at: new Date().toISOString(),
    duration_sec: Math.round(raw.duration),
    status: 'analyzed',
    source: 'manual-upload',
    direction: 'unknown',
    agent_id: agent.id,
    audio_path: destName,
    engine: 'faster-whisper/small.en',
    transcript_json: turns,
    analysis_json: analysis,
  });

  console.log(`Stored call ${callId}, overall score ${analysis.overallScore}. Sending coaching email to ${email}...`);
  const result = await emailCoaching(callId, agent, new Date().toISOString(), turns, analysis);
  console.log(result.ok ? 'Email sent.' : `Email failed: ${result.error}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
