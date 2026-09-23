// Backfill the day index over a range.
//
//   npm run rc:index                          the last 7 days
//   npm run rc:index -- --days 60             the last 60 days
//   npm run rc:index -- --from 2026-08-01 --to 2026-08-31
//
// Reads the RingCentral call log and writes counts. It downloads no audio, transcribes nothing
// and calls no AI — so unlike `npm run rc:sync` it costs nothing but rate budget, and re-running
// it is always safe.
//
// Worth doing once after applying supabase/003_call_day_index.sql: until the index has history,
// past days show as unknown on the calendar rather than as counts. Note that RingCentral's
// detailed call log does not retain records indefinitely, so the further back you leave this,
// the less there is to recover.
import 'dotenv/config';
import { indexDay } from './callDayIndex.js';
import { manilaToday, recentDays } from './manilaDay.js';

const args = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const from = valueOf('--from');
const to = valueOf('--to');
const daysArg = valueOf('--days');

function range(): string[] {
  if (from || to) {
    if (!from || !to) {
      console.error('--from and --to must be given together (YYYY-MM-DD).');
      process.exit(1);
    }
    const start = new Date(`${from}T00:00:00+08:00`);
    const end = new Date(`${to}T00:00:00+08:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      console.error(`Invalid range ${from} -> ${to}.`);
      process.exit(1);
    }
    const count = Math.round((end.getTime() - start.getTime()) / 86400_000) + 1;
    return recentDays(to, count);
  }

  const days = daysArg === undefined ? 7 : Number(daysArg);
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days must be a positive number');
    process.exit(1);
  }
  return recentDays(manilaToday(), days);
}

const days = range();
console.log(`[day-index] indexing ${days.length} day(s): ${days[0]} -> ${days[days.length - 1]}`);

// Sequential on purpose. Each day is a separate call-log read and the account allows 10 per 60s;
// firing them in parallel just makes the rate pacer in ringcentral.ts sleep instead.
for (const day of days) {
  try {
    const r = await indexDay(day);
    console.log(`  ${r.day}  ${String(r.calls).padStart(4)} coachable across ${r.agents} agent(s)`);
  } catch (e) {
    console.error(`  ${day}  FAILED: ${(e as Error).message}`);
  }
}

console.log('[day-index] done');
