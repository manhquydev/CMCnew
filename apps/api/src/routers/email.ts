import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requirePermission } from '../trpc.js';
import { SECRET_KINDS } from '../services/email-outbox.js';
import type { EmailTemplateKind } from '../services/email-templates.js';

const EMAIL_STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped'] as const;

export const emailRouter = router({
  // Read-only outbox surface. RLS admits any staff to facility-null rows (system emails like
  // welcome/OTP carry cross-facility PII in toAddress), so an EXPLICIT app-layer filter hides
  // those rows from a non-director caller — do not rely on RLS alone for this guarantee.
  // Never returns bodyHtml (secrets/PII must not travel in the list payload).
  outboxList: requirePermission('email', 'outboxList')
    .input(
      z
        .object({
          status: z.enum(EMAIL_STATUSES).optional(),
          facilityId: z.number().int().positive().optional(),
          cursor: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const isDirector =
          ctx.session.isSuperAdmin || ctx.session.roles.includes('giam_doc_kinh_doanh');
        const rows = await tx.emailOutbox.findMany({
          where: {
            ...(input?.status ? { status: input.status } : {}),
            ...(input?.facilityId ? { facilityId: input.facilityId } : {}),
            // App-layer guard: only a director/super-admin may see facility-null system rows.
            ...(isDirector ? {} : { facilityId: { not: null } }),
          },
          select: {
            id: true,
            facilityId: true,
            toAddress: true,
            templateKind: true,
            subject: true,
            status: true,
            attempts: true,
            lastError: true,
            scheduledFor: true,
            sentAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        });
        return rows.map((r) => ({
          ...r,
          isSecret: SECRET_KINDS.has(r.templateKind as EmailTemplateKind),
        }));
      }),
    ),

  // Reset a failed row to queued so the cron worker drains it next tick. Rows carrying a
  // one-time secret (OTP / temp password) are blocked UNCONDITIONALLY, regardless of whether the
  // body was scrubbed on failure — scrubbing only happens on terminal transitions, so a row that
  // predates the scrub, or failed via a code path that skipped it, could still hold a live secret.
  // The operator must use the original provisioning flow's "re-issue" action to mint a fresh one.
  outboxRetry: requirePermission('email', 'outboxRetry')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const row = await tx.emailOutbox.findUniqueOrThrow({ where: { id: input.id } });
        if (row.status !== 'failed') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Chỉ gửi lại được email ở trạng thái thất bại',
          });
        }
        if (SECRET_KINDS.has(row.templateKind as EmailTemplateKind)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Email chứa bí mật không thể gửi lại; hãy dùng "Cấp lại" để phát hành lại tài khoản',
          });
        }
        const updated = await tx.emailOutbox.update({
          where: { id: row.id },
          data: { status: 'queued', attempts: 0, lastError: null, scheduledFor: new Date() },
        });
        await logEvent(tx, {
          facilityId: row.facilityId,
          entityType: 'email_outbox',
          entityId: row.id,
          type: 'status_changed',
          body: `Gửi lại email "${row.templateKind}" tới ${row.toAddress}`,
          actorId: ctx.session.userId,
        });
        return updated;
      }),
    ),
});
