import { useCallback, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { API_URL, notifyError, notifySuccess, trpc, uploadSessionPhoto } from '@cmc/ui';
import { Button, Center, Loader, NumberInput, Stack, Tabs, Text, Textarea } from '@mantine/core';

type MySession = Awaited<ReturnType<typeof trpc.schedule.mySessions.query>>[number];
type Enrollment = Awaited<ReturnType<typeof trpc.enrollment.listByBatch.query>>[number];
type Exercise = Awaited<ReturnType<typeof trpc.exercise.listByClass.query>>[number];
type Submission = Awaited<ReturnType<typeof trpc.submission.listByExercise.query>>[number];

const C = {
  brand: '#0071E3', brandMuted: '#E8F1FC',
  text: '#1D1D1F', muted: '#6E6E73',
  bg: '#F5F5F7', surface: '#FFFFFF', border: '#E5E5EA',
  success: '#137333', successBg: '#E6F4EA',
  danger: '#C5221F', dangerBg: '#FCE8E6',
  warning: '#8A5A00', warningBg: '#FEF3E0',
};
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

const SESSION_STATUS: Record<string, { label: string; color: string }> = {
  planned:   { label: 'Sắp dạy',  color: C.brand },
  open:      { label: 'Đang mở',  color: '#1565C0' },
  running:   { label: 'Đang học', color: C.success },
  closed:    { label: 'Đã xong',  color: C.muted },
  cancelled: { label: 'Đã hủy',   color: C.danger },
};

type AttStatus = 'present' | 'late' | 'absent';
interface AttMark { status: AttStatus; excused: boolean }

type EvidenceDraft = {
  summary: string;
  internalNote: string;
  photos: Array<{ ref: string }>;
};

export interface SessionDetailProps {
  session: MySession;
  onBack: () => void;
}

export function TeacherScheduleDetail({ session, onBack }: SessionDetailProps) {
  const enabled = session.status !== 'cancelled';
  const classSessionId = session.id;
  const classBatchId = session.classBatchId;

  // ── Attendance ──────────────────────────────────────────────────────────────
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [marks, setMarks] = useState<Record<string, AttMark>>({});
  const [markingAll, setMarkingAll] = useState(false);
  const [attLoaded, setAttLoaded] = useState(false);

  // ── Evidence (unified state prevents Tab 2 / Tab 4 race) ────────────────────
  const [draft, setDraft] = useState<EvidenceDraft>({ summary: '', internalNote: '', photos: [] });
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [evidencePublished, setEvidencePublished] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending debounce on unmount to prevent post-unmount API call (M1)
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ── Grading ─────────────────────────────────────────────────────────────────
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [selectedEx, setSelectedEx] = useState<Exercise | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [gradeScore, setGradeScore] = useState<number | string>('');
  const [gradeFeedback, setGradeFeedback] = useState('');

  // Load attendance roster
  useEffect(() => {
    Promise.all([
      trpc.enrollment.listByBatch.query({ classBatchId }),
      trpc.attendance.listBySession.query({ classSessionId }),
    ]).then(([enrs, attRows]) => {
      setEnrollments(enrs);
      const m: Record<string, AttMark> = {};
      for (const r of attRows) m[r.enrollmentId] = { status: r.status as AttStatus, excused: r.excused };
      setMarks(m);
      setAttLoaded(true);
    }).catch(e => notifyError(e, 'Không tải được điểm danh'));
  }, [classSessionId, classBatchId]);

  // Load evidence draft
  useEffect(() => {
    trpc.sessionEvidence.detailForStaff.query({ classSessionId })
      .then(detail => {
        // detailForStaff may return { session: { evidence: {...} } } or the evidence directly
        const ev = (detail as Record<string, unknown>).session
          ? ((detail as Record<string, unknown>).session as Record<string, unknown>).evidence
          : detail;
        const evAny = ev as Record<string, unknown> | undefined | null;
        setDraft({
          summary: (evAny?.summary as string) ?? '',
          internalNote: (evAny?.internalNote as string) ?? '',
          photos: ((evAny?.photos as Array<Record<string, unknown>>) ?? [])
            .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number))
            .map(p => ({ ref: (p.photoRef ?? p.ref) as string })),
        });
        setEvidencePublished(evAny?.status === 'published');
        setDraftLoaded(true);
      })
      .catch(() => setDraftLoaded(true));
  }, [classSessionId]);

  // Load exercises for this class batch
  useEffect(() => {
    trpc.exercise.listByClass.query({ classBatchId })
      .then(setExercises)
      .catch(() => setExercises([]));
  }, [classBatchId]);

  // Load submissions when exercise selected
  useEffect(() => {
    if (!selectedEx) return;
    trpc.submission.listByExercise.query({ exerciseId: selectedEx.id })
      .then(setSubmissions)
      .catch(() => setSubmissions([]));
  }, [selectedEx]);

  // Unified debounced save — both Tab 2 and Tab 4 go through here
  const scheduleSave = useCallback((next: EvidenceDraft) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await trpc.sessionEvidence.upsertDraft.mutate({
          classSessionId,
          summary: next.summary.trim() || undefined,
          internalNote: next.internalNote.trim() || undefined,
          photos: next.photos.map((p, i) => ({ ref: p.ref, sortOrder: i })),
          comments: [],
        });
        setSavedAt(Date.now());
      } catch (e) {
        notifyError(e, 'Lưu thất bại');
      } finally {
        setSaving(false);
      }
    }, 1000);
  }, [classSessionId]);

  function updateDraft(patch: Partial<EvidenceDraft>) {
    setDraft(prev => {
      const next = { ...prev, ...patch };
      scheduleSave(next);
      return next;
    });
  }

  // Attendance handlers
  async function markSingle(enrollmentId: string, status: AttStatus) {
    const prev = marks[enrollmentId];
    const excused = prev?.excused ?? false;
    setMarks(m => ({ ...m, [enrollmentId]: { status, excused } }));
    try {
      await trpc.attendance.mark.mutate({ classSessionId, enrollmentId, status, excused });
    } catch (e) {
      notifyError(e, 'Không lưu được điểm danh');
      setMarks(m => { const n = { ...m }; if (prev === undefined) delete n[enrollmentId]; else n[enrollmentId] = prev; return n; });
    }
  }

  async function markAll() {
    setMarkingAll(true);
    try {
      await trpc.attendance.markAll.mutate({ classSessionId, defaultStatus: 'present', overrides: [] });
      const m: Record<string, AttMark> = {};
      for (const en of enrollments) m[en.id] = { status: 'present', excused: false };
      setMarks(m);
      notifySuccess('Đã điểm danh tất cả');
    } catch (e) {
      notifyError(e, 'Điểm danh thất bại');
    } finally {
      setMarkingAll(false);
    }
  }

  async function handlePhotoUpload(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const ref = await uploadSessionPhoto(file);
        // Use functional update to avoid stale-closure bug when uploading multiple files (H2)
        setDraft(prev => {
          const next = { ...prev, photos: [...prev.photos, { ref }] };
          scheduleSave(next);
          return next;
        });
      } catch (e) {
        notifyError(e, 'Upload ảnh thất bại');
      }
    }
  }

  async function publishEvidence() {
    // Cancel pending debounce — don't let a stale upsertDraft fire after publish (M2)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaving(true);
    try {
      await trpc.sessionEvidence.upsertDraft.mutate({
        classSessionId,
        summary: draft.summary.trim() || undefined,
        internalNote: draft.internalNote.trim() || undefined,
        photos: draft.photos.map((p, i) => ({ ref: p.ref, sortOrder: i })),
        comments: [],
      });
      await trpc.sessionEvidence.publish.mutate({ classSessionId });
      setEvidencePublished(true);
      notifySuccess('Đã đăng nhật ký lên LMS');
    } catch (e) {
      notifyError(e, 'Đăng nhật ký thất bại');
    } finally {
      setSaving(false);
    }
  }

  async function saveGrade() {
    if (!gradingId || typeof gradeScore !== 'number') return;
    try {
      await trpc.grade.grade.mutate({ submissionId: gradingId, score: gradeScore, feedback: gradeFeedback.trim() || undefined });
      notifySuccess('Đã lưu điểm');
      if (selectedEx) {
        trpc.submission.listByExercise.query({ exerciseId: selectedEx.id }).then(setSubmissions).catch(() => {});
      }
    } catch (e) {
      notifyError(e, 'Chấm điểm thất bại');
    }
  }

  const st = SESSION_STATUS[session.status] ?? { label: session.status, color: C.muted };
  const presentCount = enrollments.filter(e => marks[e.id]?.status === 'present').length;
  const savedIndicator = savedAt > 0 ? <span style={{ fontSize: 11, color: C.success }}>✓ Đã lưu</span> : null;

  return (
    <div style={{ fontFamily: FONT, color: C.text }}>
      {/* Sticky header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 24px',
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        position: 'sticky', top: 0, zIndex: 10, flexWrap: 'wrap',
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: C.brand, fontWeight: 600, fontSize: 13, fontFamily: FONT }}>
          ← Lịch dạy
        </button>
        <div style={{ width: 1, height: 16, background: C.border }} />
        <div style={{ fontSize: 14, fontWeight: 700 }}>{session.batch.code}</div>
        <div style={{ fontSize: 13, color: C.muted }}>{dayjs(session.sessionDate).format('DD/MM/YYYY')}</div>
        <div style={{ fontSize: 13, color: C.muted }}>{session.startTime}–{session.endTime}</div>
        <div style={{ padding: '3px 10px', borderRadius: 6, background: C.bg, color: st.color, fontSize: 12, fontWeight: 600 }}>{st.label}</div>
        {attLoaded && (
          <div style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
            {presentCount}/{enrollments.length} có mặt
          </div>
        )}
      </div>

      {/* 4-tab content */}
      <Tabs defaultValue="attendance" style={{ padding: '0 24px' }}>
        <Tabs.List pt="md" mb="xs">
          <Tabs.Tab value="attendance">Điểm danh</Tabs.Tab>
          <Tabs.Tab value="evidence">Ảnh & Nhận xét</Tabs.Tab>
          <Tabs.Tab value="grading">Chấm bài</Tabs.Tab>
          <Tabs.Tab value="notes">Nhật ký</Tabs.Tab>
        </Tabs.List>

        {/* ── Tab 1: Điểm danh ── */}
        <Tabs.Panel value="attendance" pt="sm">
          {!attLoaded ? <Center py="xl"><Loader size="sm" /></Center> : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {enrollments.length} học sinh
                </div>
                <Button size="xs" loading={markingAll} disabled={!enabled || enrollments.length === 0} onClick={markAll}
                  style={{ background: C.brand, color: '#fff', border: 'none', borderRadius: 8, fontFamily: FONT }}>
                  Có mặt tất cả
                </Button>
              </div>
              {enrollments.length === 0 ? (
                <div style={{ textAlign: 'center', color: C.muted, padding: 28, fontSize: 14, background: C.bg, borderRadius: 12 }}>
                  Lớp chưa có học sinh đăng ký
                </div>
              ) : enrollments.map(enr => (
                <StudentRow key={enr.id} name={enr.student.fullName} current={marks[enr.id]?.status ?? null}
                  disabled={!enabled} onMark={s => markSingle(enr.id, s)} />
              ))}
            </div>
          )}
        </Tabs.Panel>

        {/* ── Tab 2: Ảnh & Nhận xét ── */}
        <Tabs.Panel value="evidence" pt="sm">
          <Stack gap="md">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text size="sm" fw={500}>Nhận xét buổi học</Text>
                {savedIndicator}
              </div>
              <Textarea placeholder="Ghi nhận xét..." minRows={3}
                value={draft.summary} disabled={!draftLoaded || !enabled}
                onChange={e => updateDraft({ summary: e.currentTarget.value })} />
            </div>
            <div>
              <Text size="sm" fw={500} mb={8}>Ảnh lớp học</Text>
              {draft.photos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                  {draft.photos.map(p => (
                    <div key={p.ref} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: C.bg }}>
                      <img src={`${API_URL}/files/session-photo/${p.ref}`} alt="" style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                      {enabled && (
                        <button onClick={() => updateDraft({ photos: draft.photos.filter(x => x.ref !== p.ref) })}
                          style={{ position: 'absolute', top: 4, right: 4, background: C.danger, border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', width: 20, height: 20, fontSize: 11, lineHeight: '20px', padding: 0 }}>
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {enabled && (
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                  border: `1.5px dashed ${C.border}`, borderRadius: 8, cursor: 'pointer',
                  fontSize: 13, color: C.muted, background: C.bg, fontFamily: FONT,
                }}>
                  + Thêm ảnh
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                    onChange={e => handlePhotoUpload(e.target.files)} />
                </label>
              )}
            </div>
          </Stack>
        </Tabs.Panel>

        {/* ── Tab 3: Chấm bài ── */}
        <Tabs.Panel value="grading" pt="sm">
          <div style={{ display: 'grid', gridTemplateColumns: '40% 60%', gap: 16, minHeight: 280 }}>
            {/* Exercise list */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Bài tập của lớp</div>
              {exercises.length === 0 ? (
                <Text c="dimmed" size="sm">Chưa có bài tập nào</Text>
              ) : exercises.map(ex => (
                <div key={ex.id} onClick={() => { setSelectedEx(ex); setGradingId(null); }} style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                  background: selectedEx?.id === ex.id ? C.brandMuted : C.surface,
                  border: `1px solid ${selectedEx?.id === ex.id ? C.brand : C.border}`, fontSize: 13,
                }}>
                  <div style={{ fontWeight: 600, color: C.text }}>{ex.title}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{(ex as Record<string, unknown>).type as string ?? ''}</div>
                </div>
              ))}
            </div>
            {/* Submission panel */}
            <div>
              {!selectedEx ? (
                <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>Chọn bài tập để xem bài nộp</div>
              ) : submissions.length === 0 ? (
                <Text c="dimmed" size="sm">Chưa có bài nào được nộp</Text>
              ) : (
                <Stack gap={4}>
                  {submissions.map(sub => {
                    const subAny = sub as Record<string, unknown>;
                    const gradeAny = subAny.grade as Record<string, unknown> | undefined;
                    return (
                      <div key={sub.id} onClick={() => {
                        setGradingId(sub.id);
                        setGradeScore(gradeAny?.score as number ?? '');
                        setGradeFeedback(gradeAny?.feedback as string ?? '');
                      }} style={{
                        padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                        background: gradingId === sub.id ? C.brandMuted : C.surface,
                        border: `1px solid ${gradingId === sub.id ? C.brand : C.border}`,
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{(subAny.student as Record<string, unknown>)?.fullName as string ?? 'Học sinh'}</div>
                        <div style={{ fontSize: 12, color: subAny.status === 'graded' ? C.success : C.muted }}>
                          {subAny.status === 'graded' ? `Đã chấm: ${gradeAny?.score}đ` : 'Đã nộp'}
                        </div>
                      </div>
                    );
                  })}
                </Stack>
              )}
              {gradingId && (
                <div style={{ marginTop: 14, padding: 16, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}` }}>
                  <NumberInput label="Điểm (0–10)" min={0} max={10} step={0.5} value={gradeScore} onChange={setGradeScore} mb="sm" />
                  <Textarea label="Nhận xét" placeholder="Ghi nhận xét..." minRows={2} value={gradeFeedback} onChange={e => setGradeFeedback(e.currentTarget.value)} mb="sm" />
                  <Button size="sm" onClick={saveGrade} style={{ background: C.brand, color: '#fff', fontFamily: FONT }}>Lưu điểm</Button>
                </div>
              )}
            </div>
          </div>
        </Tabs.Panel>

        {/* ── Tab 4: Nhật ký ── */}
        <Tabs.Panel value="notes" pt="sm">
          <Stack gap="md">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text size="sm" fw={500}>Ghi chú nội bộ</Text>
                {savedIndicator}
              </div>
              <Textarea placeholder="Ghi nội dung buổi học, lưu ý nội bộ..."
                minRows={6} value={draft.internalNote}
                disabled={!draftLoaded || !enabled || evidencePublished}
                onChange={e => updateDraft({ internalNote: e.currentTarget.value })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                background: evidencePublished ? C.successBg : C.bg,
                color: evidencePublished ? C.success : C.muted,
              }}>
                {evidencePublished ? '✓ Đã đăng' : 'Nháp'}
              </div>
              {!evidencePublished && enabled && (
                <Button size="sm" color="teal" loading={saving} onClick={publishEvidence}>
                  Đăng nhật ký lên LMS
                </Button>
              )}
            </div>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

// ─── StudentRow ────────────────────────────────────────────────────────────────

function StudentRow({ name, current, disabled, onMark }: {
  name: string;
  current: AttStatus | null;
  disabled?: boolean;
  onMark: (s: AttStatus) => void;
}) {
  const btns: { status: AttStatus; label: string; activeBg: string; activeColor: string }[] = [
    { status: 'present', label: 'Có mặt', activeBg: C.successBg, activeColor: C.success },
    { status: 'late',    label: 'Muộn',   activeBg: C.warningBg, activeColor: C.warning },
    { status: 'absent',  label: 'Vắng',   activeBg: C.dangerBg,  activeColor: C.danger },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, gap: 10 }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: C.brandMuted, color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
        {name.charAt(0).toUpperCase()}
      </div>
      <div style={{ flex: 1, fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>
        {name}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {btns.map(btn => {
          const active = current === btn.status;
          return (
            <button key={btn.status} onClick={() => !disabled && onMark(btn.status)} disabled={disabled}
              style={{
                padding: '5px 10px', borderRadius: 7, fontFamily: FONT,
                border: active ? `1.5px solid ${btn.activeColor}` : `1px solid ${C.border}`,
                background: active ? btn.activeBg : C.surface,
                color: active ? btn.activeColor : C.muted,
                fontSize: 12, fontWeight: active ? 700 : 500,
                cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
              }}>
              {btn.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
