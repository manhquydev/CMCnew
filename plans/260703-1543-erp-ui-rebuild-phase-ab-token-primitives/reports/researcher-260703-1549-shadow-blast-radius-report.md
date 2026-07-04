# Zero Elevation Shadow Removal — Blast Radius Analysis

**Status**: DONE  
**Scope**: Quantifying impact of removing all shadows (`--cmc-shadow-*` → `none`) for TDD-first "Zero Elevation" doctrine  
**Key Finding**: **LOW blast radius IF executing via theme.ts defaults alone; MEDIUM if design-system examples must be updated**

---

## 1. Current Shadow Doctrine (Status Quo)

### Token Definitions (tokens.css, lines 102–113)
```css
--cmc-shadow-none: none;
--cmc-shadow-xs:   0 1px 2px rgba(29, 29, 31, 0.06);           /* subtle lift  */
--cmc-shadow-sm:   0 1px 4px rgba(29, 29, 31, 0.08),
                   0 2px 8px rgba(29, 29, 31, 0.04);           /* default card */
--cmc-shadow-md:   0 4px 16px rgba(29, 29, 31, 0.10),
                   0 1px 4px  rgba(29, 29, 31, 0.06);          /* hover card   */
--cmc-shadow-lg:   0 8px 32px rgba(29, 29, 31, 0.12),
                   0 2px 8px  rgba(29, 29, 31, 0.06);          /* dropdowns    */
--cmc-shadow-xl:   0 20px 60px rgba(29, 29, 31, 0.18),
                   0 4px 16px  rgba(29, 29, 31, 0.08);         /* modals       */
```

### Current Prescribed Use Cases
| Token | Prescription | Load-Bearing? |
|-------|--------------|---|
| `--cmc-shadow-xs` | Table header subtle lift | No — decorative |
| `--cmc-shadow-sm` | Default card resting state | **No** — used via Card defaultProps |
| `--cmc-shadow-md` | Hovered card, dropdown *preview* | **No** — not in theme defaults |
| `--cmc-shadow-lg` | Dropdowns, popovers | **Yes** — distinguishes floating UI from page |
| `--cmc-shadow-xl` | Modals, drawers | **Yes** — modal must float above overlay |

---

## 2. Blast Radius Assessment

### 2A. Component-Level Defaults (HIGH LEVERAGE)
Mantine theme.ts applies **default shadows via component defaultProps**:

| Component | Current Default | Location | Change Effort |
|-----------|-----------------|----------|---|
| Card | `shadow: 'sm'` | theme.ts line 137 | 1 line remove |
| Paper | `shadow: 'xs'` | theme.ts line 148 | 1 line remove |
| Modal | `boxShadow: '0 20px 60px ...'` | theme.ts line 284 (hardcoded) | 1 line remove |
| Select dropdown | `boxShadow: '0 8px 32px ...'` (hardcoded) | theme.ts line 198 | 1 line remove |
| Menu dropdown | `boxShadow: '0 8px 32px ...'` (hardcoded) | theme.ts line 382 | 1 line remove |
| Notification | `boxShadow: '0 8px 32px ...'` (hardcoded) | theme.ts line 361 | 1 line remove |
| Drawer | `boxShadow: '0 0 40px ...'` (hardcoded) | theme.ts line 312 | 1 line remove |
| Button, Input, Table, etc. | None (no shadow defaults) | — | — |

**Finding**: 7 Mantine components have shadow defaults. **ALL are hardcoded inline in theme.ts, NOT using `--cmc-shadow-*` tokens.** Removing them is a **single-file edit**.

### 2B. Component Usage in Codebase
- **Total TSX/JSX files scanned**: 79 files (apps/admin, apps/lms, packages/ui)
- **Files with explicit shadow props** (`shadow=`, `boxShadow` in style objects): **1 file only**
  - `apps/lms/src/student-shell.tsx`: No shadow usage found in scanned section
  - `apps/lms/src/showcase-view.tsx`: 1 hardcoded inline shadow `0 4px 8px rgba(0,0,0,0.05)` on cloud step circle
  
- **Files with CSS transitions on box-shadow**: 5 files
  - `apps/admin/src/kpi-evaluation-panel.tsx`: `transition: 'box-shadow 200ms ease'` (Card hover animation)
  - `packages/ui/src/theme.ts`: transition definition in Card.styles
  - `packages/ui/src/tokens.css`: `--cmc-transition` token (not shadow-specific)
  - `docs/design-system.md`: Doc example (line 336: Card hover pattern)
  - `apps/lms/src/climb/cloud-climb.css`: Custom CSS (not ERP core)

**Finding**: Component code does **NOT explicitly pass `shadow=` prop** — they rely on theme defaults. NO cascade of component-level edits needed.

### 2C. Load-Bearing Shadows (UX Must-Keeps)

