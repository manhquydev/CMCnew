// Filter/toolbar layout primitive (system-wide UX framework, F2). A consistent bar that lays out
// a module's filter controls on the left and an actions slot (e.g. <ViewSwitcher/>) on the right,
// wrapping responsively. Layout-only — modules own their filter state; a richer saved-filter engine
// is deferred to a later phase.

import type { ReactNode } from 'react';
import { Card, Group } from '@mantine/core';

export interface FilterBarProps {
  /** Filter controls (search, selects, facility picker, …). */
  children?: ReactNode;
  /** Right-aligned actions, typically a <ViewSwitcher/>. */
  right?: ReactNode;
}

export function FilterBar({ children, right }: FilterBarProps) {
  return (
    <Card withBorder p="xs">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="wrap">{children}</Group>
        {right && <Group gap="sm">{right}</Group>}
      </Group>
    </Card>
  );
}
