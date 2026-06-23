/** Pure badge-award logic. The DB enforces idempotency (@@unique(studentId, badgeId) +
 * skipDuplicates); this module only decides which badges a student's stats satisfy. Criteria
 * live as JSON on the Badge row — keep this the single place that interprets that shape. */

export type BadgeCriteria =
  | { kind: 'stars_total'; gte: number }
  | { kind: 'homework_count'; gte: number };

/** Counters a badge criterion can test, gathered at award time (e.g. on grade publish). */
export interface BadgeStats {
  starsTotal: number; // current ledger balance
  homeworkCount: number; // graded+published homework submissions
}

/** Narrow an unknown JSON value to a supported criterion, or null if it isn't one. Unknown
 * kinds never match (forward-compatible: a newer criterion simply isn't awarded by old code). */
export function parseCriteria(raw: unknown): BadgeCriteria | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const gte = c.gte;
  if (typeof gte !== 'number' || !Number.isFinite(gte)) return null;
  if (c.kind === 'stars_total') return { kind: 'stars_total', gte };
  if (c.kind === 'homework_count') return { kind: 'homework_count', gte };
  return null;
}

/** Does this stat snapshot satisfy the criterion? */
export function criteriaMet(criteria: BadgeCriteria, stats: BadgeStats): boolean {
  switch (criteria.kind) {
    case 'stars_total':
      return stats.starsTotal >= criteria.gte;
    case 'homework_count':
      return stats.homeworkCount >= criteria.gte;
  }
}

export interface BadgeLike {
  id: string;
  unlockCriteria: unknown;
}

/** Ids of badges whose criteria the stats satisfy. Badges with an unparseable/unknown criterion
 * are skipped (never auto-awarded). Already-owned badges are filtered by the caller / DB unique. */
export function evaluateBadges(badges: readonly BadgeLike[], stats: BadgeStats): string[] {
  const won: string[] = [];
  for (const b of badges) {
    const c = parseCriteria(b.unlockCriteria);
    if (c && criteriaMet(c, stats)) won.push(b.id);
  }
  return won;
}
