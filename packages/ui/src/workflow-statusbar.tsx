import type { CSSProperties } from 'react';

/* WorkflowStatusbar — Odoo-style chevron progress bar. Consecutive right-pointing arrow
   segments in one horizontal row: the current stage is a solid brand-blue "you are here",
   prior stages a filled blue tint, future stages a faint grey. Off-path terminal states
   (e.g. cancelled) render as a separate red chip AFTER the flow, never inside the arrow
   chain — so a dead-end status reads as off-path, not as "the last step you reached".

   Pure/stateless, no hooks, no Mantine dependency (plain elements + token-driven inline
   styles). Display-only by default; pass `onStageClick` to make each flow segment a native
   <button> (keyboard-reachable, focus-ring, hover brighten). */

export interface WorkflowStage {
  value: string;
  label: string;
}

export interface WorkflowStatusbarProps {
  /** The happy-path sequence, in order. */
  stages: WorkflowStage[];
  /** Current status value. */
  current: string;
  /** Off-path terminals, e.g. [{ value: 'cancelled', label: 'Đã hủy' }]. */
  terminal?: WorkflowStage[];
  /** Omit => display-only (segments render as <div>, not <button>). */
  onStageClick?: (value: string) => void;
  /** 'sm' (default) => 12px / 26px; 'md' => 13px / 30px. */
  size?: 'sm' | 'md';
  /** Root aria-label. Default 'Tiến trình'. */
  ariaLabel?: string;
}

type SegState = 'done' | 'current' | 'upcoming';

const ARROW = 10; // horizontal depth of the chevron point/notch (px)

const STATE_STYLE: Record<SegState, { bg: string; color: string; weight: number }> = {
  current:  { bg: 'var(--cmc-brand)',       color: '#fff',                  weight: 700 },
  done:     { bg: 'var(--cmc-brand-muted)',  color: 'var(--cmc-brand-ink)',  weight: 600 },
  upcoming: { bg: 'var(--cmc-bg)',           color: 'var(--cmc-text-muted)', weight: 500 },
};

function clipFor(pos: 'first' | 'middle' | 'last' | 'single'): string {
  switch (pos) {
    case 'single': return 'none';
    case 'first':  return `polygon(0 0, calc(100% - ${ARROW}px) 0, 100% 50%, calc(100% - ${ARROW}px) 100%, 0 100%)`;
    case 'last':   return `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${ARROW}px 50%)`;
    default:       return `polygon(0 0, calc(100% - ${ARROW}px) 0, 100% 50%, calc(100% - ${ARROW}px) 100%, 0 100%, ${ARROW}px 50%)`;
  }
}

function padFor(pos: 'first' | 'middle' | 'last' | 'single'): string {
  switch (pos) {
    case 'single': return '0 12px';
    case 'first':  return '0 20px 0 12px';
    case 'last':   return '0 12px 0 20px';
    default:       return '0 20px 0 20px';
  }
}

const STYLE_TAG = `
.cmc-wfsb-seg:focus-visible { outline: 2px solid var(--cmc-brand-hover); outline-offset: 2px; }
.cmc-wfsb-seg[data-clickable="true"]:hover { filter: brightness(0.97); }
`;

export function WorkflowStatusbar({
  stages,
  current,
  terminal,
  onStageClick,
  size = 'sm',
  ariaLabel = 'Tiến trình',
}: WorkflowStatusbarProps) {
  const terminalMatch = terminal?.find((t) => t.value === current) ?? null;
  const currentIndex = terminalMatch ? -1 : stages.findIndex((s) => s.value === current);

  const fontSize = size === 'md' ? 13 : 12;
  const height = size === 'md' ? 30 : 26;
  const clickable = !!onStageClick;

  const count = stages.length;

  return (
    <div
      className="cmc-wfsb"
      role="list"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        gap: 3,
        lineHeight: 1,
        verticalAlign: 'middle',
        flexWrap: 'wrap',
        fontFamily: 'var(--cmc-font)',
      }}
    >
      <style>{STYLE_TAG}</style>

      {stages.map((stage, i) => {
        const state: SegState = terminalMatch
          ? 'upcoming'
          : i < currentIndex
            ? 'done'
            : i === currentIndex
              ? 'current'
              : 'upcoming';
        const pos = count === 1 ? 'single' : i === 0 ? 'first' : i === count - 1 ? 'last' : 'middle';
        const tokens = STATE_STYLE[state];
        const label = state === 'done' ? `✓ ${stage.label}` : stage.label;

        const segStyle: CSSProperties = {
          height,
          display: 'inline-flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          fontSize,
          fontWeight: tokens.weight,
          color: tokens.color,
          background: tokens.bg,
          border: 0,
          margin: 0,
          appearance: 'none',
          padding: padFor(pos),
          clipPath: clipFor(pos),
          cursor: clickable ? 'pointer' : 'default',
          transition: 'background 150ms var(--cmc-ease-out)',
        };

        const common = {
          className: 'cmc-wfsb-seg',
          'data-clickable': clickable ? 'true' : 'false',
          role: 'listitem',
          title: stage.label,
          'aria-current': state === 'current' ? ('step' as const) : undefined,
          style: segStyle,
        };

        return clickable ? (
          <button key={stage.value} type="button" onClick={() => onStageClick!(stage.value)} {...common}>
            {label}
          </button>
        ) : (
          <div key={stage.value} {...common}>
            {label}
          </div>
        );
      })}

      {terminalMatch && (
        <div
          role="listitem"
          aria-current="step"
          title={terminalMatch.label}
          style={{
            height,
            display: 'inline-flex',
            alignItems: 'center',
            whiteSpace: 'nowrap',
            marginLeft: 'var(--cmc-space-2)',
            padding: '0 10px',
            borderRadius: 'var(--cmc-radius-xs)',
            fontSize,
            fontWeight: 600,
            color: 'var(--cmc-danger-text)',
            background: 'var(--cmc-danger-bg)',
          }}
        >
          {terminalMatch.label}
        </div>
      )}
    </div>
  );
}
