import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, useSession, notifyError, notifySuccess } from '@cmc/ui';
import { Alert, Button, Checkbox, Group, Loader, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

type Enrollment = Awaited<ReturnType<typeof trpc.enrollment.listByBatch.query>>[number];
type ClassSessionRow = Awaited<ReturnType<typeof trpc.schedule.listSessions.query>>[number];

interface AttendanceRosterProps {
  /** The session to mark attendance for. */
  classSessionId: string;
  /** The batch to load enrolled students from. */
  batchId: string;
  facilityId: number;
}

// Người quản lý (không phải giáo viên trực tiếp phụ trách) vẫn được phép điểm danh — chỉ giáo
// viên mới bị cảnh báo "không phải người phụ trách". Khớp với authz thật của scheduleRouter.mySessions
// (giam_doc_dao_tao / super_admin xem toàn cơ sở, giao_vien chỉ xem buổi của mình).
const MANAGER_ROLES = new Set(['giam_doc_dao_tao']);

/**
 * Shared attendance-marking table: shows all enrolled students for a batch
 * and lets the user mark each one present / late / absent with optional excused flag.
 * Reused by AttendanceTab (ClassDetail) and AttendancePanel (cross-class today view).
 *
 * #8: the server (attendance.mark) does NOT reject future-dated or unassigned-teacher sessions —
 * it only checks the caller's `attendance:mark` role permission (apps/api/src/routers/attendance.ts).
 * So there is no server rule to mirror as a hard block; instead this surfaces a warning and requires
 * an explicit "Vẫn điểm danh" confirm before enabling the mark controls, matching what the server
 * already allows rather than inventing a stricter client-only rule.
 */
export function AttendanceRoster({ classSessionId, batchId, facilityId }: AttendanceRosterProps) {
  const { me } = useSession();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [marks, setMarks] = useState<Record<string, { status: string; excused: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<ClassSessionRow | null>(null);
  const [confirmedAnyway, setConfirmedAnyway] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      trpc.enrollment.listByBatch.query({ classBatchId: batchId }),
      trpc.attendance.listBySession.query({ classSessionId }),
    ])
      .then(([enrs, rows]) => {
        setEnrollments(enrs);
        const m: Record<string, { status: string; excused: boolean }> = {};
        for (const r of rows) m[r.enrollmentId] = { status: r.status, excused: r.excused };
        setMarks(m);
      })
      .catch((e) => notifyError(e, 'Không tải được dữ liệu điểm danh'))
      .finally(() => setLoading(false));
  }, [classSessionId, batchId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load the session's own date/time/teacher so the guard below can warn on future-dated or
  // unassigned sessions. Reuses schedule.listSessions (already scoped to this batch via batchId)
  // instead of adding a new by-id endpoint.
  useEffect(() => {
    setConfirmedAnyway(false);
    trpc.schedule.listSessions
      .query({ classBatchId: batchId })
      .then((rows) => setSessionInfo(rows.find((r) => r.id === classSessionId) ?? null))
      .catch(() => setSessionInfo(null));
  }, [batchId, classSessionId]);

  const isManager = me.isSuperAdmin || me.roles.some((r) => MANAGER_ROLES.has(r));
  const isFuture =
    !!sessionInfo &&
    dayjs(`${dayjs(sessionInfo.sessionDate).format('YYYY-MM-DD')}T${sessionInfo.startTime}:00`).isAfter(dayjs());
  const isUnassigned = !!sessionInfo && !sessionInfo.teacherId;
  const isOtherTeacher =
    !!sessionInfo && !!sessionInfo.teacherId && sessionInfo.teacherId !== me.userId && !isManager;
  const guardActive = isFuture || isUnassigned || isOtherTeacher;
  const markingLocked = guardActive && !confirmedAnyway;

  async function mark(enrollmentId: string, status: string, excused: boolean) {
    if (!status) return;
    try {
      await trpc.attendance.mark.mutate({
        facilityId,
        classSessionId,
        enrollmentId,
        status: status as 'present' | 'absent' | 'late',
        excused,
      });
      setMarks((m) => ({ ...m, [enrollmentId]: { status, excused } }));
    } catch (e) {
      notifyError(e, 'Điểm danh thất bại');
    }
  }

  // "Điểm danh tất cả có mặt": mọi học sinh chưa có override riêng (giữ trạng thái/có phép hiện
  // tại nếu đã điểm danh trước đó) nhận "present" trong 1 lần gọi thay vì bấm từng dòng.
  async function markAllPresent() {
    setMarkingAll(true);
    try {
      const overrides = enrollments
        .filter((e) => marks[e.id]?.status)
        .map((e) => ({
          enrollmentId: e.id,
          status: marks[e.id]!.status as 'present' | 'absent' | 'late',
          excused: marks[e.id]!.excused,
        }));
      await trpc.attendance.markAll.mutate({
        classSessionId,
        defaultStatus: 'present',
        overrides,
      });
      notifySuccess('Đã điểm danh tất cả học sinh có mặt');
      loadData();
    } catch (e) {
      notifyError(e, 'Điểm danh tất cả thất bại');
    } finally {
      setMarkingAll(false);
    }
  }

  if (loading) return <Loader size="sm" />;
  if (enrollments.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        Chưa có học sinh ghi danh lớp này.
      </Text>
    );
  }

  const guardReasons: string[] = [];
  if (isFuture) guardReasons.push('Buổi học chưa diễn ra');
  if (isUnassigned) guardReasons.push('buổi học chưa gán giáo viên phụ trách');
  else if (isOtherTeacher) guardReasons.push('bạn không phải giáo viên phụ trách buổi học này');

  return (
    <Stack gap="xs">
      {guardActive && (
        <Alert icon={<IconAlertTriangle size={16} />} color="yellow" title="Cảnh báo điểm danh">
          <Stack gap="xs">
            <Text size="sm">
              {guardReasons.join(', ')} — điểm danh lúc này có thể không chính xác.
            </Text>
            {!confirmedAnyway && (
              <Group>
                <Button size="xs" variant="outline" color="yellow" onClick={() => setConfirmedAnyway(true)}>
                  Vẫn điểm danh
                </Button>
              </Group>
            )}
          </Stack>
        </Alert>
      )}
      <Group justify="flex-end">
        <Button size="xs" variant="light" loading={markingAll} onClick={markAllPresent} disabled={markingLocked}>
          Điểm danh tất cả có mặt
        </Button>
      </Group>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Học sinh</Table.Th>
            <Table.Th>Điểm danh</Table.Th>
            <Table.Th>Có phép</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {enrollments.map((e) => {
            const cur = marks[e.id];
            return (
              <Table.Tr key={e.id}>
                <Table.Td>{e.student.fullName}</Table.Td>
                <Table.Td>
                  <SegmentedControl
                    size="xs"
                    disabled={markingLocked}
                    data={[
                      { value: 'present', label: 'Có mặt' },
                      { value: 'late', label: 'Muộn' },
                      { value: 'absent', label: 'Vắng' },
                    ]}
                    value={cur?.status ?? ''}
                    onChange={(v) => mark(e.id, v, cur?.excused ?? false)}
                  />
                </Table.Td>
                <Table.Td>
                  <Checkbox
                    checked={cur?.excused ?? false}
                    disabled={!cur?.status || markingLocked}
                    onChange={(ev) => mark(e.id, cur?.status ?? '', ev.currentTarget.checked)}
                  />
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
