import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { compensationParamsSchema, DEFAULT_PARAMS, type CompensationParams } from '@cmc/domain-payroll';
import { router, requireRole, superAdminProcedure, Role } from '../trpc.js';

/** Last calendar day of a YYYY-MM period — the cutoff for "policy effective at this period". */
function periodEnd(periodKey: string): Date {
  const [y, m] = periodKey.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0));
}

/** Pick the params of the CompensationPolicy effective at a period (latest effectiveFrom ≤ period
 *  end), falling back to DEFAULT_PARAMS when no version covers it. Used by payslip compute so policy
 *  edits apply forward only. RLS allows any staff to read; tx must be an RLS tx. */
export async function effectiveParamsAt(
  tx: Parameters<Parameters<typeof withRls>[1]>[0],
  periodKey: string,
): Promise<CompensationParams> {
  const row = await tx.compensationPolicy.findFirst({
    where: { archivedAt: null, effectiveFrom: { lte: periodEnd(periodKey) } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!row) return DEFAULT_PARAMS;
  const parsed = compensationParamsSchema.safeParse(row.params);
  return parsed.success ? parsed.data : DEFAULT_PARAMS;
}

// Compensation policy = company-wide income-structure config. Editing is super_admin-only; reading
// the effective version is allowed for HR/accounting (to preview/compute). Edits are effective-dated
// → they apply to future periods only; finalized payslips keep their frozen numbers.
export const compensationRouter = router({
  // All policy versions (newest first) — super_admin only.
  list: superAdminProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.compensationPolicy.findMany({ where: { archivedAt: null }, orderBy: { effectiveFrom: 'desc' }, take: 100 }),
    ),
  ),

  // The params effective at a period (or DEFAULT_PARAMS if none). HR/ke_toan/super may read.
  effective: requireRole(Role.hr, Role.ke_toan)
    .input(z.object({ periodKey: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) => effectiveParamsAt(tx, input.periodKey)),
    ),

  // The current DEFAULT seed params (for the editor to start from / reset). super_admin only.
  defaults: superAdminProcedure.query(() => DEFAULT_PARAMS),

  // Create a new effective-dated policy version (validated). super_admin only.
  create: superAdminProcedure
    .input(
      z.object({
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        params: compensationParamsSchema,
        note: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const policy = await tx.compensationPolicy.create({
          data: {
            effectiveFrom: new Date(input.effectiveFrom),
            params: input.params,
            note: input.note,
            createdById: ctx.session.userId,
          },
        });
        await logEvent(tx, { entityType: 'compensation_policy', entityId: policy.id, type: 'created', body: `Chính sách thu nhập hiệu lực ${input.effectiveFrom}`, actorId: ctx.session.userId });
        return policy;
      }),
    ),
});
