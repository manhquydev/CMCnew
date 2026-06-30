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
}

export function FacilityPicker({
  facilities,
  value,
  onChange,
  label = 'Cơ sở',
  allowAll = false,
  w = 220,
  placeholder = 'Chọn cơ sở',
}: FacilityPickerProps) {
  const ALL = '__all__';
  const data = [
    ...(allowAll ? [{ value: ALL, label: 'Tất cả cơ sở' }] : []),
    ...facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` })),
  ];
  return (
    <Select
      label={label}
      data={data}
      w={w}
      placeholder={allowAll ? undefined : placeholder}
      clearable={!allowAll}
      value={value === null ? (allowAll ? ALL : null) : String(value)}
      onChange={(v) => onChange(v && v !== ALL ? Number(v) : null)}
    />
  );
}
