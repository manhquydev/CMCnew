// Generic record-detail primitive (P2 of the ERP UI rebuild) — generalizes the
// sheet(Fieldsets)+Tabs+right-rail-ActivityLog shape shipped in
// apps/admin/src/staff-profile.tsx so any entity page can compose it from config
// instead of re-writing the layout. Scope (FIX #4, red-team-corrected 2026-07-03):
// this component owns ONLY the sheet+tabs+activity-rail region (staff-profile.tsx
// ~415-525) — the page header (back button, title, inactive badge, edit-toggle
// button, reset-password modal, ~486-516) stays caller-owned entirely; no
// back-button/header prop exists here (post-review cleanup — an earlier draft
// kept a dead `onBack` prop that rendered nothing, removed).
//
// Save/Hủy placement (user-confirmed 2026-07-03): the primitive does NOT render
// its own Save button — the caller's header owns Save/Hủy (matches
// staff-profile.tsx's current layout). RecordDetailPanel exposes an imperative
// handle via `ref` (`{ save, isDirty, validationError }`) so a caller-owned
// header button can trigger save and read live form-validity without the
// primitive needing to render any body-level action UI itself.

import { forwardRef, useEffect, useImperativeHandle, useState, type ComponentType, type ReactNode } from 'react';
import {
  Fieldset,
  Group,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import { ActivityLog, type ActivityEntry } from './activity-log.js';
import { notifyError } from './notify.js';
import { useSession } from './login-gate.js';

// Session shape as resolved by `useSession()` — not exported from login-gate.tsx,
// so derive it from the hook's return type rather than duplicating the shape.
type Session = ReturnType<typeof useSession>['me'];

export interface RecordDetailFieldOption {
  value: string;
  label: string;
}

export interface RecordDetailField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'select' | 'multiselect' | 'switch' | 'date' | 'number';
  /** Static list, or a function of the live form `data` for dependent option sets
   * (e.g. primaryRole options depend on the currently-selected roles). */
  options?: RecordDetailFieldOption[] | ((data: Record<string, unknown>) => RecordDetailFieldOption[]);
  readOnly?: boolean;
  /** Custom read-mode display (e.g. a Badge shelf). Edit-mode input is still
   * driven by `type` — `render` only overrides the read-only presentation. */
  render?: (value: unknown, data: Record<string, unknown>) => ReactNode;
  validate?: (value: unknown) => string | null;
  /** Side-effect hook fired after this field's value changes, given the new full
   * form data — lets a caller express cross-field auto-corrections (e.g.
   * clearing primaryRole when it's no longer in the selected roles) without the
   * primitive needing field-specific business logic. Return a partial patch to
   * merge into form data, or void/undefined for no further change. */
  onFieldChange?: (data: Record<string, unknown>) => Record<string, unknown> | void;
}

export interface RecordDetailSection {
  name: string;
  fields: RecordDetailField[];
  permission?: (session: Session) => boolean;
}

export interface RecordDetailTab {
  value: string;
  label: string;
  permission?: (session: Session) => boolean;
  component: ComponentType<{ data: unknown }>;
}

export interface RecordDetailActivityLogConfig {
  fetchEndpoint: (entityId: string) => Promise<ActivityEntry[]>;
  fieldLabels: Record<string, string>;
  formatValue?: (field: string, value: unknown) => string;
  title?: string;
}

export interface RecordDetailConfig {
  entityType: string;
  entityId: string | number;
  /** Current field values, keyed by field `key`. */
  data: Record<string, unknown>;
  sections: RecordDetailSection[];
  tabs: RecordDetailTab[];
  /** Presence-only: caller omits this from the config entirely when a session
   * shouldn't see the activity rail (FIX #6) — the primitive does not re-check
   * session permissions for it. */
  activityLog?: RecordDetailActivityLogConfig;
  /** Record-level cross-field validation (e.g. staff-profile's roleEditInvalid).
   * Gates whether Save is clickable; caller still owns which mutations fire. */
  validate?: (data: Record<string, unknown>) => string | null;
  /** Caller-managed: primitive hands back the full current form `data`; caller
   * diffs and decides how many mutation calls to fire. */
  onSave?: (data: Record<string, unknown>) => Promise<void>;
  canRead?: (session: Session) => boolean;
  canEdit?: (session: Session) => boolean;
}

export interface RecordDetailPanelProps {
  config: RecordDetailConfig;
  refreshKey?: number;
  /** Entity-wide edit-mode toggle is caller-owned (FIX #5) — this only reflects it. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Fires whenever the primitive's internal reactive state (busy/isDirty/
   * validationError/data) changes, so a caller-owned header can re-render its
   * own Save button (ref reads alone don't trigger re-renders — this callback
   * does). Optional; omitting it means the caller accepts non-live header state. */
  onStateChange?: (state: Pick<RecordDetailHandle, 'busy' | 'isDirty' | 'validationError' | 'data'>) => void;
}

