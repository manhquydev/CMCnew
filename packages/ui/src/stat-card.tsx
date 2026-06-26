import { Box, Card, Group, Skeleton, Text } from '@mantine/core';
import type { ReactNode } from 'react';

/* StatCard — label + value + icon + optional delta with semantic color. Replaces
   the flat dashboard KPI cards. Zero/empty values render muted (never plain black)
   so "0" stops reading like an error, per the audit color-usage rules. */

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Tabler icon node, shown in a tinted corner chip. */
  icon?: ReactNode;
  /** Delta vs previous period, e.g. "+8.2%". */
  delta?: ReactNode;
  /** Direction colors the delta: up=ok, down=danger, flat=muted. */
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

export function StatCard({
  label,
  value,
  icon,
  delta,
  deltaDir = 'flat',
  deltaHint,
  muted = false,
  loading = false,
}: StatCardProps) {
  return (
    <Card radius="lg" p="lg" withBorder style={{ borderColor: 'var(--cmc-border)' }}>
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
              borderRadius: 8,
              backgroundColor: 'var(--cmc-brand-muted)',
              color: 'var(--cmc-brand)',
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
            <Text size="xs" fw={600} style={{ color: DELTA_COLOR[deltaDir] }}>
              {delta}
            </Text>
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
