// Calendar-day arithmetic in the one timezone this app thinks in.
//
// Lived in ringcentralOnDemand.ts while a single day was the only window anyone asked for. The
// day index needs the same conversions for whole months, and two copies of a timezone rule is
// how a day-boundary bug gets in, so they moved here.
//
// Asia/Manila has no DST, which is what makes the fixed offset below safe. Do not reuse this
// module for a timezone that observes one.

/** The timezone the whole app displays and groups by — see src/dailyRollup.ts. */
export const TZ_OFFSET = '+08:00';
export const TZ = 'Asia/Manila';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** A calendar day in Manila, as the UTC instants the RingCentral call log expects. */
export function dayWindow(date: string): { from: string; to: string } {
  if (!DATE_RE.test(date)) throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD.`);
  const from = new Date(`${date}T00:00:00${TZ_OFFSET}`);
  const to = new Date(from.getTime() + 24 * 3600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Which Manila calendar day a UTC instant falls on. `en-CA` formats as YYYY-MM-DD. */
export function manilaDayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Today in Manila, as YYYY-MM-DD. */
export function manilaToday(): string {
  return manilaDayOf(new Date().toISOString());
}

/** Every Manila day in a YYYY-MM month, plus the UTC instants that bracket it. */
export function monthWindow(month: string): { days: string[]; from: string; to: string } {
  if (!MONTH_RE.test(month)) throw new Error(`Invalid month "${month}" — expected YYYY-MM.`);
  const [y, m] = month.split('-').map(Number);

  // Day 0 of the next month is the last day of this one — avoids a leap-year table.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);

  return { days, from: dayWindow(days[0]).from, to: dayWindow(days[days.length - 1]).to };
}

/** `count` days back from `date` inclusive, oldest first. Used to re-index recent days. */
export function recentDays(date: string, count: number): string[] {
  const end = new Date(`${date}T00:00:00${TZ_OFFSET}`);
  return Array.from({ length: count }, (_, i) =>
    manilaDayOf(new Date(end.getTime() - (count - 1 - i) * 24 * 3600_000).toISOString()),
  );
}
