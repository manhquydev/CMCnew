import { useEffect, useState, type CSSProperties } from 'react';
import { IconStar, IconMountain, IconCheck, IconClock } from '@tabler/icons-react';
import './cloud-climb.css';

/** Visual state of a single exercise node on the climb. */
export type NodeState = 'done' | 'current' | 'submitted' | 'upcoming';
export type NodeSide = 'left' | 'right' | 'center';

/** The three CMC programs — mirrors the Prisma `Program` enum the API serialises as strings.
 *  Kept local so the browser bundle never imports the server-side @cmc/db (Prisma) package. */
export type ProgramKey = 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE';

/** Per-program branding: label + public asset + official marketing accent color. */
export const PROGRAM_META: Record<ProgramKey, { label: string; sub: string; img: string; accent: string }> = {
  BLACK_HOLE: { label: 'BlackHole', sub: 'Tư duy', img: 'brand/program-black-hole.png', accent: '#7950F2' },
  BRIGHT_IG: { label: 'BRIGHT I.G', sub: 'Trí tuệ', img: 'brand/program-bright-ig.png', accent: '#1B98E0' },
  UCREA: { label: 'UCREA', sub: 'Sáng tạo', img: 'brand/program-ucrea.png', accent: '#FF7B2E' },
};

/** Vertical rhythm of the beanstalk (matches the cungcontuhoc journey: nodes climb upward). */
export const NODE_GAP = 300;
export const NODE_BASE = 360;
export const SCENE_PAD = 560;

/** Vector Claymorphic Cloud background to replace static PNG image */
export function ClayCloudSVG({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 240 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="cloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="85%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#e2e8f0" />
        </linearGradient>
        <filter id="clayShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="12" stdDeviation="16" floodColor="#0f2042" floodOpacity="0.08" />
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#0f2042" floodOpacity="0.04" />
        </filter>
      </defs>
      <path 
        d="M45 65 C25 65, 10 48, 25 32 C20 18, 40 8, 60 18 C72 5, 98 5, 112 18 C130 5, 160 12, 165 30 C185 30, 195 48, 178 62 C192 75, 165 88, 148 80 C135 88, 92 88, 78 80 C60 88, 45 76, 45 65 Z" 
        fill="url(#cloudGrad)" 
        filter="url(#clayShadow)"
        stroke="#ffffff"
        strokeWidth="3"
      />
    </svg>
  );
}

export function ClimbHud({ stars, climbed, total }: { stars: number; climbed: number; total: number }) {
  return (
    <div className="climb-hud">
      <img className="climb-hud__logo" src="brand/cmc-logo.jpg" alt="CMC" />
      <span className="climb-hud__spacer" />
      <span className="climb-chip climb-chip--gold">
        <IconStar size={16} fill="currentColor" stroke={1.5} /> {stars}
      </span>
      <span className="climb-chip">
        <IconMountain size={16} stroke={1.5} /> {climbed}/{total} bậc
      </span>
    </div>
  );
}

/** A wooden program sign pinned along the trunk where a new program tier begins. */
export function ProgramSign({ program, doneCount, total, yPos }: { program: ProgramKey; doneCount: number; total: number; yPos: number }) {
  const meta = PROGRAM_META[program];
  return (
    <div className="climb-sign" style={{ bottom: yPos, borderColor: meta.accent }}>
      <img className="climb-sign__img" src={meta.img} alt="" />
      <div className="climb-sign__text">
        <strong>{meta.label} · {meta.sub}</strong>
        <span>Đã xong {doneCount}/{total} bài</span>
      </div>
    </div>
  );
}

interface BeanNodeProps {
  state: NodeState;
  side: NodeSide;
  yPos: number;
  /** 1-based step shown on the button for not-yet-done nodes (homework is never hard-locked). */
  step: number;
  title: string;
  earnedStars?: number;
  reward?: number;
  onClick: () => void;
}

