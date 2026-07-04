import { describe, it, expect } from 'vitest';
import { theme } from './theme.js';

/**
 * Locks the shadow doctrine ("Zero Elevation" remap, P1 of the ERP UI rebuild).
 *
 * Doctrine: decorative surfaces (Card, Paper, Notification) render flat — no
 * shadow, definition comes from border only. Functional floating layers
 * (Modal, Menu, Select dropdown, Drawer) keep a minimum `--cmc-shadow-sm`
 * depth-cue so they stay visually distinguishable from the page behind them.
 */

const components = theme.components as Record<string, { defaultProps?: Record<string, unknown>; styles?: unknown }>;

describe('theme shadows — decorative surfaces flattened', () => {
  it('Card has no shadow (flat, border-defined)', () => {
    expect(components.Card?.defaultProps?.shadow).toBe('none');
  });

  it('Paper has no shadow (flat, border-defined)', () => {
    expect(components.Paper?.defaultProps?.shadow).toBe('none');
  });

  it('Notification root has no shadow', () => {
    const styles = components.Notification?.styles as { root?: { boxShadow?: string } };
    expect(styles?.root?.boxShadow).toBe('none');
  });
});

describe('theme shadows — functional floating layers keep minimum depth-cue', () => {
  it('Modal content uses --cmc-shadow-sm minimum', () => {
    const styles = components.Modal?.styles as { content?: { boxShadow?: string } };
    expect(styles?.content?.boxShadow).toBe('var(--cmc-shadow-sm)');
  });

  it('Menu dropdown uses --cmc-shadow-sm minimum', () => {
    const styles = components.Menu?.styles as { dropdown?: { boxShadow?: string } };
    expect(styles?.dropdown?.boxShadow).toBe('var(--cmc-shadow-sm)');
  });

  it('Select dropdown uses --cmc-shadow-sm minimum', () => {
    const styles = components.Select?.styles as { dropdown?: { boxShadow?: string } };
    expect(styles?.dropdown?.boxShadow).toBe('var(--cmc-shadow-sm)');
  });

  it('Drawer content uses --cmc-shadow-sm minimum', () => {
    const styles = components.Drawer?.styles as { content?: { boxShadow?: string } };
    expect(styles?.content?.boxShadow).toBe('var(--cmc-shadow-sm)');
  });
});

describe('theme.shadows scale — unchanged reference scale', () => {
  it('exposes the full xs..xl scale used by the design-showcase Shadow Scale demo', () => {
    expect(theme.shadows).toEqual({
      xs: '0 1px 2px rgba(29,29,31,0.06)',
      sm: '0 1px 4px rgba(29,29,31,0.08), 0 2px 8px rgba(29,29,31,0.04)',
      md: '0 4px 16px rgba(29,29,31,0.10), 0 1px 4px rgba(29,29,31,0.06)',
      lg: '0 8px 32px rgba(29,29,31,0.12), 0 2px 8px rgba(29,29,31,0.06)',
      xl: '0 20px 60px rgba(29,29,31,0.18), 0 4px 16px rgba(29,29,31,0.08)',
    });
  });
});

/**
 * Locks the token-value corrections from the Vietnamese Enterprise Core 3
 * re-skin (P1 of `plans/260703-2351-erp-admin-reskin-core3`). Radius SCALE
 * and Zero Elevation doctrine stay untouched — only these component defaults
 * and the green swatch move to match DESIGN.md's measured values.
 */
describe('theme tokens — Core 3 re-skin corrections', () => {
  it('Card defaults to radius sm (8px, DESIGN.md "no rounded corners should exceed 8px")', () => {
    expect(components.Card?.defaultProps?.radius).toBe('sm');
  });

  it('Paper defaults to radius sm (8px), same as Card', () => {
    expect(components.Paper?.defaultProps?.radius).toBe('sm');
  });

  it('Button defaults to radius xs (4px square, not pill)', () => {
    expect(components.Button?.defaultProps?.radius).toBe('xs');
  });

  it('cmcGreen[5] matches DESIGN.md success color #06C167 (was Apple iOS #34C759)', () => {
    expect(theme.colors?.cmcGreen?.[5]).toBe('#06C167');
  });

  it('fontFamily starts with Inter (self-hosted via @fontsource/inter in admin/main.tsx)', () => {
    expect(theme.fontFamily?.startsWith("'Inter'")).toBe(true);
  });

  it('headings.fontFamily starts with Inter', () => {
    const headings = theme.headings as { fontFamily?: string } | undefined;
    expect(headings?.fontFamily?.startsWith("'Inter'")).toBe(true);
  });
});
