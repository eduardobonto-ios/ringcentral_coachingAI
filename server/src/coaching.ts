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

// --- day-level coaching ----------------------------------------------------------------------
//
// One reflection over a day's calls, rather than a tally of per-call feedback.
//
// The per-call analysis answers "how did this call go". An agent making twenty calls a day
// cannot act on twenty of those, and the thing worth acting on is usually the pattern across
// them — which a frequency count over strength titles cannot find, because it can only surface
// a label that already appeared, never the connection between two differently-worded ones.

export type DaySummary = {
  headline: string;
  pattern: string;
  keepDoing: { title: string; detail: string };
  focusOn: { title: string; detail: string };
  practiceAction: string;
};

const DAY_TOOL = {
  name: 'submit_day_coaching',
  description: "Submit one day's coaching for an agent, drawn from that day's individual call analyses.",
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One sentence characterising the day, addressed to the agent.' },
      pattern: {
        type: 'string',
        description: 'The thread running through the day that no single call would show on its own. Say plainly if the calls have little in common.',
      },
      keepDoing: {
        type: 'object',
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
        required: ['title', 'detail'],
      },
      focusOn: {
        type: 'object',
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
        required: ['title', 'detail'],
      },
      practiceAction: { type: 'string', description: 'One concrete thing to practise tomorrow.' },
    },
    required: ['headline', 'pattern', 'keepDoing', 'focusOn', 'practiceAction'],
  },
} as const;

function buildDayPrompt(opts: {
  agentName: string;
  date: string;
  reviewed: number;
  total: number;
  analyses: Analysis[];
}): string {
  const calls = opts.analyses
    .map((a, i) => {
      const strengths = a.strengths.map((s) => `${s.title}: ${s.detail}`).join('; ');
      const improvements = a.improvements.map((m) => `${m.title}: ${m.detail}`).join('; ');
      return `Call ${i + 1} (outcome: ${a.outcome ?? 'unknown'})\n  Went well: ${strengths || 'nothing noted'}\n  Could improve: ${improvements || 'nothing noted'}\n  Suggested practice: ${a.practiceAction}`;
    })
    .join('\n\n');

  // The sample size goes in the prompt because it changes what can honestly be claimed: three
  // calls out of twenty support "in these calls", not "your day".
  return `You are writing one day's coaching for ${opts.agentName} for ${opts.date}.

This is drawn from ${opts.reviewed} reviewed call${opts.reviewed === 1 ? '' : 's'} out of ${opts.total} they took that day. Do not describe the whole day with more confidence than that sample supports — with a small sample, say what these calls showed rather than what the day was like.

Per-call analyses:

${calls}

Write one reflection for the day, not a list of per-call notes. Look for what connects the calls: a habit that repeats, a situation handled well once and poorly another time, something that only becomes visible across several conversations. If the calls genuinely have nothing in common, say so rather than inventing a theme.

Address ${opts.agentName} directly. This is read by them, so be specific and candid about what to change without being contemptuous. No scores, no grades, no ranking — this is a conversation about the work, not a verdict on it.`;
}

async function runDayAnthropic(prompt: string): Promise<any> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_COACHING_MODEL || 'claude-sonnet-5',
    max_tokens: 2048,
    tools: [DAY_TOOL],
    tool_choice: { type: 'tool', name: 'submit_day_coaching' },
    messages: [{ role: 'user', content: prompt }],
  });
  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return a day summary.');
  return toolUse.input;
}

async function runDayOpenAI(prompt: string): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_COACHING_MODEL || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      tools: [
        {
          type: 'function',
          function: { name: DAY_TOOL.name, description: DAY_TOOL.description, parameters: DAY_TOOL.input_schema },
        },
      ],
      tool_choice: { type: 'function', function: { name: DAY_TOOL.name } },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI day coaching ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error('Model did not return a day summary.');

  try {
    return JSON.parse(call.function.arguments);
  } catch {
    throw new Error('Model returned malformed JSON for the day summary.');
  }
}

/** One model call over a day's analyses. Cheap next to transcription — it reads summaries, not audio. */
export async function synthesizeDay(opts: {
  agentName: string;
  date: string;
  reviewed: number;
  total: number;
  analyses: Analysis[];
}): Promise<DaySummary> {
  if (opts.analyses.length === 0) throw new Error('No analysed calls to summarise for this day.');

  const provider = chosenProvider();
  const prompt = buildDayPrompt(opts);
  const result = provider === 'anthropic' ? await runDayAnthropic(prompt) : await runDayOpenAI(prompt);

  return {
    headline: result.headline,
    pattern: result.pattern,
    keepDoing: result.keepDoing,
    focusOn: result.focusOn,
    practiceAction: result.practiceAction,
  };
}
