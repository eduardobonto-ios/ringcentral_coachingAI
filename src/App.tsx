import { useEffect, useMemo, useRef, useState } from 'react';
import { api, isDemo, mmss, when, type CallSummary, type CallDetail as Detail, type Dimension } from './api';
import { CallDetail } from './components/CallDetail';
import { DailyCoachingPanel } from './components/DailyCoachingPanel';
import { RequestCoaching } from './components/RequestCoaching';
import { Login } from './components/Login';
import { buildDailyRollup, latestDayKey, summarizeTrend, type DailyRollup } from './dailyRollup';
import { useAuth } from './useAuth';
import logo from './assets/valveXwelsford.png';

export default function App() {
  const { loading: authLoading, session, profile, profileError, viewMode, signOut } = useAuth();
  const canLoad = isDemo || Boolean(session);

  const [calls, setCalls] = useState<CallSummary[]>([]);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, Detail>>({});
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Demo build only: a cosmetic switcher since there's no login there. Live mode derives the
  // equivalent role from the signed-in profile (see `role` below).
  const [cosmeticRole, setCosmeticRole] = useState<'employee' | 'manager' | 'admin'>('manager');
  const role: 'employee' | 'manager' | 'admin' = isDemo ? cosmeticRole : viewMode === 'staff' ? 'employee' : viewMode;
  // Real Valveman figures (confirmed 2026-09-18): 8 agents, ~4hrs of calls/day each at a
  // 20-25min average call length -> ~11 calls/agent/day. Still editable in the UI.
  const [callsPerAgentDay, setCallsPerAgentDay] = useState(11);
  const [averageMinutes, setAverageMinutes] = useState(22.5);
  const [employees, setEmployees] = useState(8);
  const [transcriptionRate, setTranscriptionRate] = useState(0.006);
  const [analysisRate, setAnalysisRate] = useState(0.012);
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
    if (!canLoad) return;
    void load();
  }, [canLoad]);

  useEffect(() => {
    if (!selected) return;
    void api.call(selected).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  // Fetched once per call list so the daily-coaching rollup (strengths/opportunities/practice
  // action) can be aggregated client-side, without a dedicated backend endpoint. In live mode
  // `calls` is already scoped server-side (own calls / department / everyone), so this never
  // sees more than the signed-in user is allowed to.
  useEffect(() => {
    if (!calls.length) return;
    let cancelled = false;
    void Promise.all(calls.map((c) => api.call(c.id).catch(() => null))).then((results) => {
      if (cancelled) return;
      const map: Record<string, Detail> = {};
      results.forEach((d, i) => {
        if (d) map[calls[i].id] = d;
      });
      setDetailsById(map);
    });
    return () => {
      cancelled = true;
    };
  }, [calls]);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const { callId } = await api.upload(file);
      await load();
      setSelected(callId);
    } catch (e) {
      setError(`Upload failed: ${String(e)}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const sent = calls.filter((c) => c.email_status === 'sent' || c.email_status === 'dry-run').length;
  const monthlyCalls = callsPerAgentDay * employees * 22;
  const monthlyMinutes = monthlyCalls * averageMinutes;
  const transcriptionCost = monthlyMinutes * transcriptionRate;
  const analysisCost = monthlyCalls * analysisRate;
  const monthlyCost = transcriptionCost + analysisCost;
  const currentDay = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
  const accessCopy = role === 'employee'
    ? 'Your coaching and personal trends only'
    : role === 'manager'
      ? "Your team's daily coaching view"
      : 'Company-wide settings and access controls';
  // Demo build has no login, so "you" is a stand-in resolved to the most recent call's agent.
  // Live mode uses the real signed-in profile instead.
  const employeeCall = useMemo(
    () => [...calls].sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0] ?? null,
    [calls],
  );
  const employeeEmail = isDemo ? (employeeCall?.agent_email ?? null) : (profile?.email ?? null);
  const employeeName = isDemo ? (employeeCall?.agent_name ?? 'You') : (profile?.full_name || profile?.email || 'You');

  // Live mode: /api/calls is already scoped server-side (own calls / department / everyone) —
  // re-filtering here would be redundant at best and wrong at worst (the client has no way to
  // know department membership, which is why that scoping happens behind the service-role key).
  // Demo mode has no backend, so the cosmetic switcher still filters client-side.
  const visibleCalls = useMemo(
    () => (isDemo && role === 'employee' ? calls.filter((c) => c.agent_email === employeeEmail) : calls),
    [calls, role, employeeEmail],
  );

  const visibleDetails = useMemo(() => {
    const all = Object.values(detailsById);
    return isDemo && role === 'employee' ? all.filter((d) => d.agent_email === employeeEmail) : all;
  }, [detailsById, role, employeeEmail]);

  // Each agent's own most recent day with calls — not one global date — so one agent's
  // idle week doesn't blank out another agent's rollup (and vice versa).
  const rollups = useMemo(() => {
    const byAgent = new Map<string, { email: string; name: string }>();
    for (const d of visibleDetails) byAgent.set(d.agent_email, { email: d.agent_email, name: d.agent_name });
    return [...byAgent.values()]
      .map(({ email, name }) => {
        const ownDetails = visibleDetails.filter((d) => d.agent_email === email);
        const dateKey = latestDayKey(ownDetails);
        return dateKey ? buildDailyRollup(email, name, dateKey, ownDetails) : null;
      })
      .filter((r): r is DailyRollup => r !== null);
  }, [visibleDetails]);

  const teamTrend = useMemo(() => summarizeTrend(rollups), [rollups]);
  const dailyFocusLabel =
    teamTrend === 'strong' ? 'On track' : teamTrend === 'mixed' ? 'Mixed' : teamTrend === 'attention' ? 'Needs focus' : '—';

  const positionLabel = profile
    ? profile.role === 'admin'
      ? 'Application Admin'
      : profile.position === 'manager'
        ? `Department Manager${profile.department ? ` · ${profile.department}` : ''}`
        : 'Staff'
    : '';

  if (!isDemo && authLoading) {
    return (
      <div className="app">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  if (!isDemo && !session) {
    return <Login />;
  }

  if (!isDemo && !profile) {
    return (
      <div className="app">
        <div className="panel" style={{ padding: 20, marginTop: 40 }}>
          {profileError ?? 'Loading your profile…'}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="masthead">
        {/* Logo beside the title rather than above it: stacked, the masthead pushed the
            conversation list off the first screen, which is the one thing people come here for. */}
        <div className="masthead-brand">
          <img src={logo} alt="Welsford x Valveman" className="masthead-logo" />
          <div>
            <h1>Coaching workspace</h1>
            <div className="sub">A daily view for better conversations, not a scorecard</div>
          </div>
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
            {isDemo ? 'Read-only preview' : uploading ? 'Processing…' : 'Upload recording'}
          </button>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ padding: 14, marginTop: 16, borderColor: 'var(--risk)', color: 'var(--risk)' }}>
          {error}
        </div>
      )}

      <div className="workspace-bar">
        <div>
          <div className="eyebrow">Viewing as</div>
          <strong>{employeeName}</strong>
          <span className="access-copy">{isDemo ? accessCopy : `${positionLabel} · ${accessCopy}`}</span>
        </div>
        {isDemo ? (
          <div className="role-switcher" aria-label="Choose workspace role (demo only)">
            {(['employee', 'manager', 'admin'] as const).map((option) => (
              <button key={option} className={cosmeticRole === option ? 'selected' : ''} onClick={() => setCosmeticRole(option)}>
                {option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        ) : (
          <button className="sign-out" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">Today · {currentDay}</div>
          <div className="v">{visibleCalls.length || '—'}</div>
          <div className="stat-note">conversations available to coach</div>
        </div>
        <div className="stat">
          <div className="k">Coaching ready</div>
          <div className="v">{sent}</div>
          <div className="stat-note">shared with the right person</div>
        </div>
        <div className="stat">
          <div className="k">Daily focus</div>
          <div className="v">{dailyFocusLabel}</div>
          <div className="stat-note">small steps worth practicing</div>
        </div>
        <div className="stat">
          <div className="k">Access</div>
          <div className="v access-stat">{role === 'admin' ? 'Full' : role === 'manager' ? 'Team' : 'Mine'}</div>
          <div className="stat-note">sensitive data boundary</div>
        </div>
      </div>

      {/* The calendar is always open. It used to sit behind a "Request coaching" toggle that reset
          on every page load, which hid the one thing an agent signs in to do behind a button that
          gave no hint of what was under it. */}
      {!isDemo && (
        <RequestCoaching
          onCoached={async (callId) => {
            // A newly coached call is not in the list yet, so refresh before selecting it.
            await load();
            setSelected(callId);
          }}
        />
      )}

      <DailyCoachingPanel rollups={rollups} showAgentName={role !== 'employee'} />

      {/* Cost modelling is a planning tool for whoever owns the spend, not something an
          agent or manager acts on — admins only. */}
      {role === 'admin' && (
        <section className="cost-panel panel">
          <div className="cost-intro">
            <div className="eyebrow">Before automatic transcription</div>
            <h2>Model the monthly cost first.</h2>
            <p>These estimates make the tradeoff visible. A lower-cost rollout could sample calls, transcribe on request, or analyze a daily set instead of every recording.</p>
          </div>
          <div className="cost-fields">
            <label>Calls / agent / day<input type="number" min="0" value={callsPerAgentDay} onChange={(e) => setCallsPerAgentDay(Number(e.target.value))} /></label>
            <label>Average minutes<input type="number" min="1" value={averageMinutes} onChange={(e) => setAverageMinutes(Number(e.target.value))} /></label>
            <label>Employees / agents<input type="number" min="1" value={employees} onChange={(e) => setEmployees(Number(e.target.value))} /></label>
            <label>Transcription $ / min<input type="number" min="0" step="0.001" value={transcriptionRate} onChange={(e) => setTranscriptionRate(Number(e.target.value))} /></label>
            <label>AI analysis $ / call<input type="number" min="0" step="0.001" value={analysisRate} onChange={(e) => setAnalysisRate(Number(e.target.value))} /></label>
          </div>
          <div className="cost-result">
            <div><span>Monthly calls</span><strong>{monthlyCalls.toLocaleString()}</strong></div>
            <div><span>Transcription volume</span><strong>{monthlyMinutes.toLocaleString()} min</strong></div>
            <div><span>Transcription</span><strong>${transcriptionCost.toFixed(2)}</strong></div>
            <div><span>AI analysis</span><strong>${analysisCost.toFixed(2)}</strong></div>
            <div className="total"><span>Estimated monthly total</span><strong>${monthlyCost.toFixed(2)}</strong></div>
          </div>
          <div className="cost-note">
            Defaults: OpenAI Whisper API ($0.006/min) and Claude Sonnet 5 (~2K input / ~750 output tokens per structured
            review, at $2/$10 per 1M tokens). Planning estimate only — confirm current vendor pricing, taxes, audio
            storage, and retention costs before committing.
          </div>
        </section>
      )}

      <div className="split">
        <div className="panel">
          <header>
            <span>Conversations</span>
            <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>recent first</span>
          </header>
          {calls.length === 0 ? (
            <div className="empty">Nothing yet. Upload a recording above to get started.</div>
          ) : (
            <ul className="calls">
              {[...visibleCalls]
                .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
                .map((c) => (
                  <li key={c.id}>
                    <button aria-current={selected === c.id} onClick={() => setSelected(c.id)}>
                      <span className="who">{c.agent_name}</span>
                      <span className="score" style={{ color: 'var(--accent)' }}>
                        {c.overall_score !== null ? 'Ready' : 'Pending'}
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
          <CallDetail
            call={detail}
            dimensions={dimensions}
            // The coaching panel is always rendered now, so there is nothing to open — take
            // the person to it instead.
            onCoach={() => document.getElementById('request-coaching')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            onAnalyzed={async () => {
              await load();
              const fresh = await api.call(detail.id).catch(() => null);
              if (fresh) setDetail(fresh);
            }}
          />
        ) : (
          <div className="panel">
            <div className="empty">Select a call to see its coaching.</div>
          </div>
        )}
      </div>
    </div>
  );
}
