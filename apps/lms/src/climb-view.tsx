import { useCallback, useEffect, useMemo, useState } from 'react';
import { Center, Loader, Alert } from '@mantine/core';
import { trpc, notifyError } from '@cmc/ui';
import { ExerciseModal } from './student-view';
import { ClimbHud, ProgramBanner, CloudNode, CloudCelebration, type NodeState, type ProgramKey } from './climb/cloud-climb';

type Exercise = Awaited<ReturnType<typeof trpc.exercise.listForPrincipal.query>>[number];
type Submission = Awaited<ReturnType<typeof trpc.submission.mine.query>>[number];

// Display order of the three CMC programs along the climb.
const PROGRAM_ORDER: ProgramKey[] = ['BLACK_HOLE', 'BRIGHT_IG', 'UCREA'];
const MILESTONES = ['/brand/kid-blocks.png', '/brand/kid-studying.png'];

function isDone(sub: Submission | undefined): boolean {
  return sub?.status === 'graded' && !!sub.grade?.isPublished;
}

/**
 * Student "leo tầng mây" surface — replaces the flat exercises table. Each published
 * exercise is a cloud node; completing it earns stars and climbs higher. State is derived
 * entirely from existing data: done = graded+published, the earliest not-done node is the
 * current one, the rest are upcoming (still openable — homework is never hard-locked).
 */
export function ClimbView({ refreshKey }: { refreshKey: number }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [active, setActive] = useState<Exercise | null>(null);
  const [celebrate, setCelebrate] = useState<{ title: string; reward: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [ex, subs, bal] = await Promise.all([
        trpc.exercise.listForPrincipal.query(),
        trpc.submission.mine.query(),
        trpc.rewards.balance.query(),
      ]);
      setExercises(ex);
      setSubmissions(subs);
      setBalance(bal);
    } catch (e) {
      setErr('Không tải được hành trình học tập: ' + (e instanceof Error ? e.message : ''));
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

  // Group exercises by program (render order: BlackHole → BRIGHT I.G → UCREA); only
  // programs that actually have exercises appear.
  const groups = useMemo(() => {
    const byProgram = new Map<ProgramKey, Exercise[]>();
    for (const ex of exercises) {
      const program = ex.batch?.course?.program as ProgramKey | undefined;
      if (!program) continue;
      const list = byProgram.get(program) ?? [];
      list.push(ex);
      byProgram.set(program, list);
    }
    return PROGRAM_ORDER.filter((p) => byProgram.has(p)).map((p) => ({ program: p, items: byProgram.get(p)! }));
  }, [exercises]);

  // Flattened render set — the single source of truth for counts so the HUD/zone totals can
  // never diverge from the nodes actually drawn (an exercise without a program is excluded).
  const visible = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // The earliest not-done node in render order is "current"; before it = done, after = upcoming.
  const currentId = useMemo(() => {
    for (const ex of visible) {
      if (!isDone(subByExercise.get(ex.id))) return ex.id;
    }
    return null; // all done
  }, [visible, subByExercise]);

  const doneCount = useMemo(
    () => visible.filter((ex) => isDone(subByExercise.get(ex.id))).length,
    [visible, subByExercise],
  );

  function nodeState(ex: Exercise): NodeState {
    const sub = subByExercise.get(ex.id);
    if (isDone(sub)) return 'done';
    if (ex.id === currentId) return sub?.status === 'submitted' ? 'submitted' : 'current';
    return sub?.status === 'submitted' ? 'submitted' : 'upcoming';
  }

  function openExercise(ex: Exercise) {
    setActive(ex);
  }

  function handleSubmitted(ex: Exercise) {
    // The modal already awaited onChanged (= load) before calling this, so just celebrate.
    setCelebrate({ title: ex.title, reward: ex.starReward });
  }

  if (loading) {
    return (
      <div className="climb-root">
        <Center py="xl"><Loader color="white" /></Center>
      </div>
    );
  }

  return (
    <div className="climb-root">
      <ClimbHud stars={balance} climbed={doneCount} total={visible.length} />
      <div className="climb-track">
        {err && <Alert color="red" mb="md">{err}</Alert>}

        {visible.length === 0 ? (
          <div className="climb-empty">
            Chưa có bài tập nào trên hành trình của bạn. Khi thầy cô giao bài, các tầng mây sẽ xuất hiện ở đây.
          </div>
        ) : (
          groups.map(({ program, items }) => {
            const groupDone = items.filter((ex) => isDone(subByExercise.get(ex.id))).length;
            return (
              <div key={program}>
                <ProgramBanner program={program} doneCount={groupDone} total={items.length} />
                {items.map((ex, i) => {
                  const state = nodeState(ex);
                  const sub = subByExercise.get(ex.id);
                  return (
                    <CloudNode
                      key={ex.id}
                      state={state}
                      title={ex.title}
                      side={i % 2 === 0 ? 'l' : 'r'}
                      earnedStars={state === 'done' ? scoreToStars(sub) : undefined}
                      reward={ex.starReward}
                      milestoneImg={state === 'current' ? MILESTONES[i % MILESTONES.length] : undefined}
                      onClick={() => openExercise(ex)}
                    />
                  );
                })}
              </div>
            );
          })
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
