import { useEffect, useState } from 'react';
import { coaching, type DayCoachingResult } from '../api';

/**
 * Coaching for a day, which is what this tool is actually for.
 *
 * Per-call feedback answers "how did this call go", and an agent taking twenty calls cannot act
 * on twenty of those. What they can act on is the thread running through them — so the day is the
 * headline and the individual calls are the evidence underneath it.
 *
 * Coaching a day transcribes a sample of its calls rather than all of them: the whole day is the
 * nightly batch we removed, at minutes of processing and real money per agent per day. Everything
 * here therefore states its sample size, because a summary drawn from three calls out of twenty
 * and one drawn from all twenty are not the same claim.
 */
export function DayCoaching({
  date,
  agent = null,
  readOnly = false,
  refreshKey = 0,
}: {
  date: string;
  /** Admin only: read this agent's day instead of your own. */
  agent?: string | null;
  /** Admins review days, they do not coach them — see requireCoachingRights on the server. */
  readOnly?: boolean;
  refreshKey?: number;
}) {
  const [data, setData] = useState<DayCoachingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [coachingDay, setCoachingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * An admin on "All agents" has no day to read: the summary is one agent's thread through one
   * day, and the server would answer for the admin's own (empty) calls. Ask rather than show a
   * confident "no coachable calls on this day" about nobody in particular.
   */
  const needsAgent = readOnly && !agent;

  useEffect(() => {
    if (needsAgent) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    coaching
      .day(date, agent)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [date, agent, refreshKey, needsAgent]);

  async function runDayCoaching() {
    setCoachingDay(true);
    setError(null);
    try {
      setData(await coaching.coachDay(date));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCoachingDay(false);
    }
  }

  const summary = data?.summary;
  const reviewed = data?.callsReviewed ?? 0;
  const total = data?.callsTotal ?? 0;

  return (
    <section className="panel day-panel">
      <header>
        <span>Coaching for the day</span>
        {/* The denominator is the day's real call volume, not the rows we happen to hold. A
            summary that says "1 of 3" when the day held 22 overstates what it looked at. */}
        {!loading && total > 0 && (
          <span className="day-sample">
            drawn from {reviewed} of {total} call{total === 1 ? '' : 's'}
          </span>
        )}
      </header>

      <div className="day-body">
        {needsAgent && (
          <div className="request-placeholder">
            Pick an agent above to read their day. A day summary is one person's thread through
            their calls.
          </div>
        )}

        {!needsAgent && loading && <div className="request-placeholder">Loading the day…</div>}

        {!needsAgent && !loading && error && <div className="request-error">{error}</div>}

        {!needsAgent && !loading && !error && !summary && (
          <div className="day-empty">
            <p>
              {total > 0
                ? `${readOnly ? 'This agent took' : 'You took'} ${total} coachable call${
                    total === 1 ? '' : 's'
                  } on this day. Nothing has been reviewed yet.`
                : 'No coachable calls on this day.'}
            </p>
            {/* An admin sees the state of the day and no button: the request to be coached is the
                agent's to make about their own work. */}
            {total > 0 && !readOnly && (
              <button className="primary-action" onClick={runDayCoaching} disabled={coachingDay}>
                {coachingDay ? 'Reviewing the day…' : 'Coach my day'}
              </button>
            )}
          </div>
        )}

        {!needsAgent && !loading && summary && (
          <>
            <h2 className="day-headline">{summary.headline}</h2>
            <p className="day-pattern">{summary.pattern}</p>

            <div className="day-grid">
              <div>
                <div className="k">Keep doing this</div>
                <strong>{summary.keepDoing.title}</strong>
                <p>{summary.keepDoing.detail}</p>
              </div>
              <div>
                <div className="k">Where to focus</div>
                <strong>{summary.focusOn.title}</strong>
                <p>{summary.focusOn.detail}</p>
              </div>
            </div>

            <div className="day-practice">
              <div className="k">Try this tomorrow</div>
              <p>{summary.practiceAction}</p>
            </div>

            {data?.moreAvailable && (
              <div className="day-deepen">
                <span>
                  {total - reviewed} call{total - reviewed === 1 ? '' : 's'} from this day still unreviewed.
                </span>
                {!readOnly && (
                  <button className="ghost" onClick={runDayCoaching} disabled={coachingDay}>
                    {coachingDay ? 'Reviewing…' : 'Review more of this day'}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {coachingDay && (
          <div className="request-busy">
            Transcribing and reviewing a sample of the day, then writing it up — this takes a couple of minutes.
          </div>
        )}

        {/* Per-call failures are reported without discarding the summary: four calls out of five
            still make a day worth reading. */}
        {!coachingDay && data?.errors && data.errors.length > 0 && (
          <div className="day-errors">
            {data.errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
