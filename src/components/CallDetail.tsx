import { useMemo, useRef, useState } from 'react';
import { api, audioSrc, mmss, when, type CallDetail as Detail, type Dimension } from '../api';

const scoreColor = (n: number) =>
  n >= 4 ? 'var(--accent)' : n >= 2 ? 'var(--warn)' : 'var(--risk)';

export function CallDetail({ call, dimensions }: { call: Detail; dimensions: Dimension[] }) {
  const [tab, setTab] = useState<'coaching' | 'transcript' | 'email'>('coaching');
  const audio = useRef<HTMLAudioElement>(null);
  const a = call.analysis;

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
            <div className="bigscore" style={{ color: a ? scoreColor(a.overallScore / 20) : 'var(--muted)' }}>
              {a?.overallScore ?? '—'}
              <small>/100</small>
            </div>
            {a && <div className="band" style={{ color: scoreColor(a.overallScore / 20) }}>{a.band}</div>}
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>
              {call.agent_name} · {call.agent_role}
              <br />
              {when(call.recorded_at)} · {mmss(call.duration_sec)}
            </div>
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            {a?.outcome && <div className="outcome">{a.outcome}</div>}
            <audio ref={audio} controls preload="metadata" src={audioSrc(call)} />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              {call.email
                ? `Coaching email ${call.email.status === 'sent' ? 'sent to' : 'prepared for'} ${call.email.to}`
                : 'No coaching email yet'}
            </div>
          </div>
        </div>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'coaching'} onClick={() => setTab('coaching')}>
            Coaching
          </button>
          <button role="tab" aria-selected={tab === 'transcript'} onClick={() => setTab('transcript')}>
            Transcript
          </button>
          <button role="tab" aria-selected={tab === 'email'} onClick={() => setTab('email')}>
            Email sent
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
              <h3>What to change</h3>
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
                Score by area <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· rubric {a.rubricVersion}</span>
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

        {tab === 'email' && (
          <div className="section">
            {call.email ? (
              <>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                  <strong style={{ color: 'var(--ink)' }}>{call.email.subject}</strong>
                  <br />
                  To {call.email.to} · {call.email.status}
                  {call.email.sentAt ? ` · ${when(call.email.sentAt)}` : ''}
                </div>
                <iframe className="emailframe" title="Coaching email" src={api.emailUrl(call.id)} />
              </>
            ) : (
              <div className="empty">No coaching email has been generated for this call yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