/** Imperative handle for a caller-owned header Save/Hủy button. */
export interface RecordDetailHandle {
  save: () => Promise<void>;
  isDirty: boolean;
  validationError: string | null;
  busy: boolean;
  /** Current live form data — lets a caller-owned header read values (e.g. for its
   * own additional guard checks) without duplicating form state. */
  data: Record<string, unknown>;
}

// ─── Pure helpers (exported for unit testing — no component-render tests in
// this package, see packages/ui/vitest.config.ts) ────────────────────────────

export function resolveOptions(
  options: RecordDetailField['options'],
  data: Record<string, unknown>,
): RecordDetailFieldOption[] {
  if (!options) return [];
  return typeof options === 'function' ? options(data) : options;
}

export function displayValue(
  field: Pick<RecordDetailField, 'type'>,
  value: unknown,
  options: RecordDetailFieldOption[],
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'switch') return value ? 'Có' : 'Không';
  if (field.type === 'multiselect' && Array.isArray(value)) {
    return value.map((v) => options.find((o) => o.value === String(v))?.label ?? String(v)).join(', ');
  }
  if (field.type === 'select') {
    return options.find((o) => o.value === String(value))?.label ?? String(value);
  }
  return String(value);
}

/** Cross-field validation gate — drives Save-button disabled + inline banner. */
export function getValidationError(
  config: Pick<RecordDetailConfig, 'validate'>,
  data: Record<string, unknown>,
): string | null {
  return config.validate ? config.validate(data) : null;
}

/** Applies a field's `onFieldChange` side effect to the post-edit form data,
 * merging any returned partial patch on top (e.g. auto-clearing primaryRole
 * when it falls out of the newly-selected roles). */
export function applyFieldChange(
  next: Record<string, unknown>,
  onFieldChange?: RecordDetailField['onFieldChange'],
): Record<string, unknown> {
  const patch = onFieldChange?.(next);
  return patch ? { ...next, ...patch } : next;
}

// ─── Field input (edit mode: type-driven control; read mode: render() or a
// generic label/value row matching staff-profile.tsx's `Field` helper) ────────

function RecordDetailFieldInput({
  field,
  value,
  data,
  editing,
  error,
  onChange,
}: {
  field: RecordDetailField;
  value: unknown;
  data: Record<string, unknown>;
  editing: boolean;
  error?: string | null;
  onChange: (value: unknown) => void;
}) {
  const effectiveReadOnly = field.readOnly === true || !editing;
  const options = resolveOptions(field.options, data);

  if (effectiveReadOnly) {
    const content = field.render ? field.render(value, data) : displayValue(field, value, options);
    return (
      <Group wrap="nowrap" gap="md" align="center">
        <Text
          size="sm"
          style={{
            width: 'var(--cmc-form-label-w)',
            minWidth: 'var(--cmc-form-label-w)',
            flexShrink: 0,
            textAlign: 'right',
            fontSize: 'var(--cmc-form-label-font)',
            color: 'var(--cmc-form-label-color)',
          }}
        >
          {field.label}
        </Text>
        <Text size="sm" style={{ flex: 1, minWidth: 0 }}>{content}</Text>
      </Group>
    );
  }

  switch (field.type) {
    case 'select':
      return (
        <Select
          label={field.label}
          data={options}
          value={value == null ? null : String(value)}
          onChange={(v) => onChange(v)}
          error={error}
        />
      );
    case 'multiselect':
      return (
        <MultiSelect
          label={field.label}
          data={options}
          value={Array.isArray(value) ? value.map(String) : []}
          onChange={onChange}
          error={error}
        />
      );
    case 'switch':
      return (
        <Switch
          label={field.label}
          checked={!!value}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    case 'date':
      return (
        <TextInput
          label={field.label}
          type="date"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.currentTarget.value)}
          error={error}
        />
      );
    case 'email':
      return (
        <TextInput
          label={field.label}
          type="email"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.currentTarget.value)}
          error={error}
        />
      );
    case 'number':
      return (
        <TextInput
          label={field.label}
          type="number"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
          error={error}
        />
      );
    default:
      return (
        <TextInput
          label={field.label}
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.currentTarget.value)}
          error={error}
        />
      );
  }
}

// ─── Main panel: sheet(Fieldsets)+Tabs, sticky ActivityLog rail when configured ─

