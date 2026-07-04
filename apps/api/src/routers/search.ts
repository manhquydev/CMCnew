import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf, can } from '@cmc/auth';
import { router, protectedProcedure } from '../trpc.js';

/** Keep the top-bar dropdown scannable — no "see all results" pagination (YAGNI). */
const RESULT_LIMIT = 5;

const EMPTY_RESULT = {
  students: [] as StudentResult[],
  opportunities: [] as OpportunityResult[],
  staff: [] as StaffResult[],
  classBatches: [] as ClassBatchResult[],
};

type StudentResult = { id: string; label: string; studentCode: string; facilityId: number };
type OpportunityResult = {
  id: string;
  label: string;
  phone: string;
  stage: string;
  facilityId: number;
};
type StaffResult = { id: string; label: string; email: string };
type ClassBatchResult = { id: string; label: string; code: string; facilityId: number };

/**
 * Global top-bar search across the entities staff most often jump to. Facility isolation is
 * enforced by withRls/RLS at the Postgres session level (app_user_facility_roster,
 * facility-scoped student/opportunity/class_batch policies) — facilityId here is an optional
 * narrowing filter on top of that, never a substitute for it.
 */
export const searchRouter = router({
  global: protectedProcedure
    .input(
      z.object({
        // A search box that fires on every keystroke shouldn't error on a 1-char query —
        // short queries just return empty results below, not a 400.
        q: z.string().max(200),
        facilityId: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      if (q.length < 2) return EMPTY_RESULT;

      const facilityWhere = input.facilityId ? { facilityId: input.facilityId } : {};
      // Staff results reuse the same authorization boundary as user.list (apps/api/src/routers/user.ts)
      // — most roles (giao_vien, sale, cskh, hr, ...) cannot list co-facility staff there, so global
      // search must not open a side door to the same data. Fail-closed: no grant, no staff query.
      const canSearchStaff = can(ctx.session.roles, ctx.session.isSuperAdmin, 'user', 'list');

      return withRls(rlsContextOf(ctx.session), async (tx) => {
        const [students, opportunities, staff, classBatches] = await Promise.all([
          tx.student.findMany({
            where: {
              ...facilityWhere,
              archivedAt: null,
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { studentCode: { contains: q, mode: 'insensitive' } },
                { guardians: { some: { parent: { phone: { contains: q } } } } },
              ],
            },
            select: { id: true, fullName: true, studentCode: true, facilityId: true },
            orderBy: { fullName: 'asc' },
            take: RESULT_LIMIT,
          }),
          tx.opportunity.findMany({
            where: {
              ...facilityWhere,
              archivedAt: null,
              contact: {
                OR: [
                  { fullName: { contains: q, mode: 'insensitive' } },
                  { phone: { contains: q } },
                ],
              },
            },
            select: {
              id: true,
              stage: true,
              facilityId: true,
              contact: { select: { fullName: true, phone: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: RESULT_LIMIT,
          }),
          canSearchStaff
            ? tx.appUser.findMany({
                where: {
                  isActive: true,
                  OR: [
                    { displayName: { contains: q, mode: 'insensitive' } },
                    { email: { contains: q, mode: 'insensitive' } },
                  ],
                },
                select: { id: true, displayName: true, email: true },
                orderBy: { displayName: 'asc' },
                take: RESULT_LIMIT,
              })
            : Promise.resolve([]),
          tx.classBatch.findMany({
            where: {
              ...facilityWhere,
              archivedAt: null,
              OR: [
                { code: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            },
            select: { id: true, code: true, name: true, facilityId: true },
            orderBy: { createdAt: 'desc' },
            take: RESULT_LIMIT,
          }),
        ]);

        return {
          students: students.map((s) => ({
            id: s.id,
            label: s.fullName,
            studentCode: s.studentCode,
            facilityId: s.facilityId,
          })),
          opportunities: opportunities.map((o) => ({
            id: o.id,
            label: o.contact.fullName,
            phone: o.contact.phone,
            stage: o.stage,
            facilityId: o.facilityId,
          })),
          staff: staff.map((u) => ({ id: u.id, label: u.displayName, email: u.email })),
          classBatches: classBatches.map((c) => ({
            id: c.id,
            label: c.name,
            code: c.code,
            facilityId: c.facilityId,
          })),
        };
      });
    }),
});
