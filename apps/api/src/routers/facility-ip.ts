import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requirePermission } from '../trpc.js';

// A facility's WiFi allow-list should describe one site's local network, not an
// arbitrary internet range. /0-/15 would match a large share of all IPv4 addresses,
// silently turning "restrict check-in to this facility" into "allow check-in from
// anywhere" — reject those instead of letting a fat-fingered entry disable the
// manual-approval fraud control (see check-in-out.ts ipMatchesCidr).
const MIN_CIDR_BITS = 16;

function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

const ipAddressSchema = z.string().min(1).superRefine((val, ctx) => {
  const [ip, bitsStr] = val.split('/');
  if (!ip || !isValidIPv4(ip)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Địa chỉ IP không hợp lệ (dạng x.x.x.x)' });
    return;
  }
  if (bitsStr === undefined) return;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Subnet mask (/bits) không hợp lệ, phải từ 0-32' });
    return;
  }
  if (bits < MIN_CIDR_BITS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Dải IP quá rộng — tối thiểu /${MIN_CIDR_BITS}` });
  }
});

export const facilityNetworkRouter = router({
  list: requirePermission('facilityNetwork', 'list')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.facilityNetwork.findMany({
          where: { facilityId: input.facilityId, archivedAt: null },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ),

  create: requirePermission('facilityNetwork', 'create')
    .input(z.object({
      facilityId: z.number().int().positive(),
      ipAddress: ipAddressSchema,
      label: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const net = await tx.facilityNetwork.create({
          data: {
            facilityId: input.facilityId,
            ipAddress: input.ipAddress,
            label: input.label,
          },
        });
        await logEvent(tx, {
          facilityId: net.facilityId,
          entityType: 'facility_network',
          entityId: net.id,
          type: 'created',
          body: `Thêm IP: ${input.ipAddress}${input.label ? ' (' + input.label + ')' : ''}`,
          actorId: ctx.session.userId,
        });
        return net;
      }),
    ),

  delete: requirePermission('facilityNetwork', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const net = await tx.facilityNetwork.findUniqueOrThrow({ where: { id: input.id } });
        await tx.facilityNetwork.update({
          where: { id: input.id },
          data: { archivedAt: new Date(), isActive: false },
        });
        await logEvent(tx, {
          facilityId: net.facilityId,
          entityType: 'facility_network',
          entityId: net.id,
          type: 'archived',
          body: `Xóa IP: ${net.ipAddress}`,
          actorId: ctx.session.userId,
        });
        return { ok: true };
      }),
    ),
});
