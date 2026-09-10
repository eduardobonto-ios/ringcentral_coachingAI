// The Customer Service / Call Center protocol used to score every call.
// Weights sum to 100. This is what "AI Coaching" grades against, and what
// the coaching email's language is anchored to.
export const RUBRIC_VERSION = '2026.1';

export type Dimension = { key: string; label: string; weight: number; description: string };

export const DIMENSIONS: Dimension[] = [
  {
    key: 'empathy',
    label: 'Empathy',
    weight: 25,
    description:
      'Acknowledges the customer\'s frustration or situation before problem-solving; tone matches the moment.',
  },
  {
    key: 'communication',
    label: 'Communication',
    weight: 20,
    description: 'Clear, jargon-free explanations; confirms understanding; avoids talking over the customer.',
  },
  {
    key: 'professionalism',
    label: 'Professionalism',
    weight: 15,
    description: 'Courteous throughout, even under pressure; no defensiveness, sarcasm, or dismissiveness.',
  },
  {
    key: 'process',
    label: 'Process Adherence',
    weight: 20,
    description: 'Follows required steps (verification, documentation, escalation path) for the call type.',
  },
  {
    key: 'resolution',
    label: 'Issue Resolution',
    weight: 20,
    description: 'Diagnoses the actual concern and either resolves it or sets a clear, correct next step.',
  },
];

export function bandFor(overallScore: number): string {
  if (overallScore >= 80) return 'strong';
  if (overallScore >= 40) return 'needs-improvement';
  return 'needs-intervention';
}
