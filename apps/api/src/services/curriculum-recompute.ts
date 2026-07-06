import type { Prisma } from '@cmc/db';
export interface RecomputeCurriculumResult {
  mappedCount: number;
  overflowCount: number;
  uncoveredUnits: number;
}

/**
 * Recomputes curriculumUnitId/curriculumLessonId for every non-cancelled, non-makeup session in a class batch,
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
    select: {
      id: true,
      sessions: true,
      lessons: {
        orderBy: { seqInUnit: 'asc' },
        select: { id: true },
      },
    },
  });
  if (units.length === 0) return null;

  const sessions = await tx.classSession.findMany({
    where: { classBatchId, status: { not: 'cancelled' }, isMakeup: false },
    orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
    select: { id: true },
  });

  const slots: { unitId: string; lessonId: string | null }[] = [];
  for (const unit of units) {
    const count = Math.max(unit.sessions, 1);
    for (let i = 0; i < count; i++) {
      slots.push({ unitId: unit.id, lessonId: unit.lessons[i]?.id ?? null });
    }
  }

  let mappedCount = 0;
  const assignedUnitIds = new Set<string>();
  for (let i = 0; i < sessions.length; i++) {
    const slot = slots[i] ?? null;
    if (slot) {
      mappedCount++;
      assignedUnitIds.add(slot.unitId);
    }
    await tx.classSession.update({
      where: { id: sessions[i]!.id },
      data: {
        curriculumUnitId: slot?.unitId ?? null,
        curriculumLessonId: slot?.lessonId ?? null,
      },
    });
  }
  const overflowCount = Math.max(0, sessions.length - slots.length);
  const uncoveredUnits = units.filter((u) => !assignedUnitIds.has(u.id)).length;

  return { mappedCount, overflowCount, uncoveredUnits };
}
