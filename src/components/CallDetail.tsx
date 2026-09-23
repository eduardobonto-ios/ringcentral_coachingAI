import { useMemo, useRef, useState } from 'react';
import { api, audioSrc, isDemo, mmss, when, type CallDetail as Detail, type Dimension } from '../api';

const scoreColor = (n: number) =>
  n >= 4 ? 'var(--accent)' : n >= 2 ? 'var(--warn)' : 'var(--risk)';

export function CallDetail({
  call,
  dimensions,
  onAnalyzed,
}: {
  call: Detail;
  dimensions: Dimension[];
  onAnalyzed: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState<'coaching' | 'transcript'>('coaching');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const a = call.analysis;

  /**
   * Retry analysis for a call that was ingested but never analysed.
   *
   * Only reachable while `call.analysis` is null. Once a call has coaching there is nothing for
   * this to do — the coaching is already on screen underneath — and the list above is where a
   * new call gets coached.
   */
  const handleAnalyze = async () => {
    setTab('coaching');
    if (isDemo) {
      setAnalyzeError('This preview call has no analysis yet — run the server to process it.');
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      await api.analyze(call.id);
      await onAnalyzed();
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const label = useMemo(
    () => (key: string) => dimensions.find((d) => d.key === key)?.label ?? key,
    [dimensions],
  );
  const weight = useMemo(
    () => (key: string) => dimensions.find((d) => d.key === key)?.weight ?? 0,
    [dimensions],
  );

  const seek = (t: number) => {
    if (!audio.current) return;
    audio.current.currentTime = t;
    void audio.current.play();
  };

  return (
    <div className="detail">
      <div className="panel">
        <div className="detail-head">
          <div>
            <div className="coaching-status">{a ? 'Coaching ready' : 'Analysis pending'}</div>
            <div className="detail-title">A useful conversation to revisit</div>
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>
              {call.agent_name} · {call.agent_role}
              <br />
              {when(call.recorded_at)} · {mmss(call.duration_sec)}
            </div>
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            {a?.outcome && <div className="outcome">{a.outcome}</div>}
            <audio ref={audio} controls preload="metadata" src={audioSrc(call)} />
            {/* No button once coaching exists: it only re-selected a tab whose content was
                already visible below, duplicating "Coach this call" in the list above. */}
            {!a && (
              <button className="primary-action call-action" onClick={handleAnalyze} disabled={analyzing}>
                {analyzing ? 'Analyzing…' : 'Get coaching for this call'}
              </button>
            )}
            {analyzeError && (
              <div style={{ fontSize: 12, color: 'var(--risk)', marginTop: 6 }}>{analyzeError}</div>
            )}
          </div>
        </div>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'coaching'} onClick={() => setTab('coaching')}>
            Coaching
          </button>
          <button role="tab" aria-selected={tab === 'transcript'} onClick={() => setTab('transcript')}>
            Transcript
          </button>
        </div>

        {tab === 'coaching' && a && (
          <>
            <div className="section">
              <h3>Keep doing this</h3>
              {a.strengths.map((s) => (
                <p key={s.title} style={{ margin: '0 0 8px', fontSize: 13.5, color: 'var(--muted)' }}>
                  <strong style={{ color: 'var(--ink)' }}>{s.title}.</strong> {s.detail}
                </p>
              ))}
            </div>

            <div className="section" style={{ borderTop: '1px solid var(--line)' }}>
                <h3>One opportunity to try next time</h3>
              {a.improvements.map((m, i) => (
                <div className="improve" key={m.title}>
                  <h4>
                    {i + 1}. {m.title}
                  </h4>
                  <p>{m.detail}</p>
                  <div className="said">
                    <b>You said</b> — “{m.instead}”
                  </div>
                  <div className="try">
                    <b>Try</b> — “{m.say}”
                  </div>
                </div>
              ))}
              <div className="action">
                <div className="k">Next shift</div>
                <p>{a.practiceAction}</p>
              </div>
            </div>

            <div className="section" style={{ borderTop: '1px solid var(--line)' }}>
              <h3>
                Patterns to notice <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· coaching rubric {a.rubricVersion}</span>
              </h3>
              <div className="bars">
                {a.scores.map((s) => (
                  <div className="bar-row" key={s.key}>
                    <span className="lbl">{label(s.key)}</span>
                    <span className="wt" style={{ color: scoreColor(s.score) }}>
                      {s.score}/5 · {weight(s.key)}%
                    </span>
                    <div className="track">
                      <span style={{ width: `${(s.score / 5) * 100}%`, background: scoreColor(s.score) }} />
                    </div>
                    <div className="rationale">
                      {s.rationale}
                      {s.evidence.map((e, i) => (
                        <div className="quote" key={i}>
                          “{e.quote}”{' '}
                          <button
                            className="ts"
                            onClick={() => seek(e.t)}
                            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}
                          >
                            {mmss(e.t)} ▸
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'transcript' && (
          <div className="section">
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              {call.engine} · click a timestamp to hear it
            </div>
            <div className="transcript">
              {call.turns.map((t, i) =>
                t.speaker === 'system' ? (
                  <div className="turn system" key={i}>
                    {t.text}
                  </div>
                ) : (
                  <div className={`turn ${t.speaker}`} key={i}>
                    <button
                      className="ts"
                      onClick={() => seek(t.start)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--muted)' }}
                    >
                      {mmss(t.start)}
                    </button>
                    <div>
                      <span className="sp">{t.speaker}</span>
                      <p>
                        {t.text}
                        {t.lowConfidence && (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}> (low confidence)</span>
                        )}
                      </p>
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
