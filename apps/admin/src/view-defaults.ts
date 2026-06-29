// Per-entity view-mode registry (system-wide UX framework, F1b). Mirrors Odoo's "default view per
// action": each module declares which view modes it supports and which opens by default. The
// ViewSwitcher (F2) reads this so every list lands on a sensible default (kanban for pipelines,
// calendar for time-based, list for ledgers) without per-panel hardcoding.

export type ViewMode = 'list' | 'kanban' | 'calendar' | 'form';

export interface ViewConfig {
  default: ViewMode;
  allowed: ViewMode[];
}

export const VIEW_DEFAULTS: Record<string, ViewConfig> = {
  opportunity: { default: 'kanban', allowed: ['kanban', 'list'] },
  testAppointment: { default: 'calendar', allowed: ['calendar', 'list'] },
  receipt: { default: 'list', allowed: ['list', 'kanban'] },
  scheduleSession: { default: 'calendar', allowed: ['calendar', 'list'] },
  parentMeeting: { default: 'calendar', allowed: ['calendar', 'list'] },
  attendance: { default: 'calendar', allowed: ['calendar', 'list'] },
  payslip: { default: 'list', allowed: ['list', 'kanban'] },
  student: { default: 'list', allowed: ['list', 'kanban'] },
};

export function getDefaultView(entity: string): ViewMode {
  return VIEW_DEFAULTS[entity]?.default ?? 'list';
}

export function getAllowedViews(entity: string): ViewMode[] {
  return VIEW_DEFAULTS[entity]?.allowed ?? ['list'];
}