export const RecordDetailPanel = forwardRef<RecordDetailHandle, RecordDetailPanelProps>(function RecordDetailPanel(
  { config, refreshKey, editing, onEditingChange, onStateChange },
  ref,
) {
  const { me } = useSession();
  const canRead = config.canRead ? config.canRead(me) : true;
  const canEdit = config.canEdit ? config.canEdit(me) : true;
  const isEditing = !!editing && canEdit;

  // Reset form state on entityId change (switch-record intent), NOT on config.data
  // identity — callers routinely construct `config` inline in JSX, giving `data` a
  // fresh object identity on every render. Keying off identity would silently
  // discard in-progress edits on any unrelated parent re-render (post-review fix).
  const [formData, setFormData] = useState<Record<string, unknown>>(config.data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setFormData(config.data), [config.entityId]);

  const [busy, setBusy] = useState(false);

  const [logEntries, setLogEntries] = useState<ActivityEntry[]>([]);
  const [logLoading, setLogLoading] = useState(!!config.activityLog);
  useEffect(() => {
    if (!config.activityLog) return;
    const al = config.activityLog;
    setLogLoading(true);
    al.fetchEndpoint(String(config.entityId))
      .then(setLogEntries)
      .catch((e: unknown) => notifyError(e, 'Không tải được nhật ký'))
      .finally(() => setLogLoading(false));
  }, [config.activityLog, config.entityId, refreshKey]);

  const validationError = getValidationError(config, formData);
  const isDirty = JSON.stringify(formData) !== JSON.stringify(config.data);

  function setField(key: string, value: unknown, onFieldChange?: RecordDetailField['onFieldChange']) {
    setFormData((prev) => applyFieldChange({ ...prev, [key]: value }, onFieldChange));
  }

  async function handleSave() {
    if (validationError || !config.onSave) return;
    setBusy(true);
    try {
      await config.onSave(formData);
      onEditingChange?.(false);
    } catch (e) {
      notifyError(e, 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }

  // Hook order must stay unconditional (Rules of Hooks) — this runs before the
  // `!canRead` early return below, not after. handleSave/isDirty are recomputed
  // from formData/config/validationError every render, already covered below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({ save: handleSave, isDirty, validationError, busy, data: formData }), [
    formData, config.data, validationError, busy,
  ]);

  // Ref mutation alone doesn't trigger the caller's re-render — this callback lets
  // a caller-owned header react to busy/isDirty/validationError/data changes (e.g.
  // to enable/disable its own Save button).
  useEffect(() => {
    onStateChange?.({ busy, isDirty, validationError, data: formData });
  }, [busy, isDirty, validationError, formData, onStateChange]);

  if (!canRead) {
    return <Text size="sm" c="dimmed">Bạn không có quyền xem bản ghi này.</Text>;
  }

  const visibleSections = config.sections.filter((s) => !s.permission || s.permission(me));
  const visibleTabs = config.tabs.filter((t) => !t.permission || t.permission(me));

  const sheet = (
    <Stack>
      {visibleSections.map((section) => (
        <Fieldset
          key={section.name}
          legend={
            <Group gap="xs" wrap="nowrap" align="center">
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 4,
                  height: 20,
                  borderRadius: 2,
                  background: 'var(--cmc-brand)',
                }}
              />
              <Text
                fw={600}
                style={{ fontSize: 'var(--cmc-form-group-title)', color: 'var(--cmc-text)' }}
              >
                {section.name}
              </Text>
            </Group>
          }
        >
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {section.fields.map((field) => (
              <RecordDetailFieldInput
                key={field.key}
                field={field}
                value={formData[field.key]}
                data={formData}
                editing={isEditing}
                error={field.validate ? field.validate(formData[field.key]) : null}
                onChange={(v) => setField(field.key, v, field.onFieldChange)}
              />
            ))}
          </SimpleGrid>
        </Fieldset>
      ))}

      {visibleTabs.length > 0 && (
        <Tabs defaultValue={visibleTabs[0]?.value} variant="outline">
          <Tabs.List>
            {visibleTabs.map((tab) => (
              <Tabs.Tab key={tab.value} value={tab.value}>{tab.label}</Tabs.Tab>
            ))}
          </Tabs.List>
          {visibleTabs.map((tab) => (
            <Tabs.Panel key={tab.value} value={tab.value} pt="md">
              <tab.component data={formData} />
            </Tabs.Panel>
          ))}
        </Tabs>
      )}
    </Stack>
  );

  if (!config.activityLog) return sheet;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 480px', minWidth: 0 }}>{sheet}</div>
      <div
        style={{
          flex: `0 1 var(--cmc-chatter-w)`,
          width: 'var(--cmc-chatter-w)',
          maxWidth: '100%',
          position: 'sticky',
          top: 12,
        }}
      >
        <ActivityLog
          entries={logEntries}
          loading={logLoading}
          fieldLabels={config.activityLog.fieldLabels}
          formatValue={config.activityLog.formatValue}
          title={config.activityLog.title}
        />
      </div>
    </div>
  );
});
