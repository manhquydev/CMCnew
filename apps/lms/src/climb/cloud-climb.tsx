import { useEffect, useState, type CSSProperties } from 'react';
import './cloud-climb.css';

/** Visual state of a single exercise node on the climb. */
export type NodeState = 'done' | 'current' | 'submitted' | 'upcoming';

/** The three CMC programs — mirrors the Prisma `Program` enum the API serialises as strings.
 *  Kept local so the browser bundle never imports the server-side @cmc/db (Prisma) package. */
export type ProgramKey = 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE';

/** Per-program branding: label + public asset + official marketing accent color. */
export const PROGRAM_META: Record<ProgramKey, { label: string; sub: string; img: string; accent: string }> = {
  BLACK_HOLE: { label: 'BlackHole', sub: 'Tư duy', img: '/brand/program-black-hole.png', accent: '#7950F2' },
  BRIGHT_IG: { label: 'BRIGHT I.G', sub: 'Trí tuệ', img: '/brand/program-bright-ig.png', accent: '#1B98E0' },
  UCREA: { label: 'UCREA', sub: 'Sáng tạo', img: '/brand/program-ucrea.png', accent: '#FF7B2E' },
};

/** Garden node artwork per state (cloud-garden assets, mascot-free). */
const NODE_IMG: Record<NodeState, string> = {
  done: '/garden/nodes/flower-done.png',
  current: '/garden/platform/cloud-platform.png',
  submitted: '/garden/platform/cloud-fluffy.png',
  upcoming: '/garden/nodes/flower-locked.png',
};

export function ClimbHud({ stars, climbed, total }: { stars: number; climbed: number; total: number }) {
  return (
    <div className="climb-hud">
      <img className="climb-hud__logo" src="/brand/cmc-logo.jpg" alt="CMC" />
      <span className="climb-hud__spacer" />
      <span className="climb-chip climb-chip--gold">⭐ {stars}</span>
      <span className="climb-chip">🏔 {climbed}/{total} bậc</span>
    </div>
  );
}

export function ProgramBanner({ program, doneCount, total }: { program: ProgramKey; doneCount: number; total: number }) {
  const meta = PROGRAM_META[program];
  return (
    <div className="climb-zone" style={{ borderLeftColor: meta.accent }}>
      <img className="climb-zone__img" src={meta.img} alt="" />
      <div>
        <div className="climb-zone__title">{meta.label} · {meta.sub}</div>
        <div className="climb-zone__sub">Đã xong {doneCount}/{total} bài</div>
      </div>
    </div>
  );
}

interface CloudNodeProps {
  state: NodeState;
  title: string;
  side: 'l' | 'r';
  /** Earned stars (done) — rendered as ⭐ run. */
  earnedStars?: number;
  /** Reward preview (current/upcoming). */
  reward?: number;
  onClick: () => void;
}

export function CloudNode({ state, title, side, earnedStars, reward, onClick }: CloudNodeProps) {
  return (
    <div className={`climb-node climb-node--${side}`}>
      {state === 'current' && <span className="climb-node__here">Bạn ở đây</span>}
      <button
        type="button"
        className={`climb-node__btn climb-node__btn--${state}`}
        onClick={onClick}
        aria-label={`${title} — ${stateLabel(state)}`}
      >
        <img className="climb-node__art" src={NODE_IMG[state]} alt="" />
        {state === 'done' && <span className="climb-node__badge climb-node__badge--done">✓</span>}
        {state === 'current' && <span className="climb-node__badge climb-node__badge--go">Làm ngay</span>}
        {state === 'submitted' && <span className="climb-node__badge climb-node__badge--wait">⏳</span>}
      </button>
      <div className="climb-node__label">{title}</div>
      {state === 'done' && earnedStars != null && (
        <div className="climb-node__stars">{'⭐'.repeat(Math.max(1, Math.min(3, earnedStars)))}</div>
      )}
      {(state === 'current' || state === 'upcoming') && reward != null && reward > 0 && (
        <div className="climb-node__stars">+{reward} sao</div>
      )}
    </div>
  );
}

function stateLabel(s: NodeState): string {
  return s === 'done' ? 'đã hoàn thành' : s === 'current' ? 'làm ngay' : s === 'submitted' ? 'đã nộp, chờ chấm' : 'sắp tới';
}

/** Decorative floating elements (butterfly / leaf / far cloud strip). Pure atmosphere. */
export function ClimbAmbient() {
  return (
    <div className="climb-ambient" aria-hidden="true">
      <img className="climb-ambient__cloud climb-ambient__cloud--1" src="/garden/ambient/cloud-strip.png" alt="" />
      <img className="climb-ambient__cloud climb-ambient__cloud--2" src="/garden/ambient/cloud-strip.png" alt="" />
      <img className="climb-ambient__leaf climb-ambient__leaf--1" src="/garden/ambient/leaf.png" alt="" />
      <img className="climb-ambient__butterfly" src="/garden/ambient/butterfly.png" alt="" />
    </div>
  );
}

/** Garden ground strip anchored to the bottom of the climb. */
export function ClimbGround() {
  return <div className="climb-ground" aria-hidden="true" />;
}

/** Full-screen celebration shown briefly after a successful submit. No mascot — garden VFX. */
export function CloudCelebration({
  title,
  reward,
  onClose,
}: {
  title: string;
  reward: number;
  onClose: () => void;
}) {
  const [pieces] = useState(() =>
    Array.from({ length: 28 }, (_, i) => ({
      r: `${i * (360 / 28)}deg`,
      color: ['#FFD98A', '#FF9F0A', '#34C759', '#4494E9', '#ffffff'][i % 5],
      delay: `${(i % 6) * 0.08}s`,
    })),
  );

  // Auto-dismiss so the climb returns without a tap; Escape closes early for keyboard users.
  useEffect(() => {
    const t = setTimeout(onClose, 3200);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="climb-celebrate" role="alertdialog" aria-label="Hoàn thành bài tập" onClick={onClose}>
      <div className="climb-burst">
        {pieces.map((p, i) => (
          <i key={i} style={{ '--r': p.r, background: p.color, animationDelay: p.delay } as CSSProperties} />
        ))}
      </div>
      <img className="climb-celebrate__vfx" src="/garden/vfx/cloud-burst.png" alt="" />
      <img className="climb-celebrate__pop" src="/garden/vfx/star-pop.png" alt="" />
      <div className="climb-celebrate__rate">★ ★ ★</div>
      <h2>Lên một tầng mây!</h2>
      <p>Bạn đã nộp “{title}”</p>
      {reward > 0 && <div className="climb-celebrate__earn">+{reward} ⭐ khi được chấm đạt</div>}
    </div>
  );
}
