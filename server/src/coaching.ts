import Anthropic from '@anthropic-ai/sdk';
import { DIMENSIONS, RUBRIC_VERSION, bandFor } from './rubric.js';
import type { RawSegment } from './transcribe.js';

export type Turn = { start: number; speaker: 'agent' | 'customer' | 'system'; text: string };
export type Score = { key: string; label: string; score: number; rationale: string; evidence: { t: number; quote: string }[] };
export type Analysis = {
  rubricVersion: string;
  overallScore: number;
  band: string;
  outcome: string | null;
  scores: Score[];
  strengths: { title: string; detail: string }[];
  improvements: { title: string; detail: string; instead: string; say: string }[];
  practiceAction: string;
  flags: string[];
};

const ANALYSIS_TOOL = {
  name: 'submit_call_analysis',
  description: 'Submit the labeled transcript turns and the coaching analysis for this call.',
  input_schema: {
    type: 'object',
    properties: {
      turns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            start: { type: 'number' },
            speaker: { type: 'string', enum: ['agent', 'customer', 'system'] },
            text: { type: 'string' },
          },
          required: ['start', 'speaker', 'text'],
        },
      },
      outcome: { type: 'string', description: 'e.g. resolved, escalated, unresolved, follow-up-scheduled' },
      scores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            score: { type: 'number', description: '0-5 (whole or half points)' },
            rationale: { type: 'string' },
            evidence: {
              type: 'array',
              items: { type: 'object', properties: { t: { type: 'number' }, quote: { type: 'string' } }, required: ['t', 'quote'] },
            },
          },
          required: ['key', 'score', 'rationale', 'evidence'],
        },
      },
      strengths: {
        type: 'array',
        items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] },
      },
      improvements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
            instead: { type: 'string', description: 'What the agent said/did' },
            say: { type: 'string', description: 'A better line the agent could use next time' },
          },
          required: ['title', 'detail', 'instead', 'say'],
        },
      },
      practiceAction: { type: 'string', description: 'One concrete thing to practice before the next call' },
      flags: { type: 'array', items: { type: 'string' } },
    },
    required: ['turns', 'outcome', 'scores', 'strengths', 'improvements', 'practiceAction', 'flags'],
  },
} as const;

/**
 * Which model writes the coaching.
 *
 * Anthropic is preferred — the rubric prompt and the submit_call_analysis tool were written
 * and tuned against Claude's tool use. OpenAI is supported so the pipeline can run on the
 * transcription key that is already configured, without standing up separate API billing
 * (a Claude Pro/Max/Team subscription grants no API credits).
 *
 * Set COACHING_PROVIDER to force one; otherwise whichever key is present wins, Anthropic first.
 */
function chosenProvider(): 'anthropic' | 'openai' {
  const forced = process.env.COACHING_PROVIDER;
  if (forced === 'anthropic' || forced === 'openai') return forced;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  throw new Error('No coaching model configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
}

function buildPrompt(opts: { segments: RawSegment[]; agentName: string; agentRole: string }): string {
  const transcriptText = opts.segments.map((s) => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n');
  const rubricText = DIMENSIONS.map((d) => `- ${d.key} (${d.label}, weight ${d.weight}): ${d.description}`).join('\n');

  return `You are grading a customer service call for ${opts.agentName} (role: ${opts.agentRole}) against this protocol:\n${rubricText}\n\nThe raw transcript below has no speaker labels — infer who is the agent and who is the customer from context (greeting, hold/verification steps, apologizing on behalf of the company, etc.), and split/merge segments into clean turns.\n\nRaw transcript (one segment per line, with start time):\n${transcriptText}\n\nFor each rubric dimension, give a 0-5 score (5 = excellent) with a rationale and at least one timestamped quote as evidence. Then give strengths, improvements (each with what was said vs. a better line), one concrete practice action, and any flags (e.g. "no verification step", "raised voice", "missed opportunity to resolve").\n\nRefer to the agent as ${opts.agentName} and by no other name. Names spoken during the call may belong to the customer, a colleague, or a transcription error — never use one of those to address the agent. This feedback is sent to the agent directly, so write it to be read by them: specific and candid about what to change, but never mocking or contemptuous.`;
}

async function runAnthropic(prompt: string): Promise<any> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_COACHING_MODEL || 'claude-sonnet-5',
    max_tokens: 4096,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: 'submit_call_analysis' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return structured analysis.');
  return toolUse.input;
}

/** Same schema via OpenAI function calling. Raw fetch, matching transcribe.ts — no SDK needed. */
async function runOpenAI(prompt: string): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_COACHING_MODEL || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      tools: [
        {
          type: 'function',
          function: {
            name: ANALYSIS_TOOL.name,
            description: ANALYSIS_TOOL.description,
            parameters: ANALYSIS_TOOL.input_schema,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: ANALYSIS_TOOL.name } },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI coaching ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error('Model did not return structured analysis.');

  try {
    return JSON.parse(call.function.arguments);
  } catch {
    throw new Error('Model returned malformed JSON for the analysis.');
  }
}

export async function analyzeCall(opts: {
  segments: RawSegment[];
  agentName: string;
  agentRole: string;
}): Promise<{ turns: Turn[]; analysis: Analysis }> {
  const provider = chosenProvider();
  const prompt = buildPrompt(opts);
  const result = provider === 'anthropic' ? await runAnthropic(prompt) : await runOpenAI(prompt);

  // Each score is 0-5; weights sum to 100, so (score/5)*weight rolls up to a 0-100 overall.
  const overallScore = Math.round(
    result.scores.reduce((sum: number, s: any) => {
      const dim = DIMENSIONS.find((d) => d.key === s.key);
      return sum + (dim ? (s.score / 5) * dim.weight : 0);
    }, 0),
  );

  const scores: Score[] = result.scores.map((s: any) => ({
    ...s,
    label: DIMENSIONS.find((d) => d.key === s.key)?.label ?? s.key,
  }));

  return {
    turns: result.turns,
    analysis: {
      rubricVersion: RUBRIC_VERSION,
      overallScore,
      band: bandFor(overallScore),
      outcome: result.outcome ?? null,
      scores,
      strengths: result.strengths,
      improvements: result.improvements,
      practiceAction: result.practiceAction,
      flags: result.flags,
    },
  };
}
