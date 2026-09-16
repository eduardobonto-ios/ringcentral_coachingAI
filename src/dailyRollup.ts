import type { CallDetail as Detail } from './api';

export type Trend = 'strong' | 'mixed' | 'attention' | 'no-data';

export type DailyRollup = {
  dateKey: string;
  agentEmail: string;
  agentName: string;
  callsTotal: number;
  callsCoached: number;
  topStrength: string | null;
  topOpportunity: string | null;
  practiceAction: string | null;
  trend: Trend;
};

export const trendCopy: Record<Trend, string> = {
  strong: 'Steady day — most calls landed well.',
  mixed: 'A mixed day — worth a quick look.',
  attention: 'Today could use attention — start here.',
  'no-data': 'No coached calls yet today.',
};

// Calendar-day key in the same timezone the rest of the app displays times in.
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

export function latestDayKey(details: Detail[]): string | null {
  if (!details.length) return null;
  return details.map((d) => dayKey(d.recorded_at)).sort().at(-1) ?? null;
}

function mostCommon(items: string[]): string | null {
  if (!items.length) return null;
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function buildDailyRollup(
  agentEmail: string,
  agentName: string,
  dateKey: string,
  details: Detail[],
): DailyRollup {
  const dayDetails = details.filter((d) => d.agent_email === agentEmail && dayKey(d.recorded_at) === dateKey);
  const analyzed = dayDetails.filter((d) => d.analysis);

  const strengths = analyzed.flatMap((d) => d.analysis!.strengths.map((s) => s.title));
  const opportunities = analyzed.flatMap((d) => d.analysis!.improvements.map((m) => m.title));
  const practiceActions = analyzed.map((d) => d.analysis!.practiceAction).filter(Boolean);

  const bandCounts = analyzed.reduce(
    (acc, d) => {
      const band = d.analysis!.band;
      if (band === 'strong') acc.strong += 1;
      else if (band === 'needs-intervention') acc.attention += 1;
      else acc.mixed += 1;
      return acc;
    },
    { strong: 0, mixed: 0, attention: 0 },
  );

  const trend: Trend =
    analyzed.length === 0
      ? 'no-data'
      : bandCounts.attention > 0 && bandCounts.attention >= analyzed.length / 2
        ? 'attention'
        : bandCounts.strong >= analyzed.length / 2
          ? 'strong'
          : 'mixed';

  return {
    dateKey,
    agentEmail,
    agentName,
    callsTotal: dayDetails.length,
    callsCoached: analyzed.length,
    topStrength: mostCommon(strengths),
    topOpportunity: mostCommon(opportunities),
    practiceAction: practiceActions.at(-1) ?? null,
    trend,
  };
}

export function summarizeTrend(rollups: DailyRollup[]): Trend {
  if (!rollups.length) return 'no-data';
  if (rollups.some((r) => r.trend === 'attention')) return 'attention';
  if (rollups.every((r) => r.trend === 'strong')) return 'strong';
  return 'mixed';
}
