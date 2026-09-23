// Coaching for a day, rather than for a call.
//
// The per-call path answers "how did this call go". That is useful, and it stays. But an agent
// taking twenty calls a day cannot act on twenty pieces of feedback, and what is worth acting on
// is usually the thread across them — so the day is the unit this tool is really about.
//
// Two things were missing. There was no way to coach a day without clicking every call in it, and
// the "daily" view was a frequency count over whatever calls happened to be coached, computed in
// the browser (src/dailyRollup.ts). With one coached call out of twenty-two, the most common
// strength is just that call's strength.
//
// This module coaches a SAMPLE and says so. Coaching a whole day means transcribing every call in
// it, which is the nightly batch we deliberately removed: ~12 minutes and ~$0.70 per agent per
// day, past any serverless timeout. A handful of calls spread across the day costs a fraction of
// that and is enough to see a habit repeat — as long as the summary is honest about how much it
// looked at, which is why calls_reviewed travels with it everywhere.
import { listCallsForDay, coachOneCall, type CallOption } from './ringcentralOnDemand.js';
import { synthesizeDay, type DaySummary } from './coaching.js';
import { listDayAnalyses, listDayIndex, upsertDaySummary, getDaySummary } from './db.js';
import { dayWindow } from './manilaDay.js';

/** Calls coached in one "coach my day" run. Five is a sample; twenty-two is the nightly batch. */
export const DAY_SAMPLE_SIZE = 5;

/**
 * Stop starting new calls after this much of the request is gone.
 *
 * Vercel allows 300s (vercel.json). A call takes roughly 35s but a long one takes more, so
 * starting a fifth call at 250s risks losing the summary along with it. Whatever finished by then
 * is summarised and returned — a partial day is a fine result, a timeout is not.
 */
const START_DEADLINE_MS = 200_000;

export type DayCoachingResult = {
  date: string;
  summary: DaySummary | null;
  callsReviewed: number;
  callsTotal: number;
  newlyCoached: number;
  /** True when the day holds more uncoached calls than this run took. */
  moreAvailable: boolean;
  errors: string[];
};

/**
 * Spread `limit` picks across `options`, first and last included.
 *
 * Taking the first five would describe the start of a shift and call it a day. The point of a day
 * summary is the arc — a habit that shows up in the morning and again at five, or a tone that
 * drifts after lunch — and only a spread sample can show that.
 */
export function spreadSample<T>(options: T[], limit: number): T[] {
  if (options.length <= limit) return [...options];
  if (limit <= 0) return [];
  if (limit === 1) return [options[0]];

  const picked: T[] = [];
  for (let i = 0; i < limit; i++) {
    picked.push(options[Math.round((i * (options.length - 1)) / (limit - 1))]);
  }
  return picked;
}

/** The coachable total for one agent's day, as the call-log index recorded it. */
async function coachableTotal(date: string, email: string): Promise<number> {
  const rows = await listDayIndex(date, date);
  return rows
    .filter((r) => r.agent_email.toLowerCase() === email.toLowerCase())
    .reduce((n, r) => n + r.coachable_count, 0);
}

/**
 * Regenerate and store the summary for a day from whatever is already analysed.
 *
 * Separate from coaching so it can run on its own: coaching more calls later should update the
 * day's picture without re-reading anything from RingCentral.
 */
export async function refreshDaySummary(opts: {
  date: string;
  email: string;
  agentName: string;
}): Promise<{ summary: DaySummary | null; callsReviewed: number; callsTotal: number }> {
  const { from, to } = dayWindow(opts.date);
  const [analysed, callsTotal] = await Promise.all([
    listDayAnalyses(from, to, opts.email),
    coachableTotal(opts.date, opts.email),
  ]);

  if (analysed.length === 0) return { summary: null, callsReviewed: 0, callsTotal };

  const summary = await synthesizeDay({
    agentName: opts.agentName,
    date: opts.date,
    reviewed: analysed.length,
    total: Math.max(callsTotal, analysed.length),
    analyses: analysed.map((a) => a.analysis),
  });

  await upsertDaySummary({
    day: opts.date,
    agent_email: opts.email.toLowerCase(),
    summary_json: summary,
    calls_reviewed: analysed.length,
    calls_total: Math.max(callsTotal, analysed.length),
  });

  return { summary, callsReviewed: analysed.length, callsTotal: Math.max(callsTotal, analysed.length) };
}

/** Whatever is stored for a day, plus the honest denominator even when nothing is stored yet. */
export async function readDayCoaching(opts: { date: string; email: string }): Promise<DayCoachingResult> {
  const [stored, callsTotal] = await Promise.all([
    getDaySummary(opts.date, opts.email.toLowerCase()),
    coachableTotal(opts.date, opts.email),
  ]);

  return {
    date: opts.date,
    summary: (stored?.summary_json as DaySummary) ?? null,
    callsReviewed: stored?.calls_reviewed ?? 0,
    callsTotal: stored?.calls_total ?? callsTotal,
    newlyCoached: 0,
    moreAvailable: (stored?.calls_reviewed ?? 0) < callsTotal,
    errors: [],
  };
}

/**
 * Coach a sample of a day, then summarise it.
 *
 * Already-coached calls are skipped rather than re-coached, so running this twice on the same day
 * deepens the sample instead of paying for the same audio again.
 */
export async function coachDay(opts: {
  date: string;
  email: string;
  isAdmin: boolean;
  limit?: number;
  agentName?: string;
}): Promise<DayCoachingResult> {
  const limit = opts.limit ?? DAY_SAMPLE_SIZE;
  const startedAt = Date.now();
  const errors: string[] = [];

  const all = await listCallsForDay({ date: opts.date, email: opts.email, isAdmin: opts.isAdmin });
  const uncoached = all.filter((c: CallOption) => !c.coached);
  const sample = spreadSample(uncoached, limit);

  let newlyCoached = 0;
  for (const call of sample) {
    if (Date.now() - startedAt > START_DEADLINE_MS) {
      errors.push('Ran out of time before coaching the rest of the sample — run it again to go deeper.');
      break;
    }
    try {
      await coachOneCall({ date: opts.date, recordingId: call.recordingId, email: opts.email, isAdmin: opts.isAdmin });
      newlyCoached++;
    } catch (e) {
      errors.push(`${new Date(call.startTime).toISOString().slice(11, 16)} — ${(e as Error).message}`);
    }
  }

  // The agent name comes from the call log rather than the profile: it is the name RingCentral
  // holds for the extension, which is the name every other part of the coaching uses.
  const agentName = opts.agentName ?? all[0]?.agentName ?? 'the agent';

  try {
    const { summary, callsReviewed, callsTotal } = await refreshDaySummary({
      date: opts.date,
      email: opts.email,
      agentName,
    });
    return {
      date: opts.date,
      summary,
      callsReviewed,
      callsTotal,
      newlyCoached,
      moreAvailable: callsReviewed < callsTotal,
      errors,
    };
  } catch (e) {
    // Calls were still coached and stored; only the day-level write-up failed.
    errors.push(`Day summary failed: ${(e as Error).message}`);
    const fallback = await readDayCoaching({ date: opts.date, email: opts.email });
    return { ...fallback, newlyCoached, errors };
  }
}
