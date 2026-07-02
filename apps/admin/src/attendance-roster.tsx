import { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import { Button, Checkbox, Group, Loader, SegmentedControl, Stack, Table, Text } from '@mantine/core';

type Enrollment = Awaited<ReturnType<typeof trpc.enrollment.listByBatch.query>>[number];

interface AttendanceRosterProps {
  /** The session to mark attendance for. */
  classSessionId: string;
  /** The batch to load enrolled students from. */
  batchId: string;
  facilityId: number;
}

/**
 * Shared attendance-marking table: shows all enrolled students for a batch
 * and lets the user mark each one present / late / absent with optional excused flag.
 * Reused by AttendanceTab (ClassDetail) and AttendancePanel (cross-class today view).
 */
export function AttendanceRoster({ classSessionId, batchId, facilityId }: AttendanceRosterProps) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [marks, setMarks] = useState<Record<string, { status: string; excused: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

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

  return (
    <Stack gap="xs">
      <Group justify="flex-end">
        <Button size="xs" variant="light" loading={markingAll} onClick={markAllPresent}>
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
                    disabled={!cur?.status}
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
