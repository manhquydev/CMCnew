import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Center, Loader, NumberInput, Rating, Select, Textarea } from '@mantine/core';
import { notifyError, notifySuccess, trpc, useSession } from '@cmc/ui';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type ClassBatch = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];
type Exercise = Awaited<ReturnType<typeof trpc.exercise.listByClass.query>>[number];
type Submission = Awaited<ReturnType<typeof trpc.submission.listByExercise.query>>[number];

const C = {
  brand: '#0071E3',
  brandMuted: '#E8F1FC',
  brandInk: '#003D99',
  text: '#1D1D1F',
  text2: '#3C3C43',
  muted: '#6E6E73',
  faint: '#AEAEB2',
  bg: '#F5F5F7',
  surface: '#FFFFFF',
  border: '#E5E5EA',
  successBg: '#E6F4EA',
  success: '#137333',
  warningBg: '#FEF3E0',
  warning: '#8A5A00',
};

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

interface SelectedItem {
  exercise: Exercise;
  submission: Submission;
}

interface HomeworkFeedProps {
  /** Pre-selected batch. When omitted an inline class-picker is shown. */
  batchId?: string;
  /** Initial facility filter for the class picker. */
  facilityId?: number | null;
  onBack?: () => void;
}

export function HomeworkFeed({ batchId: propBatchId, facilityId: propFacilityId, onBack }: HomeworkFeedProps) {
  const { me } = useSession();
  const defaultFacilityId = propFacilityId ?? me.facilityIds[0] ?? null;

  // ── class picker state (only when no propBatchId) ───────────────────────
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [batches, setBatches] = useState<ClassBatch[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(defaultFacilityId);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(propBatchId ?? null);
  const [loadingBatches, setLoadingBatches] = useState(false);

  // ── exercise + submission state ─────────────────────────────────────────
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(false);
  const [submissionMap, setSubmissionMap] = useState<Record<string, Submission[]>>({});
  const [loadingSubmissions, setLoadingSubmissions] = useState<Record<string, boolean>>({});

  // ── grading panel state ──────────────────────────────────────────────────
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [score, setScore] = useState<number | string>('');
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  const activeBatchId = propBatchId ?? selectedBatchId;

  // Load facilities + batches for class picker
  useEffect(() => {
    if (propBatchId) return;
    trpc.facility.list.query().then(setFacilities).catch(() => {});
    setLoadingBatches(true);
    trpc.classBatch.list
      .query()
      .then(setBatches)
      .catch((e) => notifyError(e, 'Không tải được danh sách lớp'))
      .finally(() => setLoadingBatches(false));
  }, [propBatchId]);

  const filteredBatches = useMemo(
    () =>
      batches.filter(
        (b) =>
          b.status !== 'cancelled' && (!facilityId || b.facilityId === facilityId),
      ),
    [batches, facilityId],
  );

  // Load exercises + all submissions when batch is selected
  useEffect(() => {
    if (!activeBatchId) return;
    setExercises([]);
    setSubmissionMap({});
    setSelected(null);
    setLoadingExercises(true);
    trpc.exercise.listByClass
      .query({ classBatchId: activeBatchId })
      .then((exs) => {
        setExercises(exs);
        exs.forEach((ex) => {
          setLoadingSubmissions((p) => ({ ...p, [ex.id]: true }));
          trpc.submission.listByExercise
            .query({ exerciseId: ex.id })
            .then((rows) => setSubmissionMap((p) => ({ ...p, [ex.id]: rows })))
            .catch((e) => notifyError(e, 'Không tải được bài nộp'))
            .finally(() => setLoadingSubmissions((p) => ({ ...p, [ex.id]: false })));
        });
      })
      .catch((e) => notifyError(e, 'Không tải được bài tập'))
      .finally(() => setLoadingExercises(false));
  }, [activeBatchId]);

  function selectSubmission(exercise: Exercise, sub: Submission) {
    setSelected({ exercise, submission: sub });
    setScore(sub.grade?.score ?? '');
    const maxScore = sub.grade?.maxScore ?? 10;
    setStars(
      sub.grade?.score != null ? Math.round((sub.grade.score / maxScore) * 5) : 0,
    );
    setFeedback(sub.grade?.feedback ?? '');
  }

  async function handleSave() {
    if (!selected || score === '') return;
    setSaving(true);
    try {
      await trpc.grade.grade.mutate({
        submissionId: selected.submission.id,
        score: Number(score),
        feedback: feedback || undefined,
      });
      notifySuccess('Đã lưu điểm');
      setSubmissionMap((prev) => {
        const rows = prev[selected.exercise.id] ?? [];
        return {
          ...prev,
          [selected.exercise.id]: rows.map((s) =>
            s.id === selected.submission.id
              ? {
                  ...s,
                  grade: {
                    id: s.grade?.id ?? '',
                    score: Number(score),
                    maxScore: s.grade?.maxScore ?? 10,
                    feedback: feedback || null,
                    isPublished: s.grade?.isPublished ?? false,
                  },
                }
              : s,
          ),
        };
      });
    } catch (e) {
      notifyError(e, 'Không lưu được điểm');
    } finally {
      setSaving(false);
    }
  }

  const allSubs = Object.values(submissionMap).flat();
  const gradedCount = allSubs.filter((s) => s.grade?.score != null).length;
  const totalSubs = allSubs.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT }}>
      {/* Header bar */}
      <div
        style={{
          padding: '14px 24px',
          borderBottom: `1px solid ${C.border}`,
          background: C.surface,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        {onBack && (
          <button
            onClick={onBack}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: 8,
              color: C.brand,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: FONT,
            }}
          >
            ← Quay lại
          </button>
        )}

        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Chấm bài tập</div>

        {totalSubs > 0 && (
          <div
            style={{
              padding: '4px 10px',
              borderRadius: 20,
              background: gradedCount === totalSubs ? C.successBg : C.brandMuted,
              color: gradedCount === totalSubs ? C.success : C.brand,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {gradedCount}/{totalSubs} đã chấm
          </div>
        )}

        {/* Class picker — only when not pre-scoped to a batch */}
        {!propBatchId && (
          <div style={{ display: 'flex', gap: 10, marginLeft: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
            {facilities.length > 1 && (
              <Select
                placeholder="Lọc cơ sở..."
                value={facilityId ? String(facilityId) : null}
                onChange={(v) => {
                  setFacilityId(v ? Number(v) : null);
                  setSelectedBatchId(null);
                }}
                data={facilities.map((f) => ({ value: String(f.id), label: f.name }))}
                clearable
                size="xs"
                w={160}
              />
            )}
            <Select
              placeholder="Chọn lớp để chấm bài..."
              value={selectedBatchId}
              onChange={(v) => {
                setSelectedBatchId(v);
                setSelected(null);
              }}
              data={filteredBatches.map((b) => ({ value: b.id, label: `${b.code} – ${b.name}` }))}
              searchable
              disabled={loadingBatches}
              size="xs"
              w={260}
            />
          </div>
        )}
      </div>

      {/* Body */}
      {!activeBatchId ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: C.muted,
            fontSize: 14,
          }}
        >
          Chọn lớp để xem bài tập cần chấm
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '300px 1fr',
            overflow: 'hidden',
          }}
        >
          {/* LEFT: exercise + submission list */}
          <div
            style={{
              borderRight: `1px solid ${C.border}`,
              overflowY: 'auto',
              background: C.bg,
            }}
          >
            {loadingExercises ? (
              <Center py="xl">
                <Loader size="sm" />
              </Center>
            ) : exercises.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  color: C.muted,
                  fontSize: 14,
                }}
              >
                Không có bài tập nào
              </div>
            ) : (
              exercises.map((ex) => {
                const subs = submissionMap[ex.id];
                const isLoading = loadingSubmissions[ex.id];
                return (
                  <div key={ex.id}>
                    {/* Exercise header */}
                    <div
                      style={{
                        padding: '12px 16px 8px',
                        fontSize: 11,
                        fontWeight: 700,
                        color: C.brand,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        background: C.brandMuted,
                        borderBottom: `1px solid ${C.border}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ex.title}
                      </span>
                      {subs && (
                        <span
                          style={{
                            marginLeft: 8,
                            padding: '2px 8px',
                            borderRadius: 12,
                            background: C.surface,
                            color: C.brand,
                            fontSize: 11,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {subs.filter((s) => s.grade?.score != null).length}/{subs.length}
                        </span>
                      )}
                    </div>

                    {isLoading && (
                      <Center py="sm">
                        <Loader size="xs" />
                      </Center>
                    )}

                    {subs && subs.length === 0 && (
                      <div
                        style={{
                          padding: '10px 16px',
                          color: C.faint,
                          fontSize: 12,
                        }}
                      >
                        Chưa có bài nộp
                      </div>
                    )}

                    {subs &&
                      subs.map((sub) => {
                        const isGraded = sub.grade?.score != null;
                        const isActive = selected?.submission.id === sub.id;
                        return (
                          <div
                            key={sub.id}
                            onClick={() => selectSubmission(ex, sub)}
                            style={{
                              padding: '10px 16px',
                              borderBottom: `1px solid ${C.border}`,
                              cursor: 'pointer',
                              background: isActive ? C.brandMuted : C.surface,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: isActive ? C.brandInk : C.text,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {sub.student.fullName}
                              </div>
                              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                                {dayjs(sub.submittedAt ?? sub.createdAt).format(
                                  'DD/MM HH:mm',
                                )}
                              </div>
                            </div>
                            <div
                              style={{
                                padding: '3px 8px',
                                borderRadius: 12,
                                background: isGraded ? C.successBg : C.warningBg,
                                color: isGraded ? C.success : C.warning,
                                fontSize: 11,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {isGraded ? `${sub.grade!.score}đ` : 'Chờ chấm'}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>

          {/* RIGHT: grading panel */}
          <div style={{ overflowY: 'auto', padding: '24px 28px' }}>
            {!selected ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: C.muted,
                  fontSize: 14,
                }}
              >
                Chọn một bài nộp để chấm điểm
              </div>
            ) : (
              <div style={{ maxWidth: 560 }}>
                {/* Student info */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginBottom: 4 }}>
                    {selected.exercise.title}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>
                    {selected.submission.student.fullName}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                    Mã HS: {selected.submission.student.studentCode} ·{' '}
                    {dayjs(
                      selected.submission.submittedAt ?? selected.submission.createdAt,
                    ).format('DD/MM/YYYY HH:mm')}
                  </div>
                </div>

                {/* Answer text */}
                {selected.submission.answerText && (
                  <div
                    style={{
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: '14px 16px',
                      marginBottom: 20,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: C.muted,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        marginBottom: 8,
                      }}
                    >
                      Bài làm
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: C.text2,
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.6,
                      }}
                    >
                      {selected.submission.answerText}
                    </div>
                  </div>
                )}

                {/* No submission file placeholder */}
                {!selected.submission.answerText && (
                  <div
                    style={{
                      background: C.bg,
                      border: `1.5px dashed ${C.border}`,
                      borderRadius: 12,
                      padding: '28px 16px',
                      textAlign: 'center',
                      color: C.muted,
                      fontSize: 13,
                      marginBottom: 20,
                    }}
                  >
                    Không có nội dung bài nộp
                  </div>
                )}

                {/* Divider */}
                <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: 20 }} />

                {/* Score */}
                <div style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.text2,
                      marginBottom: 8,
                    }}
                  >
                    Điểm số (0 – {selected.submission.grade?.maxScore ?? 10})
                  </div>
                  <NumberInput
                    value={score}
                    onChange={setScore}
                    min={0}
                    max={selected.submission.grade?.maxScore ?? 10}
                    step={0.5}
                    placeholder="Nhập điểm"
                    w={120}
                  />
                </div>

                {/* Stars */}
                <div style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.text2,
                      marginBottom: 8,
                    }}
                  >
                    Đánh giá sao
                  </div>
                  <Rating value={stars} onChange={setStars} size="lg" />
                </div>

                {/* Feedback */}
                <div style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.text2,
                      marginBottom: 8,
                    }}
                  >
                    Nhận xét
                  </div>
                  <Textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.currentTarget.value)}
                    placeholder="Nhận xét cho học sinh..."
                    minRows={3}
                    autosize
                  />
                </div>

                {/* Save button */}
                <button
                  onClick={handleSave}
                  disabled={score === '' || saving}
                  style={{
                    padding: '10px 28px',
                    borderRadius: 10,
                    border: 'none',
                    background: score === '' || saving ? C.faint : C.brand,
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: score === '' || saving ? 'not-allowed' : 'pointer',
                    fontFamily: FONT,
                    transition: 'background 0.15s',
                  }}
                >
                  {saving ? 'Đang lưu...' : 'Chấm & cộng sao'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
