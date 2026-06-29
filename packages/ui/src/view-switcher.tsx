// View-mode switcher + persistence hook (system-wide UX framework, F2). Lets a module offer
// list / kanban / calendar views and remembers the user's last choice per key (localStorage),
// seeded from the per-entity default. Presentation + tiny state only; the module renders the
// actual views.

import { useState } from 'react';
import { SegmentedControl } from '@mantine/core';

export type ViewMode = 'list' | 'kanban' | 'calendar' | 'form';

const LABELS: Record<ViewMode, string> = {
  list: 'Danh sách',
  kanban: 'Kanban',
  calendar: 'Lịch',
  form: 'Chi tiết',
};

/** Persist the active view per storageKey; default applies on first use. */
export function useViewSwitcher(storageKey: string, defaultView: ViewMode, allowed: ViewMode[]) {
  const [view, setViewState] = useState<ViewMode>(() => {
    if (typeof localStorage === 'undefined') return defaultView;
    const saved = localStorage.getItem(`view:${storageKey}`) as ViewMode | null;
    return saved && allowed.includes(saved) ? saved : defaultView;
  });
  const setView = (v: ViewMode) => {
    setViewState(v);
    try { localStorage.setItem(`view:${storageKey}`, v); } catch { /* ignore quota/private mode */ }
  };
  return { view, setView };
}

export interface ViewSwitcherProps {
  value: ViewMode;
  allowed: ViewMode[];
  onChange: (v: ViewMode) => void;
}

export function ViewSwitcher({ value, allowed, onChange }: ViewSwitcherProps) {
  if (allowed.length < 2) return null; // nothing to switch
  return (
    <SegmentedControl
      size="xs"
      value={value}
      onChange={(v) => onChange(v as ViewMode)}
      data={allowed.map((m) => ({ value: m, label: LABELS[m] }))}
    />
  );
}
