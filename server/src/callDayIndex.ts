// Which days have calls worth coaching — cached, so the date picker can say so up front.
//
// Coaching is requested one call at a time, one day at a time, which leaves people guessing
// which days are even worth opening. The honest fix is to show counts on the calendar, and the
// obvious implementation — query RingCentral for the month being displayed — does not work: a
// month is ~3,300 recorded calls, ~14 call-log pages, against a 10-per-60s budget. The pacer in
// ringcentral.ts would stall well past any function timeout.
//
// So counts are cached in call_day_index and the calendar reads only Postgres. Two things keep
// the cache fed, and neither downloads audio:
//
//   1. Browsing a day. listCallsForDay already pulls that day's whole call log, so counting it
//      and writing the index costs nothing extra.
//   2. A daily cron over the last few days (indexRecentDays), for the days nobody browsed.
//
// Nothing here transcribes or analyses anything. This is metadata only, and re-running it is
// always safe.
import { fetchExtensionsCached, fetchCallLog, type RcCallRecord, type RcExtension } from './ringcentral.js';
import { agentExtensionId, isCoachable, extensionIndex } from './ringcentralMap.js';
import { upsertDayIndex, listDayIndex, listCoachedInWindow, type DayIndexRow } from './db.js';
import { dayWindow, monthWindow, manilaDayOf, manilaToday, recentDays, TZ } from './manilaDay.js';
import cron from 'node-cron';

/**
 * Marks a day as indexed even when nobody made a call.
 *
 * Without it, "indexed and empty" and "never looked at" are the same absence of rows, and the
 * calendar cannot tell a real day off from a gap in its own data. Written for every indexed day,
 * including busy ones, so the day's presence never depends on which agents happened to work.
 */
const DAY_MARKER = '*';

/**
 * How long today's counts may be served from cache.
 *
 * Today is the one day whose count is still changing, and it is also the day agents care about
 * most. A cached zero written at 02:10 would read as "no calls today" for the whole working day,
 * which is worse than admitting we do not know — so today is re-indexed on view once this lapses.
 * Past days never expire: they cannot gain calls.
 */
const TODAY_TTL_MS = 10 * 60_000;

/** De-duplicates concurrent refreshes of the same day, so ten open calendars make one RC call. */
const inFlight = new Map<string, Promise<unknown>>();

function refreshOnce(day: string): Promise<unknown> {
  const existing = inFlight.get(day);
  if (existing) return existing;

  const p = indexDay(day).finally(() => inFlight.delete(day));
  inFlight.set(day, p);
  return p;
}

export type DayCount = {
  /** YYYY-MM-DD in Manila. */
  date: string;
  /** False when this day has never been indexed — the UI must not render that as zero. */
  indexed: boolean;
  /** Recorded calls passing isCoachable(), scoped to the viewer. */
  coachable: number;
  /** How many of them already have coaching stored. */
  coached: number;
};

/**
 * Coachable calls per extension for one day's call log.
 *
 * Pure, and shared by both writers so the cron and the browse path can never disagree. Calls
 * whose extension cannot be resolved are dropped, matching visibleTo() in ringcentralOnDemand:
 * a call with no identifiable agent is not coachable in any useful sense, because there is
 * nobody for the coaching to be about.
 */
export function countByExtension(
  records: RcCallRecord[],
  byExtension: Map<string, RcExtension>,
): Map<string, { extension: RcExtension; count: number }> {
  const counts = new Map<string, { extension: RcExtension; count: number }>();
  for (const record of records) {
    if (!isCoachable(record)) continue;
    const extId = agentExtensionId(record);
    const extension = extId ? byExtension.get(extId) : undefined;
    if (!extension) continue;

    const existing = counts.get(extension.id);
    if (existing) existing.count += 1;
    else counts.set(extension.id, { extension, count: 1 });
  }
  return counts;
}

function rowsFor(day: string, counts: Map<string, { extension: RcExtension; count: number }>): DayIndexRow[] {
  const rows: DayIndexRow[] = [
    { day, extension_id: DAY_MARKER, agent_email: DAY_MARKER, coachable_count: 0 },
  ];
  for (const [extensionId, { extension, count }] of counts) {
    rows.push({ day, extension_id: extensionId, agent_email: extension.email, coachable_count: count });
  }
  return rows;
}

/** Store one day's counts, given a call log already in hand. Never throws — see writeDayIndex. */
export async function recordDayCounts(
  day: string,
  records: RcCallRecord[],
  byExtension: Map<string, RcExtension>,
): Promise<void> {
  await upsertDayIndex(rowsFor(day, countByExtension(records, byExtension)));
}

/**
 * Fire-and-forget version, for the browse path.
 *
 * Indexing is a side benefit of listing a day; a failed write must never stop someone from
 * seeing their calls. Logged, not thrown, and not awaited by the caller.
 */
