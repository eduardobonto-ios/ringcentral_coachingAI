import { trendCopy, type DailyRollup } from '../dailyRollup';

export function DailyCoachingPanel({ rollups, showAgentName }: { rollups: DailyRollup[]; showAgentName: boolean }) {
  if (!rollups.length) {
    return (
      <section className="panel coaching-panel">
        <div className="empty">No coached calls yet — check back once today's calls are analyzed.</div>
      </section>
    );
  }

  return (
    <section className="coaching-panel">
      {rollups.map((r) => (
        <div className="panel coaching-card" key={r.agentEmail}>
          <div className="eyebrow">
            {showAgentName ? r.agentName : 'Your coaching'} · {r.dateKey}
          </div>
          <h3>{trendCopy[r.trend]}</h3>
          <div className="coaching-grid">
            <div>
              <div className="k">What's working</div>
              <p>{r.topStrength ?? 'Nothing flagged yet.'}</p>
            </div>
            <div>
              <div className="k">Where to focus</div>
              <p>{r.topOpportunity ?? 'No pattern yet.'}</p>
            </div>
            <div>
              <div className="k">Try next</div>
              <p>{r.practiceAction ?? 'Check back after more calls are coached.'}</p>
            </div>
          </div>
          <div className="stat-note">
            {r.callsCoached} of {r.callsTotal} call{r.callsTotal === 1 ? '' : 's'} coached that day
          </div>
        </div>
      ))}
    </section>
  );
}
