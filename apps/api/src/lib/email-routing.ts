export type EmailTransport = 'graph' | 'brevo';

// External recipients (parents/guardians) go via Brevo; internal staff (@STAFF_EMAIL_DOMAIN) via
// Graph. When STAFF_EMAIL_DOMAIN is unset the whole feature is single-transport → default to graph
// so current behavior is preserved (no accidental brevo routing on an unconfigured box).
export function decideTransport(to: string): EmailTransport {
  const domain = process.env.STAFF_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!domain) return 'graph';
  const isStaff = to.trim().toLowerCase().endsWith(`@${domain}`);
  return isStaff ? 'graph' : 'brevo';
}

// Cheap format guard — not full RFC5322 validation, just enough to fail fast on an obviously
// malformed address (no '@', empty) at enqueue time instead of burning a 5-attempt retry cycle
// against whichever transport it happens to route to.
export function isValidEmailFormat(to: string): boolean {
  const trimmed = to.trim();
  return trimmed.length > 3 && trimmed.includes('@') && !trimmed.startsWith('@') && !trimmed.endsWith('@');
}
