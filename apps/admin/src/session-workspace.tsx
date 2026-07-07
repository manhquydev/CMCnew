import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Button, Center, Loader } from '@mantine/core';
import { notifyError, notifySuccess, trpc } from '@cmc/ui';
import { SessionEvidencePanel } from './session-evidence-panel.js';

type SessionRow = Awaited<ReturnType<typeof trpc.schedule.listSessions.query>>[number];
type Enrollment = Awaited<ReturnType<typeof trpc.enrollment.listByBatch.query>>[number];

const C = {
  brand: '#0071E3',
  brandMuted: '#E8F1FC',
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
  dangerBg: '#FCE8E6',
  danger: '#C5221F',
};

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

type AttStatus = 'present' | 'late' | 'absent';

interface AttMark {
  status: AttStatus;
  excused: boolean;
}

interface SessionWorkspaceProps {
  classSessionId: string;
  batchId: string;
  batchCode?: string;
  onBack: () => void;
}

export function SessionWorkspace({
  classSessionId,
  batchId,
  batchCode,
  onBack,
}: SessionWorkspaceProps) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [marks, setMarks] = useState<Record<string, AttMark>>({});
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      trpc.schedule.listSessions.query({ classBatchId: batchId }),
      trpc.enrollment.listByBatch.query({ classBatchId: batchId }),
      trpc.attendance.listBySession.query({ classSessionId }),
    ])
      .then(([sessions, enrs, attRows]) => {
        setSession(sessions.find((s) => s.id === classSessionId) ?? null);
        setEnrollments(enrs);
        const m: Record<string, AttMark> = {};
        for (const r of attRows) {
          m[r.enrollmentId] = { status: r.status as AttStatus, excused: r.excused };
        }
        setMarks(m);
      })
      .catch((e) => notifyError(e, 'Không tải được dữ liệu buổi học'))
      .finally(() => setLoading(false));
  }, [classSessionId, batchId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function markSingle(enrollmentId: string, status: AttStatus) {
    const prev = marks[enrollmentId];
    setMarks((m) => ({ ...m, [enrollmentId]: { status, excused: prev?.excused ?? false } }));
    try {
      await trpc.attendance.mark.mutate({
        classSessionId,
        enrollmentId,
        status,
        excused: false,
      });
    } catch (e) {
      notifyError(e, 'Không lưu được điểm danh');
      setMarks((m) => ({ ...m, [enrollmentId]: prev ?? { status: 'absent', excused: false } }));
    }
  }

  async function markAll() {
    setMarkingAll(true);
    try {
      await trpc.attendance.markAll.mutate({
        classSessionId,
        defaultStatus: 'present',
        overrides: [],
      });
      const m: Record<string, AttMark> = {};
      for (const en of enrollments) m[en.id] = { status: 'present', excused: false };
      setMarks(m);
      notifySuccess('Đã điểm danh tất cả học sinh');
    } catch (e) {
      notifyError(e, 'Không điểm danh được');
    } finally {
      setMarkingAll(false);
    }
  }

  // Count badges
  const presentCount = enrollments.filter((e) => marks[e.id]?.status === 'present').length;
  const lateCount = enrollments.filter((e) => marks[e.id]?.status === 'late').length;
  const absentCount = enrollments.filter((e) => marks[e.id]?.status === 'absent').length;
  const unmarkedCount = enrollments.filter((e) => !marks[e.id]).length;

  const sessionDate = session
    ? dayjs(session.sessionDate).format('DD/MM/YYYY')
    : '—';
  const timeRange = session ? `${session.startTime} – ${session.endTime}` : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT }}>
      {/* Header */}
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
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          ← Quay lại
        </button>

        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
          {batchCode ?? '—'}
        </div>
        <div style={{ fontSize: 13, color: C.muted }}>
          {sessionDate} · {timeRange}
        </div>

        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <CountBadge label="Có mặt" count={presentCount} bg={C.successBg} color={C.success} />
          <CountBadge label="Muộn" count={lateCount} bg={C.warningBg} color={C.warning} />
          <CountBadge label="Vắng" count={absentCount} bg={C.dangerBg} color={C.danger} />
          <CountBadge label="Chưa ghi" count={unmarkedCount} bg={C.bg} color={C.muted} />
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <Center style={{ flex: 1 }}>
          <Loader size="sm" />
        </Center>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '1fr 380px',
            overflow: 'hidden',
          }}
        >
          {/* Left: attendance roster */}
          <div
            style={{
              borderRight: `1px solid ${C.border}`,
              overflowY: 'auto',
              padding: '20px 24px',
            }}
          >
            {/* Bulk action */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Điểm danh · {enrollments.length} học sinh
              </div>
              <Button
                size="xs"
                loading={markingAll}
                onClick={markAll}
                style={{ background: C.brand, color: '#fff', border: 'none', borderRadius: 8, fontFamily: FONT }}
              >
                Có mặt tất cả
              </Button>
            </div>

            {enrollments.length === 0 ? (
              <div style={{ textAlign: 'center', color: C.muted, fontSize: 14, padding: 24 }}>
                Chưa có học sinh trong lớp
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {enrollments.map((enr) => {
                  const mark = marks[enr.id];
                  return (
                    <StudentRow
                      key={enr.id}
                      name={enr.student.fullName}
                      current={mark?.status ?? null}
                      onMark={(status) => markSingle(enr.id, status)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: session evidence */}
          <div style={{ overflowY: 'auto', padding: '20px 24px' }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: C.muted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 14,
              }}
            >
              Nhật ký buổi học
            </div>
            <SessionEvidencePanel
              classSessionId={classSessionId}
              enabled={session?.status !== 'cancelled'}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CountBadge({
  label,
  count,
  bg,
  color,
}: {
  label: string;
  count: number;
  bg: string;
  color: string;
}) {
  return (
    <div
      style={{
        padding: '4px 10px',
        borderRadius: 20,
        background: bg,
        color,
        fontSize: 12,
        fontWeight: 600,
        display: 'flex',
        gap: 5,
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700 }}>{count}</span>
      <span>{label}</span>
    </div>
  );
}

function StudentRow({
  name,
  current,
  onMark,
}: {
  name: string;
  current: AttStatus | null;
  onMark: (s: AttStatus) => void;
}) {
  const buttons: { status: AttStatus; label: string; bg: string; color: string; activeBg: string; activeColor: string }[] = [
    { status: 'present', label: 'Có mặt', bg: C.bg, color: C.muted, activeBg: C.successBg, activeColor: C.success },
    { status: 'late', label: 'Muộn', bg: C.bg, color: C.muted, activeBg: C.warningBg, activeColor: C.warning },
    { status: 'absent', label: 'Vắng', bg: C.bg, color: C.muted, activeBg: C.dangerBg, activeColor: C.danger },
  ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        borderRadius: 10,
        gap: 12,
      }}
    >
      {/* Initials avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: C.brandMuted,
          color: C.brand,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>

      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </div>

      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {buttons.map((btn) => {
          const active = current === btn.status;
          return (
            <button
              key={btn.status}
              onClick={() => onMark(btn.status)}
              style={{
                padding: '5px 10px',
                borderRadius: 7,
                border: active ? `1.5px solid ${btn.activeColor}` : `1px solid ${C.border}`,
                background: active ? btn.activeBg : C.surface,
                color: active ? btn.activeColor : C.muted,
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                fontFamily: FONT,
                transition: 'all 0.1s',
              }}
            >
              {btn.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
