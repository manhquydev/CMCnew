import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Center, Loader } from '@mantine/core';
import { trpc, notifyError } from '@cmc/ui';
import { ExerciseModal } from './student-view';
import {
  ClimbHud,
  ProgramSign,
  BeanNode,
  CloudCelebration,
  ClimbAmbient,
  NODE_BASE,
  NODE_GAP,
  SCENE_PAD,
  type NodeState,
  type NodeSide,
  type ProgramKey,
} from './climb/cloud-climb';

type Exercise = Awaited<ReturnType<typeof trpc.exercise.listForPrincipal.query>>[number];
type Submission = Awaited<ReturnType<typeof trpc.submission.mine.query>>[number];

// Display order of the three CMC programs along the climb (bottom → top).
const PROGRAM_ORDER: ProgramKey[] = ['BLACK_HOLE', 'BRIGHT_IG', 'UCREA'];

function isDone(sub: Submission | undefined): boolean {
  return sub?.status === 'graded' && !!sub.grade?.isPublished;
}

/** Alternating climb path: left / right, with the very top node centred (the summit). */
function nodeSide(i: number, total: number): NodeSide {
  if (i === total - 1 && total > 2) return 'center';
  return i % 2 === 0 ? 'left' : 'right';
}

/**
 * Student "leo tầng mây" surface — a beanstalk journey (modelled on cungcontuhoc): each
 * published exercise is a cloud platform climbing UP a central trunk, grouped into program
 * tiers, with the ground at the bottom. State is derived entirely from existing data:
 * done = graded+published, the earliest not-done node is "current", the rest are upcoming
 * (still openable — homework is never hard-locked). The view auto-scrolls to the bottom so
 * the student starts at the ground and climbs.
 */
