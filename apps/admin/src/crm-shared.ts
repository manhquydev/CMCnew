// Shared CRM constants + helpers used by both the pipeline panel (crm-panel) and the
// opportunity record page (opportunity-detail). Single source of truth so stage labels,
// lost reasons, and status derivation never drift between the two surfaces.

import type { StatusTone } from '@cmc/ui';

export const STAGES = [
  { value: 'O1_LEAD', label: 'O1 · Lead' },
  { value: 'O2_CONTACTED', label: 'O2 · Đã liên hệ' },
  { value: 'O3_TEST_SCHEDULED', label: 'O3 · Đặt lịch test' },
  { value: 'O4_TESTED', label: 'O4 · Đã test' },
  { value: 'O5_ENROLLED', label: 'O5 · Nhập học' },
];

export const PROGRAMS = [
  { value: 'UCREA', label: 'UCREA' },
  { value: 'BRIGHT_IG', label: 'Bright I.G' },
  { value: 'BLACK_HOLE', label: 'Black Hole' },
];

export const LOST_REASON_OPTIONS = [
  { value: 'price', label: 'Giá' },
  { value: 'schedule', label: 'Lịch học' },
  { value: 'distance', label: 'Khoảng cách' },
  { value: 'competitor', label: 'Đối thủ' },
  { value: 'no_response', label: 'Không phản hồi' },
  { value: 'not_ready', label: 'Chưa sẵn sàng' },
  { value: 'other', label: 'Khác' },
] as const;
// Union of the literal values above — structurally identical to the server LostReason enum,
// so it satisfies tRPC's z.nativeEnum(LostReason) input without an inline cast.
export type LostReasonValue = (typeof LOST_REASON_OPTIONS)[number]['value'];

export const LOST_REASON_LABEL: Record<string, string> = Object.fromEntries(
  LOST_REASON_OPTIONS.map(({ value, label }) => [value, label]),
);

/** Minimal shape for resolving an owner id to a display name. */
export interface OwnerLike {
  id: string;
  displayName: string;
}

/**
 * Build an ownerId → display-name resolver over a known owner set (from crm.assignableOwners).
 * Falls back to a short id when the owner isn't in the set (e.g. deactivated / role-changed).
 */
export function makeOwnerName(owners: OwnerLike[]): (id: string | null) => string {
  return (id) => {
    if (!id) return '—';
    return owners.find((o) => o.id === id)?.displayName ?? `${id.slice(0, 8)}…`;
  };
}

/** Minimal shape needed to derive an opportunity's open/won/lost status. */
export interface OppStatusShape {
  lostReason: string | null;
  stage: string;
  closedAt: Date | string | null;
}

export function statusOf(o: OppStatusShape): { label: string; tone: StatusTone } {
  if (o.lostReason) return { label: 'Mất', tone: 'rejected' };
  if (o.stage === 'O5_ENROLLED' && o.closedAt) return { label: 'Thành công', tone: 'active' };
  return { label: 'Đang mở', tone: 'info' };
}

/** True when the opportunity is closed (won or lost) and therefore not editable. */
export function isClosed(o: OppStatusShape): boolean {
  return !!o.lostReason || !!(o.closedAt && o.stage === 'O5_ENROLLED');
}

/** Index of a stage in the O1→O5 order; -1 if unknown. */
export function stageIndex(stage: string): number {
  return STAGES.findIndex((s) => s.value === stage);
}
