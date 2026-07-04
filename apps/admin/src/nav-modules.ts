import { buildNavGroups, type SectionKey } from './shell.js';

export { firstVisibleSubtab } from './shell.js';

// Section→module membership is role-invariant: `buildNavGroups`'s `items[]` arrays are the
// same set of keys on every call regardless of `roles`/`isSuperAdmin` — only each item's
// `visible` boolean changes. So we derive the membership map once from a single call, keeping
// `buildNavGroups` the single source of truth for grouping/order/icon/label (no hand-authored
// `MODULES.subtabs` list — a second source of truth a presence-guard couldn't fully police).
const ALL_GROUPS = buildNavGroups({ roles: [], isSuperAdmin: false });

const SECTION_TO_MODULE = new Map<SectionKey, string>();
// A plain Map assignment would silently swallow a section placed in two groups (the second
// write wins) — track duplicate membership explicitly so the derivation guard can assert
// "exactly one module", not just "at least one".
const DUPLICATE_MEMBERSHIP: SectionKey[] = [];
for (const group of ALL_GROUPS) {
  for (const item of group.items) {
    if (SECTION_TO_MODULE.has(item.key)) DUPLICATE_MEMBERSHIP.push(item.key);
    SECTION_TO_MODULE.set(item.key, group.key);
  }
}

/** Module slug containing `section`, or null for sections outside the rail (e.g. `profile`). */
export function moduleOf(section: SectionKey): string | null {
  return SECTION_TO_MODULE.get(section) ?? null;
}

/** Every section key that isn't reachable through a module (currently only `profile`, reached
 *  via the avatar menu). Used by the derivation-completeness guard test. */
export function sectionsWithoutModule(allSectionKeys: readonly SectionKey[]): SectionKey[] {
  return allSectionKeys.filter((k) => !SECTION_TO_MODULE.has(k));
}

/** Section keys that appear in more than one `buildNavGroups` group — should always be empty.
 *  Used by the derivation guard to assert membership is non-overlapping, not just total. */
export function sectionsWithDuplicateModule(): SectionKey[] {
  return DUPLICATE_MEMBERSHIP;
}
