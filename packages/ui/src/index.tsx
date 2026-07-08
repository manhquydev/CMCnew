export { trpc, API_URL, uploadExercisePdf, uploadSessionPhoto } from './client.js';
export type { AppRouter } from './client.js';
export { useNotificationStream, type LiveNotification } from './notification-stream.js';
export { notifyError, notifySuccess, notifyInfo, errorMessage } from './notify.js';
export { required, email, positiveNumber, minLength, combine } from './validators.js';
export { PdfAnnotator, type Tool } from './pdf-annotator.js';
export type { AnnotationData, AnnotationItem } from '@cmc/api/annotation';
export { theme } from './theme.js';
export { AppProviders } from './provider.js';
export { LoginGate, useSession } from './login-gate.js';
export { LmsLoginGate, useLmsSession, type LmsPrincipal } from './lms-login-gate.js';
export { Chatter } from './chatter.js';
export { ActivityLog, type ActivityEntry, type ActivityLogProps } from './activity-log.js';
export {
  RecordDetailPanel,
  resolveOptions as recordDetailResolveOptions,
  displayValue as recordDetailDisplayValue,
  getValidationError as recordDetailGetValidationError,
  type RecordDetailConfig,
  type RecordDetailField,
  type RecordDetailFieldOption,
  type RecordDetailSection,
  type RecordDetailTab,
  type RecordDetailActivityLogConfig,
  type RecordDetailPanelProps,
  type RecordDetailHandle,
} from './record-detail.js';
export { FacilityPicker, type FacilityOption, type FacilityPickerProps } from './facility-picker.js';
export { ViewSwitcher, useViewSwitcher, type ViewMode, type ViewSwitcherProps } from './view-switcher.js';
export { FilterBar, type FilterBarProps } from './filter-bar.js';
export { toApiDate, toApiMonth, parseApiDate, parseApiMonth, fmtDate } from './date-format.js';
export { BadgeShelf } from './badge-shelf.js';
export { Leaderboard } from './leaderboard.js';
export { NotificationCenter } from './notification-center.js';
export { useStaffNotif, type StaffNotifItem } from './use-staff-notif.js';

// ─── UI primitives (screen-composition kit) ────────────────────────────────
export { PageHeader, type PageHeaderProps } from './page-header.js';
export { EmptyState, type EmptyStateProps } from './empty-state.js';
export { StatCard, type StatCardProps, type StatCardAccent } from './stat-card.js';
export {
  StatusBadge,
  type StatusBadgeProps,
  type StatusDef,
  type StatusTone,
} from './status-badge.js';
export { InitialsAvatar, initialsOf, colorOf, type InitialsAvatarProps } from './avatar-initials.js';
export {
  PipelineFunnel,
  type PipelineFunnelProps,
  type PipelineFunnelStage,
} from './pipeline-funnel.js';
export {
  DataTable,
  type DataTableProps,
  type DataTableColumn,
} from './data-table.js';
export {
  applySearch,
  applySort,
  paginate,
  pageCount,
  type SortDir,
} from './data-table-utils.js';
export {
  CalendarView,
  getWeekRange,
  getMonthGridCells,
  placeEventsInDay,
  type CalendarEvent,
  type CalendarViewMode,
  type CalendarViewProps,
  type PlacedEvent,
  type HourWindow,
} from './calendar-view.js';
export {
  WorkflowStatusbar,
  type WorkflowStatusbarProps,
  type WorkflowStage,
} from './workflow-statusbar.js';
