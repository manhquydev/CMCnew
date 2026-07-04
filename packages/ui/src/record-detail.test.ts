import { describe, it, expect } from 'vitest';
import { resolveOptions, displayValue, getValidationError, applyFieldChange } from './record-detail.js';

describe('resolveOptions', () => {
  const staticOptions = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];

  it('returns [] when options is undefined', () => {
    expect(resolveOptions(undefined, {})).toEqual([]);
  });

  it('returns the static array as-is', () => {
    expect(resolveOptions(staticOptions, {})).toEqual(staticOptions);
  });

  it('calls the dynamic resolver with the live form data (e.g. primaryRole depends on roles)', () => {
    const dynamic = (data: Record<string, unknown>) =>
      (data.roles as string[]).map((r) => ({ value: r, label: r.toUpperCase() }));
    expect(resolveOptions(dynamic, { roles: ['teacher', 'hr'] })).toEqual([
      { value: 'teacher', label: 'TEACHER' },
      { value: 'hr', label: 'HR' },
    ]);
  });
});

describe('displayValue', () => {
  it('shows an em-dash for null/undefined/empty values', () => {
    expect(displayValue({ type: 'text' }, null, [])).toBe('—');
    expect(displayValue({ type: 'text' }, undefined, [])).toBe('—');
    expect(displayValue({ type: 'text' }, '', [])).toBe('—');
  });

  it('formats switch as Có/Không', () => {
    expect(displayValue({ type: 'switch' }, true, [])).toBe('Có');
    expect(displayValue({ type: 'switch' }, false, [])).toBe('Không');
  });

  it('resolves select value to its option label', () => {
    const options = [{ value: 'super_admin', label: 'Quản trị viên' }];
    expect(displayValue({ type: 'select' }, 'super_admin', options)).toBe('Quản trị viên');
  });

  it('falls back to the raw value when a select option is unmapped', () => {
    expect(displayValue({ type: 'select' }, 'unknown_role', [])).toBe('unknown_role');
  });

  it('joins multiselect values through their labels', () => {
    const options = [{ value: '1', label: 'Cơ sở A' }, { value: '2', label: 'Cơ sở B' }];
    expect(displayValue({ type: 'multiselect' }, ['1', '2'], options)).toBe('Cơ sở A, Cơ sở B');
  });

  it('stringifies other types directly', () => {
    expect(displayValue({ type: 'text' }, 'hello', [])).toBe('hello');
    expect(displayValue({ type: 'date' }, '2026-07-01', [])).toBe('2026-07-01');
  });
});

describe('getValidationError — cross-field Save gating', () => {
  it('returns null when config has no validate()', () => {
    expect(getValidationError({}, { roles: [] })).toBeNull();
  });

  it('surfaces the cross-field error (e.g. staff-profile roleEditInvalid) to gate Save', () => {
    const config = {
      validate: (data: Record<string, unknown>) => {
        const roles = data.roles as string[];
        if (roles.length === 0) return 'Phải có ít nhất một vai trò';
        if (!data.primaryRole) return 'Chọn vai trò chính';
        return null;
      },
    };
    expect(getValidationError(config, { roles: [], primaryRole: null })).toBe('Phải có ít nhất một vai trò');
    expect(getValidationError(config, { roles: ['teacher'], primaryRole: null })).toBe('Chọn vai trò chính');
    expect(getValidationError(config, { roles: ['teacher'], primaryRole: 'teacher' })).toBeNull();
  });
});

describe('applyFieldChange — onFieldChange cross-field side effects', () => {
  it('returns the post-edit data unchanged when no onFieldChange is given', () => {
    const next = { roles: ['teacher'], primaryRole: 'teacher' };
    expect(applyFieldChange(next)).toEqual(next);
  });

  it('returns the post-edit data unchanged when onFieldChange returns void', () => {
    const next = { roles: ['teacher', 'hr'], primaryRole: 'teacher' };
    expect(applyFieldChange(next, () => undefined)).toEqual(next);
  });

  it('merges a returned partial patch on top of the post-edit data (e.g. clearing primaryRole)', () => {
    const next = { roles: ['hr'], primaryRole: 'teacher' };
    const clearPrimaryRoleIfDropped = (data: Record<string, unknown>) => {
      const roles = data.roles as string[];
      if (data.primaryRole && !roles.includes(data.primaryRole as string)) return { primaryRole: null };
    };
    expect(applyFieldChange(next, clearPrimaryRoleIfDropped)).toEqual({ roles: ['hr'], primaryRole: null });
  });

  it('leaves primaryRole intact when it is still among the selected roles', () => {
    const next = { roles: ['hr', 'teacher'], primaryRole: 'teacher' };
    const clearPrimaryRoleIfDropped = (data: Record<string, unknown>) => {
      const roles = data.roles as string[];
      if (data.primaryRole && !roles.includes(data.primaryRole as string)) return { primaryRole: null };
    };
    expect(applyFieldChange(next, clearPrimaryRoleIfDropped)).toEqual(next);
  });
});
