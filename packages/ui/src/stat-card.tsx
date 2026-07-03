import { Box, Card, Group, Skeleton, Text } from '@mantine/core';
import { IconArrowDownRight, IconArrowUpRight } from '@tabler/icons-react';
import type { ReactNode } from 'react';

/* StatCard — label + value + icon + optional delta with semantic color. Replaces
   the flat dashboard KPI cards. Zero/empty values render muted (never plain black)
   so "0" stops reading like an error, per the audit color-usage rules. */

export type StatCardAccent = 'brand' | 'ok' | 'warn' | 'danger';

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Tabler icon node, shown in a tinted corner chip. */
  icon?: ReactNode;
  /** Semantic accent for the icon chip bg/fg. Default 'brand'. */
  accent?: StatCardAccent;
  /** Delta vs previous period, e.g. "+8.2%". StatCard prepends the up/down arrow itself — pass
   *  plain text/nodes here, do not render your own trend icon (avoids a doubled icon). */
  delta?: ReactNode;
  /** Direction colors the delta and picks the arrow: up=ok, down=danger, flat=muted (no arrow). */
  deltaDir?: 'up' | 'down' | 'flat';
  /** Caption under the delta, e.g. "so với tháng trước". */
  deltaHint?: ReactNode;
  /** Render value muted (use for zero / empty states). */
  muted?: boolean;
  /** Show skeleton placeholders instead of value/delta. */
  loading?: boolean;
}

const DELTA_COLOR: Record<NonNullable<StatCardProps['deltaDir']>, string> = {
  up: 'var(--cmc-ok-text)',
  down: 'var(--cmc-danger-text)',
  flat: 'var(--cmc-text-muted)',
};

const ACCENT_CHIP: Record<StatCardAccent, { bg: string; fg: string }> = {
  brand: { bg: 'var(--cmc-brand-muted)', fg: 'var(--cmc-brand)' },
  ok: { bg: 'var(--cmc-ok-bg)', fg: 'var(--cmc-ok)' },
  warn: { bg: 'var(--cmc-warn-bg)', fg: 'var(--cmc-warn)' },
  danger: { bg: 'var(--cmc-danger-bg)', fg: 'var(--cmc-danger)' },
};

const DELTA_ARROW: Record<NonNullable<StatCardProps['deltaDir']>, typeof IconArrowUpRight | null> = {
  up: IconArrowUpRight,
  down: IconArrowDownRight,
  flat: null,
};

export function StatCard({
  label,
  value,
  icon,
  accent = 'brand',
  delta,
  deltaDir = 'flat',
  deltaHint,
  muted = false,
  loading = false,
}: StatCardProps) {
  const chip = ACCENT_CHIP[accent];
  const Arrow = DELTA_ARROW[deltaDir];

  return (
    <Card radius="sm" p="lg" withBorder style={{ borderColor: 'var(--cmc-border)' }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb={10}>
        <Text
          style={{
            fontSize: 'var(--cmc-text-xs)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--cmc-text-muted)',
            fontWeight: 600,
          }}
        >
          {label}
        </Text>
        {icon && (
          <Box
            aria-hidden
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              backgroundColor: chip.bg,
              color: chip.fg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
      </Group>

      {loading ? (
        <Skeleton height={30} width={120} radius="sm" />
      ) : (
        <Text
          fw={700}
          style={{
            fontSize: 'var(--cmc-text-3xl)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            color: muted ? 'var(--cmc-text-muted)' : 'var(--cmc-text)',
          }}
        >
          {value}
        </Text>
      )}

      {!loading && (delta || deltaHint) && (
        <Group gap={6} mt={6} wrap="nowrap">
          {delta && (
            <Group gap={2} wrap="nowrap" style={{ display: 'inline-flex' }}>
              {Arrow && <Arrow size={14} stroke={2} style={{ color: DELTA_COLOR[deltaDir] }} />}
              <Text size="xs" fw={600} style={{ color: DELTA_COLOR[deltaDir] }}>
                {delta}
              </Text>
            </Group>
          )}
          {deltaHint && (
            <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }}>
              {deltaHint}
            </Text>
          )}
        </Group>
      )}
    </Card>
  );
}
