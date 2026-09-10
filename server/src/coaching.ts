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

export async function analyzeCall(opts: {
  segments: RawSegment[];
  agentName: string;
  agentRole: string;
}): Promise<{ turns: Turn[]; analysis: Analysis }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — cannot run automatic AI coaching.');

  const client = new Anthropic({ apiKey });
  const transcriptText = opts.segments.map((s) => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n');

  const rubricText = DIMENSIONS.map((d) => `- ${d.key} (${d.label}, weight ${d.weight}): ${d.description}`).join('\n');

  const msg = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: 'submit_call_analysis' },
    messages: [
      {
        role: 'user',
        content: `You are grading a customer service call for ${opts.agentName} (role: ${opts.agentRole}) against this protocol:\n${rubricText}\n\nThe raw transcript below has no speaker labels — infer who is the agent and who is the customer from context (greeting, hold/verification steps, apologizing on behalf of the company, etc.), and split/merge segments into clean turns.\n\nRaw transcript (one segment per line, with start time):\n${transcriptText}\n\nFor each rubric dimension, give a 0-5 score (5 = excellent) with a rationale and at least one timestamped quote as evidence. Then give strengths, improvements (each with what was said vs. a better line), one concrete practice action, and any flags (e.g. "no verification step", "raised voice", "missed opportunity to resolve").`,
      },
    ],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return structured analysis.');
  const result = toolUse.input as any;

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
