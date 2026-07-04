import {
  createTheme,
  type MantineColorsTuple,
  type MantineThemeOverride,
} from '@mantine/core';

/* ─── Brand color scale (10-stop, #0071E3 at index 6) ──────────────────────
   Aligned with Apple's interactive blue. Mantine uses index 6 as primary.   */
const cmc: MantineColorsTuple = [
  '#E8F1FC', // 0 — tinted bg, selected row
  '#D0E4FA', // 1
  '#A3C8F5', // 2
  '#72ACEF', // 3
  '#4494E9', // 4
  '#1C7EE6', // 5
  '#0071E3', // 6 — primary (Apple blue)
  '#005DC0', // 7 — hover
  '#0055C6', // 8 — pressed
  '#003D99', // 9 — darkest, text on tinted bg
];

/* ─── Status colors (single-stop tuples for Mantine badge colors) ─────────  */
const cmcGreen: MantineColorsTuple = [
  '#F0FBF3','#D8F4E0','#AEEABD','#7FDE97','#58D275',
  '#06C167', // 5 — Vietnamese Enterprise Core success (was Apple iOS #34C759)
  '#05A358', // 6 — hover/pressed, adjusted to stay coherent with new 5
  '#1A7A34','#105523','#083314',
];

const cmcAmber: MantineColorsTuple = [
  '#FFF8EC','#FFEECB','#FFD98A','#FFC34A','#FFB01A',
  '#FF9F0A', // 5
  '#CC7F00','#995F00','#664000','#332000',
];

const cmcRed: MantineColorsTuple = [
  '#FFF0EF','#FFD9D6','#FFB3AE','#FF8C84','#FF665C',
  '#FF3B30', // 5
  '#CC2F26','#99231C','#661712','#330B09',
];

const cmcGray: MantineColorsTuple = [
  '#F9F9FB','#F2F2F5','#E4E4E9','#D2D2D7','#BCBCC2',
  '#AEAEB2', // 5 — tertiary text
  '#8E8E93','#6E6E73','#3C3C43','#1D1D1F',
];

