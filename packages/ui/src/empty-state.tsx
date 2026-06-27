import { Box, Stack, Text } from '@mantine/core';
import { IconInbox } from '@tabler/icons-react';
import type { ReactNode } from 'react';

/* EmptyState — icon + headline + one-line guidance + optional CTA. Replaces every
   bare grey "Chưa có …" sentence. Highest-ROI primitive per the audit. Also serves
   the error variant (tone="danger") so lists can show a friendly retry surface. */

export interface EmptyStateProps {
  /** Tabler icon node (e.g. <IconUsers size={28} />). Defaults to an inbox glyph. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary CTA / retry button. */
  action?: ReactNode;
  /** Visual tone of the icon halo. 'danger' for error surfaces. */
  tone?: 'brand' | 'neutral' | 'danger';
  /** Vertical padding. Default 'lg'. */
  py?: number | string;
}

const HALO: Record<NonNullable<EmptyStateProps['tone']>, { bg: string; fg: string }> = {
  brand: { bg: 'var(--cmc-brand-muted)', fg: 'var(--cmc-brand)' },
  neutral: { bg: 'var(--cmc-surface-2)', fg: 'var(--cmc-text-muted)' },
  danger: { bg: 'var(--cmc-danger-bg)', fg: 'var(--cmc-danger-text)' },
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  py = 48,
}: EmptyStateProps) {
  const halo = HALO[tone];
  return (
    <Stack align="center" gap={14} py={py} px="md" style={{ textAlign: 'center' }}>
      <Box
        aria-hidden
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          backgroundColor: halo.bg,
          color: halo.fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon ?? <IconInbox size={28} stroke={1.5} />}
      </Box>
      <Text fw={600} style={{ fontSize: 'var(--cmc-text-lg)', color: 'var(--cmc-text)' }}>
        {title}
      </Text>
      {description && (
        <Text size="sm" maw={360} style={{ color: 'var(--cmc-text-muted)' }}>
          {description}
        </Text>
      )}
      {action && <Box mt={4}>{action}</Box>}
    </Stack>
  );
}
