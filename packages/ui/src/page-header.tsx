import { Box, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';

/* PageHeader — fixed page scaffold top: title + subtitle + actions zone,
   with an optional inline stat strip. Replaces the lone <Text size="xl"> titles
   that float with inconsistent padding across screens. */

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned primary/secondary action buttons. */
  actions?: ReactNode;
  /** Optional control row rendered under the title (filters, segmented control). */
  children?: ReactNode;
}

export function PageHeader({ title, subtitle, actions, children }: PageHeaderProps) {
  return (
    <Box mb="xl">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Box style={{ minWidth: 0 }}>
          <Text
            component="h1"
            fw={700}
            style={{
              fontSize: 'var(--cmc-text-2xl)',
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
              color: 'var(--cmc-text)',
              margin: 0,
            }}
          >
            {title}
          </Text>
          {subtitle && (
            <Text size="sm" mt={4} style={{ color: 'var(--cmc-text-muted)' }}>
              {subtitle}
            </Text>
          )}
        </Box>
        {actions && (
          <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
            {actions}
          </Group>
        )}
      </Group>
      {children && <Box mt="md">{children}</Box>}
    </Box>
  );
}
