const VN_MOBILE = /^84\d{9}$/;

/**
 * Normalize a raw phone string to the bare login-identity format `84xxxxxxxxx`
 * (no leading `+`). Distinct from `crm.ts`'s `normalizePhone` (which emits `+84…`
 * for CRM dedupe) — do not conflate the two formats.
 */
export function normalizeLoginPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  let candidate: string;
  if (digits.startsWith('0084')) candidate = digits.slice(2);
  else if (digits.startsWith('84')) candidate = digits;
  else if (digits.startsWith('0')) candidate = '84' + digits.slice(1);
  else candidate = digits;
  return VN_MOBILE.test(candidate) ? candidate : null;
}

/** Fixed default password for the student/family LMS login (security de-scoped by decision 0032). */
export const DEFAULT_STUDENT_PASSWORD = 'Cmc2026@';

/**
 * Normalize a raw phone string to the CRM contact-dedupe format `+84xxxxxxxxx`. Distinct from
 * `normalizeLoginPhone` above (bare `84…`, no `+`) — the two formats are NOT interchangeable.
 * Canonical source per decision 0037; used to match `Contact.phone`/`Receipt.parentPhone`.
 */
export function normalizeContactPhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) return digits;
  if (digits.startsWith('84')) return '+' + digits;
  if (digits.startsWith('0')) return '+84' + digits.slice(1);
  return digits;
}
