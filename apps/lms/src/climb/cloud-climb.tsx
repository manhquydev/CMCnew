import { useEffect, useState, type CSSProperties } from 'react';
import './cloud-climb.css';

/** Visual state of a single exercise node on the climb. */
export type NodeState = 'done' | 'current' | 'submitted' | 'upcoming';

/** The three CMC programs — mirrors the Prisma `Program` enum the API serialises as strings.
 *  Kept local so the browser bundle never imports the server-side @cmc/db (Prisma) package. */
export type ProgramKey = 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE';

/** Per-program branding: label + public asset + cloud accent fill. */
export const PROGRAM_META: Record<ProgramKey, { label: string; sub: string; img: string }> = {
  BLACK_HOLE: { label: 'BlackHole', sub: 'Tư duy', img: '/brand/program-black-hole.png' },
  BRIGHT_IG: { label: 'BRIGHT I.G', sub: 'Trí tuệ', img: '/brand/program-bright-ig.png' },
  UCREA: { label: 'UCREA', sub: 'Sáng tạo', img: '/brand/program-ucrea.png' },
};

const CLOUD_FILL: Record<NodeState, { fill: string; stroke: string }> = {
  done: { fill: '#34C759', stroke: 'rgba(255,255,255,.85)' },
  current: { fill: '#FF9F0A', stroke: 'rgba(255,255,255,.85)' },
  submitted: { fill: '#0071E3', stroke: 'rgba(255,255,255,.85)' },
  upcoming: { fill: '#D9DCE2', stroke: '#ffffff' },
};

const CLOUD_PATH =
  'M20 56 Q4 56 6 42 Q-2 30 12 26 Q12 10 30 12 Q38 0 52 8 Q70 2 74 18 Q92 18 90 36 Q98 50 80 56 Z';

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
    <div className="climb-zone">
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
  milestoneImg?: string;
  onClick: () => void;
}

export function CloudNode({ state, title, side, earnedStars, reward, milestoneImg, onClick }: CloudNodeProps) {
  const { fill, stroke } = CLOUD_FILL[state];
  const faceMuted = state === 'upcoming';
  const glyph = state === 'done' ? '✓' : state === 'current' ? '★' : state === 'submitted' ? '⏳' : '☁';
  return (
    <div className={`climb-node climb-node--${side}`}>
      {state === 'current' && <span className="climb-node__here">Bạn ở đây</span>}
      <button
        type="button"
        className={`climb-cloud${state === 'current' ? ' climb-cloud--pulse' : ''}`}
        onClick={onClick}
        aria-label={`${title} — ${stateLabel(state)}`}
      >
        <svg viewBox="0 0 96 70" preserveAspectRatio="none">
          <path d={CLOUD_PATH} fill={fill} stroke={stroke} strokeWidth={2} />
        </svg>
        <span className={`climb-cloud__face${faceMuted ? ' climb-cloud__face--muted' : ''}`}>
          {glyph}
          {state === 'current' && <small>Làm ngay</small>}
        </span>
        {milestoneImg && <img className="climb-node__milestone" src={milestoneImg} alt="" />}
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

/** Full-screen celebration shown briefly after a successful submit. No mascot. */
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
      <div className="climb-celebrate__ring">⛅</div>
      <div className="climb-celebrate__rate">★ ★ ★</div>
      <h2>Lên một tầng mây!</h2>
      <p>Bạn đã nộp “{title}”</p>
      {reward > 0 && <div className="climb-celebrate__earn">+{reward} ⭐ khi được chấm đạt</div>}
    </div>
  );
}