export const theme: MantineThemeOverride = createTheme({
  /* ─── Colors ──────────────────────────────────────────────────────────── */
  primaryColor: 'cmc',
  colors: { cmc, cmcGreen, cmcAmber, cmcRed, cmcGray },

  /* ─── Typography ─────────────────────────────────────────────────────── */
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif",
  fontFamilyMonospace:
    "'SF Mono', 'Cascadia Code', 'Fira Code', 'Courier New', monospace",

  /* Apple-adapted scale for ERP density */
  fontSizes: {
    xs:   '11px',
    sm:   '13px',
    md:   '15px',
    lg:   '17px',
    xl:   '20px',
  },

  lineHeights: {
    xs:   '1.4',
    sm:   '1.4',
    md:   '1.6',
    lg:   '1.5',
    xl:   '1.35',
  },

  headings: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '28px', lineHeight: '1.25', fontWeight: '700' },
      h2: { fontSize: '22px', lineHeight: '1.3',  fontWeight: '600' },
      h3: { fontSize: '18px', lineHeight: '1.35', fontWeight: '600' },
      h4: { fontSize: '15px', lineHeight: '1.4',  fontWeight: '600' },
      h5: { fontSize: '13px', lineHeight: '1.4',  fontWeight: '600' },
      h6: { fontSize: '11px', lineHeight: '1.4',  fontWeight: '600' },
    },
  },

  /* ─── Shape ──────────────────────────────────────────────────────────── */
  defaultRadius: 'md',
  radius: {
    xs:   '4px',
    sm:   '8px',
    md:   '10px',
    lg:   '14px',
    xl:   '18px',
  },

  /* ─── Spacing ────────────────────────────────────────────────────────── */
  spacing: {
    xs:  '4px',
    sm:  '8px',
    md:  '12px',
    lg:  '16px',
    xl:  '24px',
  },

  /* ─── Shadows — Zero Elevation: decorative surfaces (Card/Paper/Notification) flat,
     functional floating layers (Modal/Menu/Select/Drawer, sm minimum) keep depth-cue ── */
  shadows: {
    xs: '0 1px 2px rgba(29,29,31,0.06)',
    sm: '0 1px 4px rgba(29,29,31,0.08), 0 2px 8px rgba(29,29,31,0.04)',
    md: '0 4px 16px rgba(29,29,31,0.10), 0 1px 4px rgba(29,29,31,0.06)',
    lg: '0 8px 32px rgba(29,29,31,0.12), 0 2px 8px rgba(29,29,31,0.06)',
    xl: '0 20px 60px rgba(29,29,31,0.18), 0 4px 16px rgba(29,29,31,0.08)',
  },

  /* ─── Component Overrides ────────────────────────────────────────────── */
  components: {

    /* Button — square 4px radius, DESIGN.md literal spec (was pill) */
    Button: {
      defaultProps: { radius: 'xs' },
      styles: {
        root: {
          fontWeight: 500,
          letterSpacing: '-0.01em',
          transition: 'background-color 150ms ease, opacity 150ms ease',
          '&[data-variant="filled"]:not([data-disabled]):hover': {
            backgroundColor: 'var(--cmc-brand-hover)',
          },
        },
      },
    },

    /* Card — flat surface (Zero Elevation: decorative, no shadow), radius ≤8px */
    Card: {
      defaultProps: { radius: 'sm', shadow: 'none', withBorder: true },
      styles: {
        root: {
          backgroundColor: 'var(--cmc-surface)',
          transition: 'box-shadow 200ms ease',
        },
      },
    },

    /* Paper — same flat treatment (Zero Elevation: decorative, no shadow) */
    Paper: {
      defaultProps: { radius: 'sm', shadow: 'none', withBorder: true },
      styles: {
        root: {
          backgroundColor: 'var(--cmc-surface)',
        },
      },
    },

    /* TextInput / Input — Apple input style */
    TextInput: {
      defaultProps: { radius: 'md' },
      styles: {
        input: {
          fontSize: '15px',
          border: '1px solid var(--cmc-border)',
          backgroundColor: 'var(--cmc-surface)',
          color: 'var(--cmc-text)',
          transition: 'border-color 150ms ease',
          '&:focus': { borderColor: 'var(--cmc-brand)' },
          '&::placeholder': { color: 'var(--cmc-text-faint)' },
        },
        label: {
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--cmc-text-2)',
          marginBottom: '4px',
        },
      },
    },

    /* Select — same as TextInput */
    Select: {
      defaultProps: { radius: 'md' },
      styles: {
        input: {
          fontSize: '15px',
          border: '1px solid var(--cmc-border)',
          backgroundColor: 'var(--cmc-surface)',
          color: 'var(--cmc-text)',
          '&:focus': { borderColor: 'var(--cmc-brand)' },
        },
        label: {
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--cmc-text-2)',
          marginBottom: '4px',
        },
        dropdown: {
          border: '1px solid var(--cmc-border)',
          borderRadius: '10px',
          boxShadow: 'var(--cmc-shadow-sm)',
        },
        option: {
          fontSize: '15px',
          borderRadius: '6px',
          '&[data-selected]': {
            backgroundColor: 'var(--cmc-brand)',
          },
          '&[data-hovered]': {
            backgroundColor: 'var(--cmc-brand-muted)',
            color: 'var(--cmc-text)',
          },
        },
      },
    },

    /* Textarea */
    Textarea: {
      defaultProps: { radius: 'md' },
      styles: {
        input: {
          fontSize: '15px',
          border: '1px solid var(--cmc-border)',
          backgroundColor: 'var(--cmc-surface)',
          '&:focus': { borderColor: 'var(--cmc-brand)' },
        },
        label: {
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--cmc-text-2)',
          marginBottom: '4px',
        },
      },
    },

    /* Table — data-dense but breathable, alternating rows */
    Table: {
      defaultProps: { striped: true, highlightOnHover: true, withTableBorder: false },
      styles: {
        table: {
          fontSize: '13px',
          borderCollapse: 'separate',
          borderSpacing: 0,
        },
        th: {
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--cmc-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          padding: '10px 12px',
          borderBottom: '1px solid var(--cmc-border)',
          backgroundColor: 'var(--cmc-bg)',
        },
        td: {
          padding: '10px 12px',
          color: 'var(--cmc-text)',
          borderBottom: '1px solid var(--cmc-border-faint)',
          verticalAlign: 'middle',
        },
        tr: {
          '&[data-striped]': { backgroundColor: 'var(--cmc-surface-2)' },
          '&[data-hover]:hover': { backgroundColor: 'var(--cmc-brand-muted)' },
        },
      },
    },

    /* Badge — status chips with Apple semantic colors */
    Badge: {
      defaultProps: { radius: 'xl', size: 'sm' },
      styles: {
        root: {
          fontWeight: 500,
          letterSpacing: '0.01em',
          textTransform: 'none',
          fontSize: '11px',
        },
      },
    },

    /* Modal — floating layer, Zero Elevation minimum depth-cue */
    Modal: {
      defaultProps: { radius: 'xl', centered: true },
      styles: {
        content: {
          backgroundColor: 'var(--cmc-surface)',
          boxShadow: 'var(--cmc-shadow-sm)',
          border: '1px solid var(--cmc-border)',
        },
        header: {
          backgroundColor: 'var(--cmc-surface)',
          borderBottom: '1px solid var(--cmc-border-faint)',
          padding: '20px 24px 16px',
        },
        title: {
          fontSize: '17px',
          fontWeight: 600,
          color: 'var(--cmc-text)',
        },
        body: {
          padding: '20px 24px 24px',
        },
        overlay: {
          backdropFilter: 'blur(4px)',
        },
      },
    },

    /* Drawer — sidebar-style panels, Zero Elevation minimum depth-cue */
    Drawer: {
      defaultProps: { radius: 0 },
      styles: {
        content: {
          backgroundColor: 'var(--cmc-surface)',
          boxShadow: 'var(--cmc-shadow-sm)',
        },
        header: {
          backgroundColor: 'var(--cmc-surface)',
          borderBottom: '1px solid var(--cmc-border-faint)',
          padding: '20px 24px',
        },
        title: {
          fontSize: '17px',
          fontWeight: 600,
          color: 'var(--cmc-text)',
        },
        body: {
          padding: '20px 24px',
        },
      },
    },

    /* Tabs — clean underline style */
    Tabs: {
      defaultProps: { variant: 'default' },
      styles: {
        tab: {
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--cmc-text-muted)',
          border: 'none',
          borderBottom: '2px solid transparent',
          padding: '8px 16px',
          transition: 'color 150ms ease, border-color 150ms ease',
          '&[data-active]': {
            color: 'var(--cmc-brand)',
            borderBottomColor: 'var(--cmc-brand)',
            backgroundColor: 'transparent',
          },
          '&:hover:not([data-active])': {
            color: 'var(--cmc-text)',
            backgroundColor: 'var(--cmc-bg)',
          },
        },
      },
    },

    /* Notification — bottom-right toast (Zero Elevation: decorative, no shadow) */
    Notification: {
      defaultProps: { radius: 'lg' },
      styles: {
        root: {
          border: '1px solid var(--cmc-border)',
          boxShadow: 'none',
          backgroundColor: 'var(--cmc-surface)',
        },
        title: {
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--cmc-text)',
        },
        description: {
          fontSize: '13px',
          color: 'var(--cmc-text-muted)',
        },
      },
    },

    /* Menu dropdown — floating layer, Zero Elevation minimum depth-cue */
    Menu: {
      styles: {
        dropdown: {
          border: '1px solid var(--cmc-border)',
          borderRadius: '12px',
          boxShadow: 'var(--cmc-shadow-sm)',
          backgroundColor: 'var(--cmc-surface)',
          padding: '4px',
        },
        item: {
          fontSize: '14px',
          borderRadius: '8px',
          color: 'var(--cmc-text)',
          '&:hover': {
            backgroundColor: 'var(--cmc-bg)',
          },
          '&[data-danger]': {
            color: 'var(--cmc-danger-text)',
            '&:hover': { backgroundColor: 'var(--cmc-danger-bg)' },
          },
        },
        divider: {
          borderColor: 'var(--cmc-border-faint)',
          margin: '4px 0',
        },
      },
    },

    /* Tooltip */
    Tooltip: {
      defaultProps: { radius: 'sm' },
      styles: {
        tooltip: {
          fontSize: '12px',
          backgroundColor: 'var(--cmc-text)',
          color: 'var(--cmc-surface)',
          padding: '6px 10px',
        },
      },
    },

    /* Breadcrumbs */
    Breadcrumbs: {
      styles: {
        breadcrumb: {
          fontSize: '13px',
          color: 'var(--cmc-text-muted)',
          '&:last-child': { color: 'var(--cmc-text)', fontWeight: 500 },
        },
        separator: { color: 'var(--cmc-border)' },
      },
    },

    /* Loader — use brand blue */
    Loader: {
      defaultProps: { color: 'cmc' },
    },

    /* Progress */
    Progress: {
      defaultProps: { radius: 'xl' },
      styles: {
        root: { backgroundColor: 'var(--cmc-border-faint)' },
      },
    },

    /* NavLink — sidebar navigation item */
    NavLink: {
      styles: {
        root: {
          borderRadius: '10px',
          marginBottom: '2px',
          fontSize: '14px',
          fontWeight: 400,
          '&[data-active]': {
            backgroundColor: 'var(--cmc-brand-muted)',
            color: 'var(--cmc-brand-hover)',
            fontWeight: 500,
          },
          '&:hover:not([data-active])': {
            backgroundColor: 'var(--cmc-surface-2)',
          },
        },
      },
    },

    /* Checkbox */
    Checkbox: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          cursor: 'pointer',
          '&:checked': { backgroundColor: 'var(--cmc-brand)', borderColor: 'var(--cmc-brand)' },
        },
        label: { fontSize: '14px', color: 'var(--cmc-text-2)' },
      },
    },

    /* Switch */
    Switch: {
      styles: {
        track: {
          cursor: 'pointer',
          '&[data-checked]': { backgroundColor: 'var(--cmc-brand)', borderColor: 'var(--cmc-brand)' },
        },
        label: { fontSize: '14px', color: 'var(--cmc-text-2)' },
      },
    },
  },
});