export function writeDayIndex(day: string, records: RcCallRecord[], byExtension: Map<string, RcExtension>): void {
  recordDayCounts(day, records, byExtension).catch((e) =>
    console.warn(`[day-index] could not index ${day}: ${(e as Error).message}`),
  );
}

/** Index one day from scratch: one call-log read, no audio. */
export async function indexDay(day: string): Promise<{ day: string; calls: number; agents: number }> {
  const { from, to } = dayWindow(day);
  const byExtension = extensionIndex(await fetchExtensionsCached());
  const records = await fetchCallLog({ dateFrom: from, dateTo: to });
  const counts = countByExtension(records, byExtension);

  await upsertDayIndex(rowsFor(day, counts));

  let calls = 0;
  for (const { count } of counts.values()) calls += count;
  return { day, calls, agents: counts.size };
}

/**
 * Index the last `days` Manila days, oldest first.
 *
 * Re-indexes rather than skipping what it has: today's count is still growing while the day runs,
 * and a call-log record can gain its recording a few minutes after the call ends. Overwriting a
 * recent day is one cheap request; leaving it stale is a wrong number on the calendar.
 */
export async function indexRecentDays(days = 2, endingOn = manilaToday()) {
  const results = [];
  for (const day of recentDays(endingOn, days)) {
    try {
      results.push(await indexDay(day));
    } catch (e) {
      console.error(`[day-index] ${day} failed: ${(e as Error).message}`);
      results.push({ day, calls: -1, agents: 0 });
    }
  }
  return results;
}

/**
 * Per-day counts for a month, for the calendar.
 *
 * Reads Postgres only — no RingCentral call, so it is fast enough to run on every month change
 * and safe on a serverless function. An admin sees the whole account; anyone else sees only
 * their own calls, matched on the email RingCentral holds for their extension, which is the same
 * join the listing and coaching endpoints use.
 */
export async function monthOverview(opts: { month: string; email: string; isAdmin: boolean }): Promise<DayCount[]> {
  const { days, from, to } = monthWindow(opts.month);
  const mine = opts.email.toLowerCase();

  let [rows, coachedCalls] = await Promise.all([
    listDayIndex(days[0], days[days.length - 1]),
    listCoachedInWindow(from, to),
  ]);

  // Today's row goes stale as the day goes on, so refresh it before answering. One call-log read,
  // no audio, and only when this month actually contains today.
  const today = manilaToday();
  if (days.includes(today) && isStale(rows, today)) {
    try {
      await refreshOnce(today);
      rows = await listDayIndex(days[0], days[days.length - 1]);
    } catch (e) {
      // Report today as unknown rather than serving a count we know is out of date.
      console.warn(`[day-index] could not refresh ${today}: ${(e as Error).message}`);
      rows = rows.filter((r) => r.day !== today);
    }
  }

  const indexed = new Set<string>();
  const coachable = new Map<string, number>();
  for (const row of rows) {
    indexed.add(row.day);
    if (row.extension_id === DAY_MARKER) continue;
    if (!opts.isAdmin && row.agent_email.toLowerCase() !== mine) continue;
    coachable.set(row.day, (coachable.get(row.day) ?? 0) + row.coachable_count);
  }

  const coached = new Map<string, number>();
  for (const call of coachedCalls) {
    if (!opts.isAdmin && call.agent_email.toLowerCase() !== mine) continue;
    const day = manilaDayOf(call.recorded_at);
    coached.set(day, (coached.get(day) ?? 0) + 1);
  }

  return days.map((date) => ({
    date,
    indexed: indexed.has(date),
    coachable: coachable.get(date) ?? 0,
    coached: coached.get(date) ?? 0,
  }));
}

/**
 * Nightly refresh, for a persistent host (npm run dev / npm start).
 *
 * On Vercel the same work is triggered by Vercel Cron hitting /api/cron/index-days, because
 * node-cron timers do not survive a frozen function. Both paths call indexRecentDays; only the
 * trigger differs.
 *
 * 02:10 Manila: late enough that yesterday is closed and its recordings have landed, early
 * enough to be well clear of the working day's rate budget.
 */
export function startDayIndexCron() {
  cron.schedule('10 2 * * *', () => {
    indexRecentDays(2)
      .then((r) => console.log(`[day-index] refreshed ${r.map((d) => `${d.day}:${d.calls}`).join(' ')}`))
      .catch((e) => console.error('[day-index] refresh failed:', e));
  }, { timezone: TZ });
}

/** True when a day has never been indexed, or was last indexed longer ago than the TTL allows. */
export function isStale(rows: { day: string; indexed_at: string }[], day: string): boolean {
  const seen = rows.filter((r) => r.day === day);
  if (seen.length === 0) return true;

  const newest = Math.max(...seen.map((r) => new Date(r.indexed_at).getTime()));
  return !Number.isFinite(newest) || Date.now() - newest > TODAY_TTL_MS;
}
