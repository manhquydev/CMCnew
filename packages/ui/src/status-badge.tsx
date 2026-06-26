import { Badge, Box, Group } from '@mantine/core';
import type { ReactNode } from 'react';

/* StatusBadge — single source of truth mapping a domain status string to a
   semantic color + dot + human label. Reuses the existing --cmc-status-* tokens
   and Mantine status color tuples (cmcGreen/cmcAmber/cmcRed/cmcGray) from theme.ts. */

export type StatusTone = 'active' | 'pending' | 'inactive' | 'rejected' | 'draft' | 'info';

type ToneStyle = { color: string; dot: string };

const TONE: Record<StatusTone, ToneStyle> = {
  active: { color: 'cmcGreen', dot: 'var(--cmc-status-active)' },
  pending: { color: 'cmcAmber', dot: 'var(--cmc-status-pending)' },
  inactive: { color: 'cmcGray', dot: 'var(--cmc-status-inactive)' },
  rejected: { color: 'cmcRed', dot: 'var(--cmc-status-rejected)' },
  draft: { color: 'cmcGray', dot: 'var(--cmc-status-draft)' },
  info: { color: 'cmc', dot: 'var(--cmc-brand)' },
};

export type StatusDef = { label: string; tone: StatusTone };

export interface StatusBadgeProps {
  /** Resolved label + tone, or a raw status looked up in `map`. */
  status: string;
  /** Optional lookup table: raw status -> { label, tone }. */
  map?: Record<string, StatusDef>;
  /** Override label directly (skips map lookup). */
  label?: ReactNode;
  /** Override tone directly (skips map lookup). */
  tone?: StatusTone;
  /** Show the leading status dot. Default true. */
  withDot?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export function StatusBadge({
  status,
  map,
  label,
  tone,
  withDot = true,
  size = 'sm',
}: StatusBadgeProps) {
  const def = map?.[status];
  const resolvedTone: StatusTone = tone ?? def?.tone ?? 'inactive';
  const resolvedLabel: ReactNode = label ?? def?.label ?? status;
  const style = TONE[resolvedTone];

  return (
    <Group gap={6} wrap="nowrap" style={{ display: 'inline-flex', alignItems: 'center' }}>
      {withDot && (
        <Box
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: style.dot,
            flexShrink: 0,
          }}
        />
      )}
      <Badge color={style.color} variant="light" radius="xl" size={size}>
        {resolvedLabel}
      </Badge>
    </Group>
  );
}
