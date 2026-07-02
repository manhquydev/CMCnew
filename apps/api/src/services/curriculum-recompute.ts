import type { Prisma } from '@cmc/db';
import { assignUnitsToSessions } from '@cmc/domain-academic';

export interface RecomputeCurriculumResult {
  mappedCount: number;
  overflowCount: number;
  uncoveredUnits: number;
}

/**
 * Recomputes curriculumUnitId for every non-cancelled, non-makeup session in a class batch,
 * ordered by (sessionDate, startTime). Always recomputes the WHOLE batch (not just new
 * sessions) so it stays correct even when a slot is added at an earlier weekday and the
 * date order shifts — see schedule.generateSessions and schedule.editSlot(applyToFuture).
 * Returns null when the batch's course has no curriculum units (nothing to map).
 */
export async function recomputeCurriculumMapping(
  tx: Prisma.TransactionClient,
  classBatchId: string,
  courseId: string,
): Promise<RecomputeCurriculumResult | null> {
  const units = await tx.curriculumUnit.findMany({
    where: { courseId },
    orderBy: { orderGlobal: 'asc' },
    select: { id: true, sessions: true },
  });
  if (units.length === 0) return null;

  const sessions = await tx.classSession.findMany({
    where: { classBatchId, status: { not: 'cancelled' }, isMakeup: false },
    orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
    select: { id: true },
  });

  const { mapping, mappedCount, overflowCount, uncoveredUnits } = assignUnitsToSessions(
    units,
    sessions.map((s) => s.id),
  );
  for (const [sessionId, unitId] of mapping) {
    await tx.classSession.update({ where: { id: sessionId }, data: { curriculumUnitId: unitId } });
  }
  return { mappedCount, overflowCount, uncoveredUnits };
}
