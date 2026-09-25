import { useEffect, useState } from 'react';
import { api, ringcentral, mmss, type AgentOption, type RingCentralCallOption } from '../api';
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
 *
 * An admin gets one thing more and one thing less: a picker for whose calls to read, and no way
 * to coach any of them (see requireCoachingRights in server/src/auth.ts). Reviewing someone
 * else's work is not the same act as asking for feedback on your own.
 */

const LONG_DATE = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** "my calls" is wrong for an admin: the calls they are looking at are somebody else's. */
const SHOW_LABEL = (isAdmin: boolean) => (isAdmin ? 'Show calls' : 'Show my calls');

export function RequestCoaching({
  date,
  onDateChange,
  agent,
  onAgentChange,
  isAdmin,
  onOpenCall,
}: {
  /** Owned by App so the day summary below reacts to the same calendar. */
  date: string;
  onDateChange: (date: string) => void;
  /** Admin only: whose calls to show, or null for everyone. Owned by App for the same reason. */
  agent: string | null;
  onAgentChange: (agent: string | null) => void;
  /** Admins pick an agent and read; everyone else coaches their own calls. */
  isAdmin: boolean;
  /** `isNew` is true only when this call was just coached, so the caller can skip a reload. */
  onOpenCall: (callId: string, isNew: boolean) => void;
}) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const [calls, setCalls] = useState<RingCentralCallOption[] | null>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Coaching a call changes that day's "already coached" badge, so the calendar has to re-read.
  const [calendarKey, setCalendarKey] = useState(0);

  // The roster is the one thing here that is not about the selected day, so it loads once.
  // A failure leaves the picker on "All agents" rather than blocking the panel: the day listing
  // an admin came for works without it.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void api
      .agents()
      .then((r) => !cancelled && setAgents(r.agents))
      .catch(() => !cancelled && setAgents([]));
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { calls } = await ringcentral.callsOn(date, agent);
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
      const { callId, durationSec } = await ringcentral.coach(date, call.recordingId);
      // Length comes back too: until now this row showed the call-log duration, and the coached
      // call is timed on its recording, which is shorter. Without this the row would disagree
      // with the call page it just opened.
      setCalls((prev) =>
        prev?.map((c) =>
          c.recordingId === call.recordingId ? { ...c, coached: true, callId, durationSec } : c,
        ) ?? null,
      );
      setCalendarKey((k) => k + 1);
      onOpenCall(callId, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const remaining = calls?.filter((c) => !c.coached).length ?? 0;

  return (
    <section className="panel request-panel">
      <header>
        <span>{isAdmin ? 'Review coaching' : 'Request coaching'}</span>
        <span className="request-head-note">
          {isAdmin ? 'Pick an agent and a day' : 'Pick a day, then choose a call'}
        </span>
      </header>

      <div className="request-body">
        <div className="request-aside">
          <CoachingCalendar
            value={date}
            max={today}
            agent={agent}
            refreshKey={calendarKey}
            onChange={(d) => {
              onDateChange(d);
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
            <div className="request-head-actions">
              {/* Only an admin has anyone to choose between — see /api/agents. */}
              {isAdmin && (
                <label className="agent-picker">
                  <span>Agent</span>
                  <select
                    value={agent ?? ''}
                    onChange={(e) => {
                      onAgentChange(e.target.value || null);
                      // Same reason as changing the day: what is on screen belongs to the person
                      // who was selected a moment ago.
                      setCalls(null);
                      setError(null);
                    }}
                  >
                    <option value="">All agents</option>
                    {agents.map((a) => (
                      <option key={a.email} value={a.email}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="primary-action" onClick={load} disabled={loading}>
                {loading ? 'Loading…' : calls ? 'Refresh' : SHOW_LABEL(isAdmin)}
              </button>
            </div>
          </div>

          {error && <div className="request-error">{error}</div>}

          {!calls && !error && (
            <div className="request-placeholder">
              Nothing loaded yet. Days carrying a number have calls worth reviewing — pick one, then
              press <strong>{SHOW_LABEL(isAdmin)}</strong>.
            </div>
          )}

          {calls && calls.length === 0 && !error && (
            <div className="request-placeholder">
              No call on this day cleared the 90-second floor. Shorter calls are transfers and
              voicemail drops, with no conversation in them to coach.
            </div>
          )}

          {calls && calls.length > 0 && (
            /* Scrolls inside the panel rather than stretching it: a busy day is 20+ calls, and
               letting the table set the page height pushed everything below it off screen. */
            <div className="call-options-scroll">
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
                    <td
                      title={
                        c.coached
                          ? 'Length of the recording'
                          : 'Call-log length, ringing included — the recording is shorter'
                      }
                    >
                      {mmss(c.durationSec)}
                    </td>
                    <td>
                      <span className={`dir-pill dir-${c.direction}`}>{c.direction}</span>
                    </td>
                    <td>{c.agentName}</td>
                    <td>
                      {c.coached ? (
                        <button className="ghost" onClick={() => c.callId && onOpenCall(c.callId, false)}>
                          View coaching
                        </button>
                      ) : isAdmin ? (
                        // Not a disabled button: nothing an admin can do makes it clickable, and a
                        // greyed-out control reads as "try again later".
                        <span className="row-note">Not coached yet</span>
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
            </div>
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
