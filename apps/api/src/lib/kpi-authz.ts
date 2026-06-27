import { Role } from '../trpc.js';

/** KPI override authority follows the management tree (decision 0011): a person's direct manager
 *  and anyone above them may adjust their KPI; nobody adjusts their own. v1 approximates the tree
 *  from roles + facility scope (no explicit reporting-line yet):
 *   - super_admin / bgd: above everyone in the facility.
 *   - quan_ly: above all non-management staff (not bgd / other quan_ly).
 *   - head_teacher: above teachers only.
 *  RLS already constrains both parties to the same facility, so this only decides rank. */
const TOP_ROLES: Role[] = [Role.super_admin, Role.bgd, Role.quan_ly, Role.head_teacher];

export interface KpiActor {
  userId: string;
  roles: Role[];
  isSuperAdmin: boolean;
}

export function canOverrideKpi(actor: KpiActor, targetUserId: string, targetRoles: Role[]): boolean {
  if (actor.userId === targetUserId) return false; // never override your own KPI
  if (actor.isSuperAdmin || actor.roles.includes(Role.super_admin)) return true;
  if (actor.roles.includes(Role.bgd)) return true; // top of the facility tree
  if (actor.roles.includes(Role.quan_ly)) {
    // Above everyone except bgd / quan_ly / super.
    return !targetRoles.some((r) => r === Role.bgd || r === Role.quan_ly || r === Role.super_admin);
  }
  if (actor.roles.includes(Role.head_teacher)) {
    // Above teachers only; not other managers.
    return targetRoles.includes(Role.giao_vien) && !targetRoles.some((r) => TOP_ROLES.includes(r));
  }
  return false;
}
