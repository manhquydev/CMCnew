import { TRPCError } from '@trpc/server';
import { Role, type RequestSession } from '@cmc/auth';

export function canManageAllTeaching(actor: RequestSession): boolean {
  return actor.isSuperAdmin || actor.roles.includes(Role.giam_doc_dao_tao);
}

export function assertTeachingSessionMutationAllowed(
  actor: RequestSession,
  session: { facilityId: number; teacherId: string | null | undefined },
): void {
  if (!actor.isSuperAdmin && !actor.facilityIds.includes(session.facilityId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền thao tác buổi học ngoài cơ sở của bạn' });
  }
  if (canManageAllTeaching(actor)) return;
  if (actor.roles.includes(Role.giao_vien) && session.teacherId === actor.userId) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Giáo viên chỉ được thao tác buổi học được phân công' });
}

export function assertTeachingOwnershipFound(owned: boolean): void {
  if (owned) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Giáo viên chỉ được chấm bài của lớp được phân công' });
}
