import { useEffect, useRef, useState } from 'react';
import { api, isDemo, mmss, when, type CallSummary, type CallDetail as Detail, type Dimension } from './api';
import { CallDetail } from './components/CallDetail';
import logo from './assets/valveXwelsford.png';

const scoreColor = (n: number | null) =>
  n === null ? 'var(--muted)' : n >= 80 ? 'var(--accent)' : n >= 40 ? 'var(--warn)' : 'var(--risk)';

export default function App() {
  const [calls, setCalls] = useState<CallSummary[]>([]);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const [{ calls }, { dimensions }] = await Promise.all([api.calls(), api.rubric()]);
      setCalls(calls);
      setDimensions(dimensions);
      setSelected((s) => s ?? calls[0]?.id ?? null);
      setError(null);
    } catch (e) {
      setError('Cannot reach the coaching service. Is the server running on port 8787?');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selected) return;
    void api.call(selected).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const { callId } = await api.upload(file, 'agent-001');
      await load();
      setSelected(callId);
    } catch (e) {
      setError(`Upload failed: ${String(e)}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const scored = calls.filter((c) => c.overall_score !== null);
  const avg = scored.length
    ? Math.round(scored.reduce((a, c) => a + (c.overall_score ?? 0), 0) / scored.length)
    : null;
  const sent = calls.filter((c) => c.email_status === 'sent' || c.email_status === 'dry-run').length;
  const flagged = calls.filter((c) => (c.overall_score ?? 100) < 40).length;

  return (
    <div className="app">
      <div className="masthead">
        <div>
          <img
            src={logo}
            alt="Welsford x Valveman"
            style={{
              display: 'block',
              height: 44,
              marginBottom: 10,
              padding: '8px 12px',
              background: '#10161a',
              borderRadius: 8,
            }}
          />
          <h1>Coaching Admin</h1>
          <div className="sub">Every call reviewed, and every coaching email sent to an agent</div>
        </div>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading || isDemo}
            title={isDemo ? 'Read-only preview' : undefined}
            style={{
              font: '600 13px/1 inherit',
              padding: '9px 14px',
              background: isDemo ? 'var(--surface-2)' : 'var(--accent)',
              color: isDemo ? 'var(--muted)' : 'var(--ground)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {isDemo ? 'Read-only preview' : uploading ? 'Processing…' : 'Upload a recording'}
          </button>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ padding: 14, marginTop: 16, borderColor: 'var(--risk)', color: 'var(--risk)' }}>
          {error}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="k">Calls reviewed</div>
          <div className="v">{calls.length}</div>
        </div>
        <div className="stat">
          <div className="k">Coaching sent</div>
          <div className="v">{sent}</div>
        </div>
        <div className="stat">
          <div className="k">Team average</div>
          <div className="v" style={{ color: scoreColor(avg) }}>
            {avg ?? '—'}
          </div>
        </div>
        <div className="stat">
          <div className="k">Needs intervention</div>
          <div className="v" style={{ color: flagged ? 'var(--risk)' : 'var(--muted)' }}>
            {flagged}
          </div>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <header>
            <span>Calls</span>
            <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>worst first</span>
          </header>
          {calls.length === 0 ? (
            <div className="empty">
              Nothing yet. Drop an MP3 into the <span className="mono">inbox/</span> folder, or upload one above.
            </div>
          ) : (
            <ul className="calls">
              {[...calls]
                .sort((a, b) => (a.overall_score ?? 999) - (b.overall_score ?? 999))
                .map((c) => (
                  <li key={c.id}>
                    <button aria-current={selected === c.id} onClick={() => setSelected(c.id)}>
                      <span className="who">{c.agent_name}</span>
                      <span className="score" style={{ color: scoreColor(c.overall_score) }}>
                        {c.overall_score ?? '—'}
                      </span>
                      <span className="meta">
                        {when(c.recorded_at)} · {mmss(c.duration_sec)} ·{' '}
                        <span className={`pill ${c.email_status ? 'sent' : ''}`}>
                          {c.email_status === 'dry-run' ? 'ready to send' : c.email_status ?? c.status}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {detail ? (
          <CallDetail call={detail} dimensions={dimensions} />
        ) : (
          <div className="panel">
            <div className="empty">Select a call to see its coaching.</div>
          </div>
        )}
      </div>
    </div>
  );
}
