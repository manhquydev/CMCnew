import { useCallback, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { API_URL, Chatter, notifyError, notifyInfo, notifySuccess, PdfAnnotator, trpc, uploadSessionPhoto, useSession, WorkflowStatusbar } from '@cmc/ui';
import { Button, Center, Drawer, Group, Loader, Menu, Modal, NumberInput, Select, Stack, Tabs, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { can } from '@cmc/auth/permissions';
import { effectiveSessionStatus, SESSION_STAGES, SESSION_TERMINAL } from './session-status';
import { StudentDetailPanel } from './student-detail.js';

/** Client-side mirror of the server's attendance window (attendance-window.ts): opens 15min
 * before the session's scheduled start, closes at the end of that ICT calendar day. This is a
 * convenience-only duplicate (KISS) — the server remains the enforcing source of truth. Follows
 * the same local-browser-time convention as effectiveSessionStatus in ./session-status.ts (the
 * admin app assumes the browser runs in ICT). */
function attendanceWindowOpen(sessionDate: string | Date, startTime: string): boolean {
  const day = dayjs(sessionDate).format('YYYY-MM-DD');
  const opensAt = dayjs(`${day}T${startTime}`).subtract(15, 'minute');
  const closesAt = dayjs(day).endOf('day');
  const now = dayjs();
  return !now.isBefore(opensAt) && !now.isAfter(closesAt);
}

function attendanceOpensAtLabel(sessionDate: string | Date, startTime: string): string {
  const day = dayjs(sessionDate).format('YYYY-MM-DD');
  return dayjs(`${day}T${startTime}`).subtract(15, 'minute').format('HH:mm');
}

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

type AttStatus = 'present' | 'late' | 'absent';
interface AttMark { status: AttStatus; excused: boolean }

type StudentComment = {
  participation?: string;
  strength?: string;
  needsImprovement?: string;
  teacherNote?: string;
};

/** Record<studentId, comment> -> the array shape sessionEvidence.upsertDraft expects; drops
 * entries with no field set so an untouched student never creates an empty comment row. */
function commentsToArray(comments: Record<string, StudentComment>) {
  return Object.entries(comments)
    .filter(([, c]) => c.participation || c.strength || c.needsImprovement || c.teacherNote?.trim())
    .map(([studentId, c]) => ({
      studentId,
      participation: c.participation as 'Tích cực' | 'Ổn định' | 'Cần khuyến khích thêm' | undefined,
      strength: c.strength as 'Tư duy logic' | 'Sáng tạo' | 'Giao tiếp' | 'Tập trung' | 'Hợp tác' | undefined,
      needsImprovement: c.needsImprovement as 'Luyện trình bày' | 'Tăng tập trung' | 'Ôn kiến thức nền' | 'Mạnh dạn phát biểu' | undefined,
      teacherNote: c.teacherNote?.trim() || undefined,
    }));
}

type EvidenceDraft = {
  summary: string;
  internalNote: string;
  photos: Array<{ ref: string }>;
  /** Nhận xét riêng từng học sinh (participation/strength/needsImprovement/teacherNote), keyed by studentId. */
  comments: Record<string, StudentComment>;
};

export interface SessionDetailProps {
  session: MySession;
  onBack: () => void;
  /** Called after a mutation that changes the calendar (e.g. cancel) so the list refetches. */
  onChanged?: () => void;
}

export function TeacherScheduleDetail({ session, onBack, onChanged }: SessionDetailProps) {
  const enabled = session.status !== 'cancelled';
  const attendanceOpen = attendanceWindowOpen(session.sessionDate, session.startTime);
  const classSessionId = session.id;
  const classBatchId = session.classBatchId;
  const { me } = useSession();
  const canCancel = can(me.roles, me.isSuperAdmin, 'teacherLite', 'cancelSession');

  // ── Attendance ──────────────────────────────────────────────────────────────
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [marks, setMarks] = useState<Record<string, AttMark>>({});
  const [markingAll, setMarkingAll] = useState(false);
  const [attLoaded, setAttLoaded] = useState(false);
  const [drawerStudentId, setDrawerStudentId] = useState<string | null>(null);

  // ── Evidence (unified state prevents Tab 2 / Tab 4 race) ────────────────────
  const [draft, setDraft] = useState<EvidenceDraft>({ summary: '', internalNote: '', photos: [], comments: {} });
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [commentTemplate, setCommentTemplate] = useState<{
    participation: readonly string[]; strength: readonly string[]; needsImprovement: readonly string[];
  } | null>(null);
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
  // Bài HS làm trên PDF (annotation layer) — hiển thị cho GV chấm, đúng prototype "Chấm bài".
  const [gradingLayer, setGradingLayer] = useState<
    Awaited<ReturnType<typeof trpc.submission.layerForGrading.query>> | null
  >(null);

  // ── Cancel session / class ──────────────────────────────────────────────────
  const [cancelKind, setCancelKind] = useState<null | 'class' | 'session'>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

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
        const comments: Record<string, StudentComment> = {};
        for (const c of (evAny?.comments as Array<Record<string, unknown>>) ?? []) {
          comments[c.studentId as string] = {
            participation: (c.participation as string) ?? undefined,
            strength: (c.strength as string) ?? undefined,
            needsImprovement: (c.needsImprovement as string) ?? undefined,
            teacherNote: (c.teacherNote as string) ?? undefined,
          };
        }
        setDraft({
          summary: (evAny?.summary as string) ?? '',
          internalNote: (evAny?.internalNote as string) ?? '',
          photos: ((evAny?.photos as Array<Record<string, unknown>>) ?? [])
            .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number))
            .map(p => ({ ref: (p.photoRef ?? p.ref) as string })),
          comments,
        });
        setEvidencePublished(evAny?.status === 'published');
        setDraftLoaded(true);
      })
      .catch(() => setDraftLoaded(true));
    trpc.sessionEvidence.commentTemplate.query().then(setCommentTemplate).catch(() => {});
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

  // Server may silently drop photo refs whose file no longer exists on disk (e.g. wiped by a
  // redeploy) rather than blocking the whole save — sync local state to the server's truth and
  // tell the teacher, so a dead ref isn't resubmitted forever on every subsequent save.
  function applyDraftSaveResult(result: Awaited<ReturnType<typeof trpc.sessionEvidence.upsertDraft.mutate>>) {
    if (result.droppedPhotoCount > 0) {
      notifyInfo(`${result.droppedPhotoCount} ảnh bị lỗi (file gốc không còn) đã được tự động gỡ khỏi buổi học — tải lại ảnh nếu cần.`, 'Ảnh lỗi đã được gỡ');
      setDraft(prev => ({ ...prev, photos: result.photos.map((p) => ({ ref: p.photoRef })) }));
    }
  }

  // Unified debounced save — both Tab 2 and Tab 4 go through here
  const scheduleSave = useCallback((next: EvidenceDraft) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const result = await trpc.sessionEvidence.upsertDraft.mutate({
          classSessionId,
          summary: next.summary.trim() || undefined,
          internalNote: next.internalNote.trim() || undefined,
          photos: next.photos.map((p, i) => ({ ref: p.ref, sortOrder: i })),
          comments: commentsToArray(next.comments),
        });
        applyDraftSaveResult(result);
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

  /** Nhận xét riêng cho 1 học sinh (participation/strength/needsImprovement/teacherNote). */
  function updateStudentComment(studentId: string, patch: Partial<StudentComment>) {
    setDraft(prev => {
      const next = {
        ...prev,
        comments: { ...prev.comments, [studentId]: { ...prev.comments[studentId], ...patch } },
      };
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
        let saved: EvidenceDraft | null = null;
        setDraft(prev => {
          saved = { ...prev, photos: [...prev.photos, { ref }] };
          return saved;
        });
        if (!saved) continue;
        // Save the new photo IMMEDIATELY (bypass the 1s debounce used for text fields) — the
        // <img> below renders as soon as the ref lands in state and requests /files/session-photo/
        // right away, but the file route only serves refs already linked in sessionEvidencePhoto
        // (RLS-safe visibility gate). Debouncing here would 403 the freshly-uploaded photo until
        // the debounce fires.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setSaving(true);
        try {
          const next: EvidenceDraft = saved;
          const result = await trpc.sessionEvidence.upsertDraft.mutate({
            classSessionId,
            summary: next.summary.trim() || undefined,
            internalNote: next.internalNote.trim() || undefined,
            photos: next.photos.map((p, i) => ({ ref: p.ref, sortOrder: i })),
            comments: commentsToArray(next.comments),
          });
          applyDraftSaveResult(result);
          setSavedAt(Date.now());
        } finally {
          setSaving(false);
        }
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
      const result = await trpc.sessionEvidence.upsertDraft.mutate({
        classSessionId,
        summary: draft.summary.trim() || undefined,
        internalNote: draft.internalNote.trim() || undefined,
        photos: draft.photos.map((p, i) => ({ ref: p.ref, sortOrder: i })),
        comments: commentsToArray(draft.comments),
      });
      applyDraftSaveResult(result);
      await trpc.sessionEvidence.publish.mutate({ classSessionId });
      setEvidencePublished(true);
      notifySuccess('Đã đăng nhật ký lên LMS');
    } catch (e) {
      notifyError(e, 'Đăng nhật ký thất bại');
    } finally {
      setSaving(false);
    }
  }

  async function submitCancel() {
    const reason = cancelReason.trim();
    if (!reason) {
      notifyError('Nhập lý do hủy.', 'Thiếu thông tin');
      return;
    }
    setCancelBusy(true);
    try {
      if (cancelKind === 'class') {
        const r = await trpc.teacherLite.cancelClass.mutate({ id: classBatchId, reason });
        notifySuccess(`Đã hủy lớp, ${r.cancelledSessions} buổi tương lai đã hủy.`);
      } else {
        await trpc.teacherLite.cancelSession.mutate({ sessionId: classSessionId, reason });
        notifySuccess('Đã hủy buổi học.');
      }
      setCancelKind(null);
      setCancelReason('');
      onChanged?.(); // refetch calendar so the cancelled status shows immediately
      onBack();
    } catch (e) {
      notifyError(e, cancelKind === 'class' ? 'Không hủy được lớp' : 'Không hủy được buổi học');
    } finally {
      setCancelBusy(false);
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
        <WorkflowStatusbar
          stages={SESSION_STAGES}
          terminal={SESSION_TERMINAL}
          current={effectiveSessionStatus(session.sessionDate, session.startTime, session.endTime, session.status).stage}
          ariaLabel="Trạng thái buổi học"
        />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {attLoaded && (
            <div style={{ fontSize: 12, color: C.muted }}>
              {presentCount}/{enrollments.length} có mặt
            </div>
          )}
          {canCancel && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button size="xs" variant="default" style={{ fontFamily: FONT }}>Thao tác</Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item color="orange" disabled={!enabled} onClick={() => { setCancelReason(''); setCancelKind('session'); }}>
                  Hủy buổi học
                </Menu.Item>
                <Menu.Item color="red" onClick={() => { setCancelReason(''); setCancelKind('class'); }}>
                  Hủy lớp
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </div>
      </div>

      {/* 4-tab content */}
      <Tabs defaultValue="attendance" style={{ padding: '0 24px' }}>
        <Tabs.List pt="md" mb="xs">
          <Tabs.Tab value="attendance">Điểm danh</Tabs.Tab>
          <Tabs.Tab value="evidence">Ảnh & Nhận xét</Tabs.Tab>
          <Tabs.Tab value="grading">Chấm bài</Tabs.Tab>
          <Tabs.Tab value="notes">Nhật ký</Tabs.Tab>
          <Tabs.Tab value="history">Lịch sử</Tabs.Tab>
        </Tabs.List>

        {/* ── Tab 1: Điểm danh ── */}
        <Tabs.Panel value="attendance" pt="sm">
          {!attLoaded ? <Center py="xl"><Loader size="sm" /></Center> : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {enrollments.length} học sinh
                </div>
                <Tooltip
                  label={`Mở điểm danh từ ${attendanceOpensAtLabel(session.sessionDate, session.startTime)}`}
                  disabled={attendanceOpen}
                >
                  <Button size="xs" loading={markingAll} disabled={!enabled || !attendanceOpen || enrollments.length === 0} onClick={markAll}
                    style={{ background: C.brand, color: '#fff', border: 'none', borderRadius: 8, fontFamily: FONT }}>
                    Có mặt tất cả
                  </Button>
                </Tooltip>
              </div>
              {enrollments.length === 0 ? (
                <div style={{ textAlign: 'center', color: C.muted, padding: 28, fontSize: 14, background: C.bg, borderRadius: 12 }}>
                  Lớp chưa có học sinh đăng ký
                </div>
              ) : enrollments.map(enr => (
                <StudentRow key={enr.id} name={enr.student.fullName} current={marks[enr.id]?.status ?? null}
                  disabled={!enabled || !attendanceOpen} onMark={s => markSingle(enr.id, s)}
                  onOpenStudent={() => setDrawerStudentId(enr.studentId)} />
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
              <Text size="sm" fw={500} mb={8}>Nhận xét từng học sinh</Text>
              {(() => {
                const attended = enrollments.filter(enr => {
                  const s = marks[enr.id]?.status;
                  return s === 'present' || s === 'late';
                });
                if (!attLoaded) return <Text size="xs" c="dimmed">Đang tải điểm danh…</Text>;
                if (attended.length === 0) {
                  return <Text size="xs" c="dimmed">Điểm danh trước để nhận xét từng học sinh có mặt.</Text>;
                }
                return (
                  <Stack gap={10}>
                    {attended.map(enr => {
                      const c = draft.comments[enr.studentId] ?? {};
                      return (
                        <div key={enr.id} style={{ padding: 10, background: C.bg, borderRadius: 8 }}>
                          <Text size="xs" fw={600} mb={6}>{enr.student.fullName}</Text>
                          <Group gap={6} grow mb={6}>
                            <Select size="xs" placeholder="Tham gia" clearable
                              data={commentTemplate?.participation as unknown as string[] ?? []}
                              value={c.participation ?? null} disabled={!enabled}
                              onChange={v => updateStudentComment(enr.studentId, { participation: v ?? undefined })} />
                            <Select size="xs" placeholder="Điểm mạnh" clearable
                              data={commentTemplate?.strength as unknown as string[] ?? []}
                              value={c.strength ?? null} disabled={!enabled}
                              onChange={v => updateStudentComment(enr.studentId, { strength: v ?? undefined })} />
                            <Select size="xs" placeholder="Cần cải thiện" clearable
                              data={commentTemplate?.needsImprovement as unknown as string[] ?? []}
                              value={c.needsImprovement ?? null} disabled={!enabled}
                              onChange={v => updateStudentComment(enr.studentId, { needsImprovement: v ?? undefined })} />
                          </Group>
                          <TextInput size="xs" placeholder="Ghi chú thêm (tuỳ chọn)..."
                            value={c.teacherNote ?? ''} disabled={!enabled}
                            onChange={e => updateStudentComment(enr.studentId, { teacherNote: e.currentTarget.value })} />
                        </div>
                      );
                    })}
                  </Stack>
                );
              })()}
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
                        // Tải bài HS làm trên PDF (nếu bài tập có đề PDF) để GV xem khi chấm.
                        setGradingLayer(null);
                        if (selectedEx?.basePdfRef) {
                          trpc.submission.layerForGrading.query({ submissionId: sub.id })
                            .then(setGradingLayer)
                            .catch(() => setGradingLayer(null));
                        }
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
              {gradingId && (() => {
                const gradingSub = submissions.find(s => s.id === gradingId) as Record<string, unknown> | undefined;
                const answerText = (gradingSub?.answerText as string | null | undefined)?.trim();
                const hasPdfWork = Boolean(selectedEx?.basePdfRef && gradingLayer?.student);
                return (
                  <div style={{ marginTop: 14, padding: 16, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}` }}>
                    {hasPdfWork && (
                      <div style={{ marginBottom: 12 }}>
                        <Text size="xs" fw={600} mb={4}>Bài học sinh đã làm</Text>
                        <PdfAnnotator
                          pdfRef={selectedEx!.basePdfRef!}
                          value={gradingLayer!.student}
                          onChange={() => {}}
                          editable={false}
                        />
                      </div>
                    )}
                    {answerText && (
                      <div style={{ marginBottom: 12 }}>
                        <Text size="xs" fw={600} mb={4}>Câu trả lời của học sinh</Text>
                        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{answerText}</Text>
                      </div>
                    )}
                    {!hasPdfWork && !answerText && (
                      <Text size="sm" c="dimmed" mb="sm">Học sinh chưa lưu bài làm (chưa vẽ trên PDF hoặc chưa nhập câu trả lời).</Text>
                    )}
                    <NumberInput label="Điểm (0–10)" min={0} max={10} step={0.5} value={gradeScore} onChange={setGradeScore} mb="sm" />
                    <Textarea label="Nhận xét" placeholder="Ghi nhận xét..." minRows={2} value={gradeFeedback} onChange={e => setGradeFeedback(e.currentTarget.value)} mb="sm" />
                    <Button size="sm" onClick={saveGrade} style={{ background: C.brand, color: '#fff', fontFamily: FONT }}>Lưu điểm</Button>
                  </div>
                );
              })()}
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

        {/* ── Tab 5: Lịch sử ── audit timeline "ai điểm danh/chấm/hủy buổi lúc nào" (class_session
            đã whitelist trong audit.NOTE_TARGETS). ── */}
        <Tabs.Panel value="history" pt="sm">
          <Chatter entityType="class_session" entityId={classSessionId} />
        </Tabs.Panel>
      </Tabs>

      <Drawer
        opened={drawerStudentId !== null}
        onClose={() => setDrawerStudentId(null)}
        position="right"
        size="lg"
        padding={0}
        withCloseButton={false}
        title={null}
      >
        {drawerStudentId && (
          <StudentDetailPanel
            studentId={drawerStudentId}
            onBack={() => setDrawerStudentId(null)}
          />
        )}
      </Drawer>

      <Modal
        opened={cancelKind !== null}
        onClose={() => setCancelKind(null)}
        title={cancelKind === 'class' ? 'Xác nhận hủy lớp' : 'Xác nhận hủy buổi học'}
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {cancelKind === 'class'
              ? 'Hủy lớp sẽ hủy TẤT CẢ buổi học tương lai và các buổi họp phụ huynh đã lên lịch. Buổi đã diễn ra được giữ lại. Hành động này được ghi log.'
              : 'Hủy buổi học này. Hành động được ghi log kèm lý do.'}
          </Text>
          <Textarea
            label="Lý do hủy"
            withAsterisk
            placeholder="Nhập lý do..."
            minRows={2}
            value={cancelReason}
            onChange={e => setCancelReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" disabled={cancelBusy} onClick={() => setCancelKind(null)}>
              Quay lại
            </Button>
            <Button
              color={cancelKind === 'class' ? 'red' : 'orange'}
              loading={cancelBusy}
              disabled={!cancelReason.trim()}
              onClick={submitCancel}
            >
              Xác nhận hủy
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

// ─── StudentRow ────────────────────────────────────────────────────────────────

function StudentRow({ name, current, disabled, onMark, onOpenStudent }: {
  name: string;
  current: AttStatus | null;
  disabled?: boolean;
  onMark: (s: AttStatus) => void;
  onOpenStudent: () => void;
}) {
  const btns: { status: AttStatus; label: string; activeBg: string; activeColor: string }[] = [
    { status: 'present', label: 'Có mặt', activeBg: C.successBg, activeColor: C.success },
    { status: 'late',    label: 'Muộn',   activeBg: C.warningBg, activeColor: C.warning },
    { status: 'absent',  label: 'Vắng',   activeBg: C.dangerBg,  activeColor: C.danger },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, gap: 10 }}>
      <div
        onClick={onOpenStudent}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpenStudent(); }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }}
        title="Xem hồ sơ học sinh"
      >
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: C.brandMuted, color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          {name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text, minWidth: 0 }}>
          {name}
        </div>
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
