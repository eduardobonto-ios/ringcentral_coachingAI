import { useState } from 'react';
import { ringcentral, mmss, type RingCentralCallOption } from '../api';

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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { calls } = await ringcentral.callsOn(date);
      setCalls(calls);
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
      onCoached(callId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel coaching-panel">
      <div className="eyebrow">Request coaching</div>
      <div className="coaching-request-row">
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
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