export function ClimbView({ refreshKey }: { refreshKey: number }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Exercise | null>(null);
  const [celebrate, setCelebrate] = useState<{ title: string; reward: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetched in the SAME Promise.all as the opened exercises — splitting this into its own
      // effect would let the scroll-to-current effect fire (and lock `didInitialScroll`) before
      // the locked nodes exist, scrolling to the wrong spot on first load.
      const [ex, subs, bal, upcoming] = await Promise.all([
        trpc.exercise.listForPrincipal.query(),
        trpc.submission.mine.query(),
        trpc.rewards.balance.query(),
        trpc.exercise.upcomingForPrincipal.query(),
      ]);
      setExercises(ex);
      setSubmissions(subs);
      setBalance(bal);
      setUpcomingCount(upcoming.upcomingCount);
    } catch (e) {
      notifyError(e, 'Tải bài tập thất bại');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const subByExercise = useMemo(() => {
    const m = new Map<string, Submission>();
    for (const s of submissions) m.set(s.exerciseId, s);
    return m;
  }, [submissions]);

  // Group by program (climb order BlackHole → BRIGHT I.G → UCREA); only programs with exercises.
  const groups = useMemo(() => {
    const byProgram = new Map<ProgramKey, Exercise[]>();
    for (const ex of exercises) {
      const program = ex.program as ProgramKey | undefined;
      if (!program) continue;
      const list = byProgram.get(program) ?? [];
      list.push(ex);
      byProgram.set(program, list);
    }
    return PROGRAM_ORDER.filter((p) => byProgram.has(p)).map((p) => ({ program: p, items: byProgram.get(p)! }));
  }, [exercises]);

  // Flattened climb order — single source of truth for counts and node positions.
  const visible = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const currentId = useMemo(() => {
    for (const ex of visible) if (!isDone(subByExercise.get(ex.id))) return ex.id;
    return null;
  }, [visible, subByExercise]);

  const doneCount = useMemo(
    () => visible.filter((ex) => isDone(subByExercise.get(ex.id))).length,
    [visible, subByExercise],
  );

  const nodeState = useCallback(
    (ex: Exercise): NodeState => {
      const sub = subByExercise.get(ex.id);
      if (isDone(sub)) return 'done';
      if (ex.id === currentId) return sub?.status === 'submitted' ? 'submitted' : 'current';
      return sub?.status === 'submitted' ? 'submitted' : 'upcoming';
    },
    [subByExercise, currentId],
  );

  // Lay every node onto the beanstalk: index 0 at the bottom, climbing upward. Locked
  // (not-yet-open) placeholders continue the same sequence above the real nodes so the ≤2
  // capped count-only nodes read as "what's coming next", not a separate section.
  const layout = useMemo(() => {
    const total = visible.length + upcomingCount;
    const nodes = visible.map((ex, i) => ({
      ex,
      state: nodeState(ex),
      side: nodeSide(i, total),
      yPos: NODE_BASE + i * NODE_GAP,
    }));
    const lockedNodes = Array.from({ length: upcomingCount }, (_, k) => {
      const i = visible.length + k;
      return { key: `locked-${k}`, side: nodeSide(i, total), yPos: NODE_BASE + i * NODE_GAP };
    });
    let idx = 0;
    const signs = groups.map((g) => {
      const startIndex = idx;
      idx += g.items.length;
      const groupDone = g.items.filter((ex) => isDone(subByExercise.get(ex.id))).length;
      return {
        program: g.program,
        doneCount: groupDone,
        total: g.items.length,
        yPos: Math.max(230, NODE_BASE + startIndex * NODE_GAP - 168),
      };
    });
    return { nodes, lockedNodes, signs, sceneHeight: Math.max(1100, total * NODE_GAP + SCENE_PAD) };
  }, [visible, groups, subByExercise, nodeState, upcomingCount]);

  // Scroll to the "current" node (the one the student should act on) ONCE on first load —
  // never yank the student back on later refreshes (e.g. after submitting partway up the
  // climb). useLayoutEffect (not useEffect) so this runs before paint, avoiding a visible jump.
  // currentId === null means every opened exercise is done: fall back to the most recently
  // done node so the student still lands near the top of what they've climbed, or the ground
  // if nothing is opened yet at all.
  const didInitialScroll = useRef(false);
  useLayoutEffect(() => {
    if (loading || didInitialScroll.current || !rootRef.current) return;
    const root = rootRef.current;
    let targetId = currentId;
    if (targetId === null) {
      const doneIds = visible.filter((ex) => isDone(subByExercise.get(ex.id))).map((ex) => ex.id);
      targetId = doneIds.at(-1) ?? null;
    }
    const target = targetId ? root.querySelector<HTMLElement>(`[data-node-id="${targetId}"]`) : null;
    if (target) {
      target.scrollIntoView({ block: 'center' });
    } else {
      root.scrollTop = root.scrollHeight;
    }
    didInitialScroll.current = true;
  }, [loading, currentId, visible, subByExercise]);

  function handleSubmitted(ex: Exercise) {
    // The modal already awaited onChanged (= load) before calling this, so just celebrate.
    setCelebrate({ title: ex.title, reward: ex.starReward });
  }

  if (loading) {
    return (
      <div className="climb-root">
        <div className="climb-bg" />
        <Center h="60vh"><Loader color="white" /></Center>
      </div>
    );
  }

  return (
    <div className="climb-root" ref={rootRef}>
      <div className="climb-bg" />
      <div className="climb-scene" style={{ height: layout.sceneHeight }}>
        <ClimbHud stars={balance} climbed={doneCount} total={visible.length} />
        <div className="climb-trunk" style={{ height: layout.sceneHeight }} />
        <ClimbAmbient />
        <div className="climb-ground" />

        {visible.length === 0 && upcomingCount === 0 ? (
          <div className="climb-empty">
            Bài tập sẽ tự mở sau khi lớp học xong bài tương ứng. Khi có bài đã mở, các tầng mây sẽ xuất hiện ở đây.
          </div>
        ) : (
          <>
            {visible.length === 0 && upcomingCount > 0 && (
              <div className="climb-empty" style={{ bottom: NODE_BASE - 140 }}>
                Chưa có bài nào mở, nhưng bài tiếp theo đang chờ sau buổi học tới. Cố lên nhé!
              </div>
            )}
            {layout.signs.map((s) => (
              <ProgramSign key={s.program} program={s.program} doneCount={s.doneCount} total={s.total} yPos={s.yPos} />
            ))}
            {layout.nodes.map((n, i) => (
              <BeanNode
                key={n.ex.id}
                id={n.ex.id}
                state={n.state}
                side={n.side}
                yPos={n.yPos}
                step={i + 1}
                title={n.ex.title}
                earnedStars={n.state === 'done' ? scoreToStars(subByExercise.get(n.ex.id)) : undefined}
                reward={n.ex.starReward}
                onClick={() => setActive(n.ex)}
              />
            ))}
            {layout.lockedNodes.map((n, k) => (
              <BeanNode key={n.key} state="locked" side={n.side} yPos={n.yPos} step={visible.length + k + 1} />
            ))}
          </>
        )}
      </div>

      {active && (
        <ExerciseModal
          exercise={active}
          submission={subByExercise.get(active.id)}
          opened={!!active}
          onClose={() => setActive(null)}
          onChanged={load}
          onSubmitted={() => handleSubmitted(active)}
        />
      )}

      {celebrate && (
        <CloudCelebration title={celebrate.title} reward={celebrate.reward} onClose={() => setCelebrate(null)} />
      )}
    </div>
  );
}

/** Map a published grade to a 1–3 star rating for the node's earned-stars glyphs. */
function scoreToStars(sub: Submission | undefined): number {
  const g = sub?.grade;
  if (!g || g.maxScore <= 0 || g.score == null) return 1;
  const ratio = g.score / g.maxScore;
  if (ratio >= 0.85) return 3;
  if (ratio >= 0.6) return 2;
  return 1;
}
