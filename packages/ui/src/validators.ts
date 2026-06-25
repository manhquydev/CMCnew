/**
 * Reusable field validators for Mantine `useForm({ validate: {...} })`.
 * Each returns an error string when invalid, or `null` when OK.
 * Compose with `combine(...)` to chain rules on one field.
 */

type Validator<T = unknown> = (value: T) => string | null;

/** Field must not be empty / whitespace-only. */
export const required =
  (message = 'Không được để trống'): Validator =>
  (value) => {
    if (value === null || value === undefined) return message;
    if (typeof value === 'string' && value.trim() === '') return message;
    if (Array.isArray(value) && value.length === 0) return message;
    return null;
  };

/** Basic email shape check. */
export const email =
  (message = 'Email không hợp lệ'): Validator<string> =>
  (value) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value ?? '') ? null : message);

/** Number strictly greater than 0 (accepts numeric strings). */
export const positiveNumber =
  (message = 'Phải là số lớn hơn 0'): Validator =>
  (value) => {
    const n = typeof value === 'string' ? Number(value) : (value as number);
    return Number.isFinite(n) && n > 0 ? null : message;
  };

/** Minimum string length. */
export const minLength =
  (min: number, message = `Cần tối thiểu ${min} ký tự`): Validator<string> =>
  (value) => ((value ?? '').trim().length >= min ? null : message);

/** Run validators in order; first failure wins. */
export const combine =
  <T>(...validators: Validator<T>[]): Validator<T> =>
  (value) => {
    for (const v of validators) {
      const err = v(value);
      if (err) return err;
    }
    return null;
  };