/** One lesson node: a floating cloud platform with a round status button + label. */
export function BeanNode({ state, side, yPos, step, title, earnedStars, reward, onClick }: BeanNodeProps) {
  const leftPct = side === 'left' ? '34%' : side === 'right' ? '66%' : '50%';
  
  const glyph = state === 'done' ? (
    <IconCheck size={26} stroke={3} />
  ) : state === 'submitted' ? (
    <IconClock size={24} stroke={3} />
  ) : (
    <span>{step}</span>
  );

  return (
    <div className="climb-bnode" style={{ bottom: yPos, left: leftPct }}>
      {state === 'current' && <span className="climb-bnode__here">Bạn ở đây</span>}
      <ClayCloudSVG className="climb-bnode__cloud" />
      <button
        type="button"
        className={`climb-bnode__btn climb-bnode__btn--${state}`}
        onClick={onClick}
        aria-label={`Bài ${step}: ${title} — ${stateLabel(state)}`}
      >
        {glyph}
      </button>
      <div className="climb-bnode__meta">
        <strong>{title}</strong>
        {state === 'done' && earnedStars != null && (
          <div className="climb-bnode__stars">
            {Array.from({ length: Math.max(1, Math.min(3, earnedStars)) }).map((_, i) => (
              <IconStar key={i} size={14} fill="currentColor" stroke={1.5} />
            ))}
          </div>
        )}
        {(state === 'current' || state === 'upcoming') && reward != null && reward > 0 && (
          <span className="climb-bnode__stars">+{reward} sao</span>
        )}
      </div>
    </div>
  );
}

function stateLabel(s: NodeState): string {
  return s === 'done' ? 'đã hoàn thành' : s === 'current' ? 'làm ngay' : s === 'submitted' ? 'đã nộp, chờ chấm' : 'sắp tới';
}

/** Decorative floating clouds drifting across the sky. Pure atmosphere. */
export function ClimbAmbient() {
  return (
    <div className="climb-ambient" aria-hidden="true">
      <img className="climb-ambient__cloud climb-ambient__cloud--1" src="/garden/ambient/cloud-strip.png" alt="" />
      <img className="climb-ambient__cloud climb-ambient__cloud--2" src="/garden/ambient/cloud-strip.png" alt="" />
      <img className="climb-ambient__cloud climb-ambient__cloud--3" src="/garden/ambient/cloud-strip.png" alt="" />
    </div>
  );
}

/** Full-screen celebration shown briefly after a successful submit. No mascot — garden VFX. */
export function CloudCelebration({ title, reward, onClose }: { title: string; reward: number; onClose: () => void }) {
  const [pieces] = useState(() =>
    Array.from({ length: 28 }, (_, i) => ({
      r: `${i * (360 / 28)}deg`,
      color: ['#FFD98A', '#FF9F0A', '#34C759', '#4494E9', '#ffffff'][i % 5],
      delay: `${(i % 6) * 0.08}s`,
    })),
  );

  useEffect(() => {
    const t = setTimeout(onClose, 3200);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div className="climb-celebrate" role="alertdialog" aria-label="Hoàn thành bài tập" onClick={onClose}>
      <div className="climb-burst">
        {pieces.map((p, i) => (
          <i key={i} style={{ '--r': p.r, background: p.color, animationDelay: p.delay } as CSSProperties} />
        ))}
      </div>
      {/* Bỏ 2 PNG VFX (cloud-burst / star-pop) — ảnh raster chưa xóa nền (nền đen) trông xấu khi
          hiện trên overlay. Confetti CSS + sao vector + text đã đủ hiệu ứng chúc mừng sạch. */}
      <div className="climb-celebrate__rate">
        <IconStar size={24} fill="currentColor" stroke={1.5} />
        <IconStar size={32} fill="currentColor" stroke={1.5} style={{ margin: '0 8px', transform: 'translateY(-4px)' }} />
        <IconStar size={24} fill="currentColor" stroke={1.5} />
      </div>
      <h2>Lên một tầng mây!</h2>
      <p>Bạn đã nộp “{title}”</p>
      {reward > 0 && <div className="climb-celebrate__earn">+{reward} ⭐ khi được chấm đạt</div>}
    </div>
  );
}
