// Reusable facility selector (system-wide UX framework, F1b). Replaces the facility <Select>
// duplicated across 8+ admin panels with one component that standardizes the "code — name" label
// and an optional "Tất cả cơ sở" option for filter contexts. Presentation-only.

import { Select } from '@mantine/core';

export interface FacilityOption {
  id: number;
  code: string;
  name: string;
}

export interface FacilityPickerProps {
  facilities: FacilityOption[];
  value: number | null;
  onChange: (value: number | null) => void;
  label?: string;
  /** Add a "Tất cả cơ sở" option (value → null) for list/filter contexts. */
  allowAll?: boolean;
  w?: number | string;
  placeholder?: string;
  /** Disable the control (e.g. while the facility list is still loading). */
  disabled?: boolean;
  /**
   * Show a clear (X) button. Defaults to `!allowAll`. Set explicitly to `false` for
   * required-facility fields (e.g. paired with `withAsterisk`) where the value must not
   * be clearable back to empty.
   */
  clearable?: boolean;
  /** Mark the field as required (visual asterisk), matching Mantine's Select. */
  withAsterisk?: boolean;
  /** Margin bottom, matching Mantine's spacing style props (e.g. `"sm"`). */
  mb?: string | number;
}

export function FacilityPicker({
  facilities,
  value,
  onChange,
  label = 'Cơ sở',
  allowAll = false,
  w = 220,
  placeholder = 'Chọn cơ sở',
  disabled = false,
  clearable,
  withAsterisk = false,
  mb,
}: FacilityPickerProps) {
  const ALL = '__all__';
  const data = [
    ...(allowAll ? [{ value: ALL, label: 'Tất cả cơ sở' }] : []),
    ...facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` })),
  ];
  return (
    <Select
      label={label}
      withAsterisk={withAsterisk}
      data={data}
      w={w}
      mb={mb}
      placeholder={allowAll ? undefined : placeholder}
      clearable={clearable ?? !allowAll}
      disabled={disabled}
      value={value === null ? (allowAll ? ALL : null) : String(value)}
      onChange={(v) => onChange(v && v !== ALL ? Number(v) : null)}
    />
  );
}
