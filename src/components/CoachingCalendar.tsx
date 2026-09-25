import { useEffect, useMemo, useState } from 'react';
import { ringcentral, type DayCount } from '../api';

/**
 * Month grid for picking a day to coach, showing which days actually have calls.
 *
 * Replaces `<input type="date">`. The native picker renders the browser's own calendar, which
 * cannot be annotated at all — so showing counts per day means owning the grid. That is the
 * whole reason this component exists; it is otherwise a worse date input than the platform one.
 *
 * Counts come from the cached day index, so paging months costs one Postgres query and never
 * touches RingCentral.
 */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH_LABEL = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const monthOf = (date: string) => date.slice(0, 7);

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Blank cells before the 1st so the month starts under the right weekday.
 *
 * Monday-first, matching the rest of the suite. `getUTCDay()` is Sunday-first, hence the shift.
 */
function leadingBlanks(month: string): number {
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  return (first + 6) % 7;
}

export function CoachingCalendar({
  value,
  max,
  onChange,
  /** Admin only: count one agent's calls instead of the whole account. */
  agent = null,
  /** Bumped by the parent after a call is coached, so the badges refresh. */
  refreshKey = 0,
}: {
  value: string;
  max: string;
  onChange: (date: string) => void;
  agent?: string | null;
  refreshKey?: number;
}) {
  const [month, setMonth] = useState(() => monthOf(value));
  const [days, setDays] = useState<DayCount[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDays(null);
    setFailed(false);

    ringcentral
      .monthOverview(month, agent)
      .then((r) => !cancelled && setDays(r.days))
      // A missing overview must not block picking a date — the grid still works, it just cannot
      // tell you which days are worth opening.
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
    };
    // `agent` belongs here: the badges are per-agent counts, so switching who you are looking at
    // makes every number on the grid wrong until it re-reads.
  }, [month, agent, refreshKey]);

  const byDate = useMemo(() => new Map((days ?? []).map((d) => [d.date, d])), [days]);
  const blanks = leadingBlanks(month);
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

  // Nothing to show past today: a future day cannot have calls, and RingCentral has no record of
  // one to index.
  const atLatestMonth = month >= monthOf(max);

  return (
    <div className="coaching-calendar">
      <div className="cal-head">
        <button className="cal-nav" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          ‹
        </button>
        <strong>{MONTH_LABEL(month)}</strong>
        <button
          className="cal-nav"
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={atLatestMonth}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="cal-body">
      <div className="cal-grid">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="cal-weekday">
            {d}
          </div>
        ))}

        {Array.from({ length: blanks }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}

        {Array.from({ length: lastDay }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          const info = byDate.get(date);
          const future = date > max;
          const empty = info?.indexed && info.coachable === 0;

          return (
            <button
              key={date}
              className={[
                'cal-day',
                date === value ? 'is-selected' : '',
                future ? 'is-future' : '',
                empty ? 'is-empty' : '',
                info && info.coachable > 0 ? 'has-calls' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={future}
              onClick={() => onChange(date)}
              title={dayTitle(date, info, future)}
            >
              <span className="cal-num">{i + 1}</span>
              <span className="cal-badge">{badgeFor(info, future, failed)}</span>
              {info && info.coached > 0 && <span className="cal-coached" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        {failed ? (
          <span>Day counts unavailable — pick any date to load its calls.</span>
        ) : (
          <>
            <span>
              <b>7</b> coachable calls
            </span>
            <span>
              <i className="cal-coached" /> some already coached
            </span>
            <span>— no calls</span>
            <span>· not indexed yet</span>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function badgeFor(info: DayCount | undefined, future: boolean, failed: boolean): string {
  if (future || failed) return '';
  // The three states are deliberately distinct. A day with no calls is a fact; a day nobody has
  // indexed is an absence of information, and showing it as "0" would be a lie people act on.
  if (!info || !info.indexed) return '·';
  return info.coachable === 0 ? '—' : String(info.coachable);
}

function dayTitle(date: string, info: DayCount | undefined, future: boolean): string {
  if (future) return `${date} — not yet`;
  if (!info || !info.indexed) return `${date} — not indexed yet; open it to find out`;
  if (info.coachable === 0) return `${date} — no coachable calls`;
  const coached = info.coached > 0 ? `, ${info.coached} already coached` : '';
  return `${date} — ${info.coachable} coachable call${info.coachable === 1 ? '' : 's'}${coached}`;
}
