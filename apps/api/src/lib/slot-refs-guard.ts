import { TRPCError } from '@trpc/server';
import { Role, type Prisma } from '@cmc/db';

/**
 * Validate that an optional schedule-slot room/teacher reference belongs to the
 * given facility before persisting it. `schedule_slot` has NO DB FK on
 * `room_id` / `teacher_id` (unlike `class_session`), so the application layer
 * is the trust boundary — the UI dropdown scoping in `class-workspace.tsx` is
 * not a substitute (a crafted request bypasses the dropdown).
 *
 * Throws BAD_REQUEST if a provided `roomId` is not an active (non-archived)
 * room in the facility, or a provided `teacherId` is not an active `giao_vien`
 * belonging to the facility. Must run inside the same transaction as
 * `scheduleSlot.create` so a rejection rolls back the whole class/slot write.
 *
 * (Review fix for commit b28af8c — the "Room choices scoped to facility" claim
 * in design.md was UI-only; this closes the backend gap. A DB FK on
 * schedule_slot is tracked as a deferred follow-up because schema.prisma is
 * mid-flight with the uncommitted shift-registration feature.)
 */
export async function assertSlotRefsInFacility(
  tx: Prisma.TransactionClient,
  facilityId: number,
  refs: { roomId?: string; teacherId?: string },
): Promise<void> {
  const { roomId, teacherId } = refs;
  if (roomId) {
    const room = await tx.room.findFirst({
      where: { id: roomId, facilityId, archivedAt: null },
      select: { id: true },
    });
    if (!room) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Phòng học không thuộc cơ sở này hoặc không tồn tại',
      });
    }
  }
  if (teacherId) {
    const teacher = await tx.appUser.findFirst({
      where: {
        id: teacherId,
        isActive: true,
        roles: { has: Role.giao_vien },
        facilities: { some: { facilityId } },
      },
      select: { id: true },
    });
    if (!teacher) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Giáo viên không thuộc cơ sở này, không hoạt động, hoặc không phải giáo viên',
      });
    }
  }
}