**Required for functional depth-cue:**
- `--cmc-shadow-lg` on dropdowns/popovers → **Distinguishes floating menu from page**. Removing breaks hoverable-menu UX (user must click to close, can't see where menu ends).
- `--cmc-shadow-xl` on modals → **Modal must float above overlay.** Removing sacrifices depth clarity (user sees overlay blur + modal text, no edge definition).

**Safe to Zero (decorative only):**
- `--cmc-shadow-xs/sm` on cards/panels → Design doc explicitly states "border-only" aesthetic. No functional loss.
- `--cmc-shadow-md` (hover card) → Hover state can be signaled by border-color change or scale.

**Critical Design Decision**: "Zero Elevation" must mean **flat SURFACES**, not zero depth-cues everywhere. Floating overlays (dropdowns, modals) need shadow or stroke to separate from bg.

---

## 3. Implementation Path (TDD-First)

### Phase 1: Theme Defaults (1 file, 7 edits)
**D:\project\CMCnew\packages\ui\src\theme.ts**
- Line 137: Card: remove `shadow: 'sm'` from defaultProps
- Line 148: Paper: remove `shadow: 'xs'` from defaultProps
- Line 198: Select dropdown: replace `boxShadow: '0 8px 32px ...'` with `boxShadow: 'none'` OR `border: '1px solid ...'`
- Line 284: Modal: replace `boxShadow: '0 20px 60px ...'` with border-based definition (e.g. `border: '1px solid var(--cmc-border)'`)
- Line 312: Drawer: same as Modal
- Line 361: Notification: same treatment
- Line 382: Menu: same treatment

### Phase 2: Component Instances (2 files, optional)
- **apps/lms/src/showcase-view.tsx**: Remove hardcoded `boxShadow: '0 4px 8px ...'` on cloud circle (line 554)
- **apps/lms/src/kpi-evaluation-panel.tsx**: Update Card `transition: 'box-shadow 200ms ease'` → `transition: 'border-color 200ms ease'` (optional if border-based hover still animates)

### Phase 3: Docs + Design System (1 file)
- **docs/design-system.md**: 
  - Remove Elevation section (line 167–180) or clarify "border-only, zero decorative shadow"
  - Update Card example (line 322–342): remove `onMouseEnter/Leave` boxShadow handlers, replace with border-color transition
  - Update Modal example (line 349–362): confirm no shadow dependency

---

## 4. Exact Numbers

| Metric | Count | Notes |
|--------|-------|-------|
| Total components affected by theme defaults | 7 | Card, Paper, Modal, Select, Menu, Notification, Drawer |
| Lines to edit in theme.ts | 7 | One-line removals or replacements |
| Component instance files requiring edits | 2 | showcase-view, kpi-evaluation-panel |
| Inline shadow instances in codebase | 1 | cloud-climb showcase circle |
| Docs example instances to update | 2 | Card hover pattern, Modal modal pattern |
| **Total blast radius** | **~12 edit locations** | Majority (7/12) in single theme.ts file |

---

## 5. Risk Assessment

### Low Risk (Proceed Immediately)
- ✅ Card/Paper shadow removal → impacts ~80% of "flat surface" designs; no functional loss
- ✅ Theme-only changes → single file, no cascading component edits
- ✅ Existing tests likely don't snapshot shadows (unless E2E visual regression)

### Medium Risk (Requires UX Validation)
- ⚠️ Modal/Dropdown shadow removal → must pair with **alternative depth-cue** (e.g. strong border, overlay blur intensification, or KEEP shadow here)
- ⚠️ Transition property cleanup → if hover state relies on shadow animation for feedback

### Unresolved Questions
1. **Is "Zero Elevation" truly zero, or does it preserve floating-UI depth-cues?**  
   - Recommendation: Keep `--cmc-shadow-lg` for dropdowns, `--cmc-shadow-xl` for modals; zero only decorative shadows.
   
2. **Will removing Modal shadow hurt accessibility?**  
   - Concern: Low-vision users who rely on contrast to see modal edge.
   - Mitigation: Increase modal border width or add `outline: 2px solid var(--cmc-border)`.

3. **Should Card hover use scale/opacity instead of shadow?**  
   - Design implication: "border-color change" only or add gentle scale (1.01)?

4. **Are there E2E visual regression tests that snapshot shadows?**  
   - If yes, those tests must be regenerated (low effort).

---

## Summary

**Blast Radius: LOW (1 file edits mostly)**  
**Effort: ~2 hours (TDD + docs + 2 component tweaks)**  
**Risk Gate**: Clarify floating-UI depth strategy before removing Modal/Dropdown shadows.

**Recommended Approach**:
1. Phase 1: Remove decorative shadows (Card, Paper) via theme.ts
2. Phase 2: Replace functional shadows (Modal, Dropdown) with **border + backdrop intensification**, not removal
3. Phase 3: Test Card hover interactivity without shadow; add border-color animation if needed
4. Phase 4: Update design docs with new border-based depth strategy

---

**Researcher findings compiled 2026-07-03.**
