import { useState } from 'react';
import { ringcentral, mmss, type RingCentralCallOption } from '../api';
import { CoachingCalendar } from './CoachingCalendar';

/**
 * Pick a day, see the calls, coach the ones worth reviewing.
 *
 * Listing is free — it reads the call log and downloads no audio — so browsing costs nothing and
 * returns in a few seconds. Coaching one call downloads, transcribes and analyses just that
 * recording, which is why it is a per-row action rather than something that happens to every
 * call overnight whether or not anyone looks.
 */
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

  return (
    <section className="panel coaching-panel" id="request-coaching">
      <div className="eyebrow">Request coaching</div>
      <div className="coaching-request-row">
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
        <button className="primary-action" onClick={load} disabled={loading}>
          {loading ? 'Loading calls…' : 'Show my calls'}
        </button>
      </div>

      {error && <div className="empty">{error}</div>}

      {calls && calls.length === 0 && <div className="empty">No recorded calls on this day.</div>}

      {calls && calls.length > 0 && (
        <table className="call-options">
          <tbody>
            {calls.map((c) => (
              <tr key={c.recordingId}>
                <td>{new Date(c.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td>{mmss(c.durationSec)}</td>
                <td>{c.direction}</td>
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
      {busyId && <div className="stat-note">Downloading, transcribing and reviewing — this takes up to a minute.</div>}
    </section>
  );
}
