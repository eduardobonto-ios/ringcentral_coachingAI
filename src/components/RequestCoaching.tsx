import { useState } from 'react';
import { ringcentral, mmss, type RingCentralCallOption } from '../api';
import { CoachingCalendar } from './CoachingCalendar';

/**
 * Pick a day, see the calls, coach the ones worth reviewing.
 *
 * Two columns rather than a stack: the calendar is a fixed-width control and the day's calls are
 * the variable-width content. Putting the action button loose beside the calendar left most of the
 * panel empty and made the two read as unrelated widgets. The right column now always says
 * something — a prompt, a count, an error, or the list.
 *
 * Listing a day is free: it reads the call log and downloads no audio. Coaching one call
 * downloads, transcribes and analyses just that recording, which is why it is a per-row action.
 */

const LONG_DATE = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

export function RequestCoaching({ onCoached }: { onCoached: (callId: string) => void }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const [date, setDate] = useState(today);
  const [calls, setCalls] = useState<RingCentralCallOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Coaching a call changes that day's "already coached" badge, so the calendar has to re-read.
  const [calendarKey, setCalendarKey] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { calls } = await ringcentral.callsOn(date);
      setCalls(calls);
      // Listing a day also indexes it server-side, so the badge for this day is now known.
      setCalendarKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
      setCalls(null);
    } finally {
      setLoading(false);
    }
  }

  async function coach(call: RingCentralCallOption) {
    setBusyId(call.recordingId);
    setError(null);
    try {
      const { callId } = await ringcentral.coach(date, call.recordingId);
      setCalls((prev) =>
        prev?.map((c) => (c.recordingId === call.recordingId ? { ...c, coached: true, callId } : c)) ?? null,
      );
      setCalendarKey((k) => k + 1);
      onCoached(callId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const remaining = calls?.filter((c) => !c.coached).length ?? 0;

  return (
    <section className="panel request-panel" id="request-coaching">
      <header>
        <span>Request coaching</span>
        <span className="request-head-note">Pick a day, then choose a call</span>
      </header>

      <div className="request-body">
        <div className="request-aside">
          <CoachingCalendar
            value={date}
            max={today}
            refreshKey={calendarKey}
            onChange={(d) => {
              setDate(d);
              // The listing on screen belongs to the previous day; clearing it avoids showing one
              // day's calls under another day's heading.
              setCalls(null);
              setError(null);
            }}
          />
        </div>

        <div className="request-main">
          <div className="request-main-head">
            <div>
              <div className="eyebrow">Selected day</div>
              <h3>{LONG_DATE(date)}</h3>
              {calls && !error && (
                <div className="request-summary">
                  {calls.length === 0
                    ? 'No recorded calls long enough to coach'
                    : `${calls.length} coachable · ${remaining} not yet reviewed`}
                </div>
              )}
            </div>
            <button className="primary-action" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : calls ? 'Refresh' : 'Show my calls'}
            </button>
          </div>

          {error && <div className="request-error">{error}</div>}

          {!calls && !error && (
            <div className="request-placeholder">
              Nothing loaded yet. Days carrying a number have calls worth reviewing — pick one, then
              press <strong>Show my calls</strong>.
            </div>
          )}

          {calls && calls.length === 0 && !error && (
            <div className="request-placeholder">
              No call on this day cleared the 90-second floor. Shorter calls are transfers and
              voicemail drops, with no conversation in them to coach.
            </div>
          )}

          {calls && calls.length > 0 && (
            <table className="call-options">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Length</th>
                  <th>Direction</th>
                  <th>Agent</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.recordingId} className={c.coached ? 'is-coached' : ''}>
                    <td>{new Date(c.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{mmss(c.durationSec)}</td>
                    <td>
                      <span className={`dir-pill dir-${c.direction}`}>{c.direction}</span>
                    </td>
                    <td>{c.agentName}</td>
                    <td>
                      {c.coached ? (
                        <button className="ghost" onClick={() => c.callId && onCoached(c.callId)}>
                          View coaching
                        </button>
                      ) : (
                        <button className="ghost" onClick={() => coach(c)} disabled={busyId !== null}>
                          {busyId === c.recordingId ? 'Coaching…' : 'Coach this call'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Long calls take a while to transcribe — say so rather than letting it look hung. */}
          {busyId && (
            <div className="request-busy">Downloading, transcribing and reviewing — this takes up to a minute.</div>
          )}
        </div>
      </div>
    </section>
  );
}
