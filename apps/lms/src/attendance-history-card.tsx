import { useEffect, useState } from 'react';
import { trpc, notifyError } from '@cmc/ui';
import { Alert, Badge, Card, Center, Group, Loader, Table, Text } from '@mantine/core';

type AttendanceRow = Awaited<ReturnType<typeof trpc.attendance.forStudent.query>>[number];

const ATTENDANCE_STATUS_LABEL: Record<AttendanceRow['status'], string> = {
  present: 'Có mặt',
  late: 'Muộn',
  absent: 'Vắng',
};
const ATTENDANCE_STATUS_COLOR: Record<AttendanceRow['status'], string> = {
  present: 'teal',
  late: 'yellow',
  absent: 'red',
};

const thStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
};

/**
 * Per-session điểm danh cho phụ huynh/học sinh: mỗi buổi kèm badge trạng thái, thay vì chỉ tỷ lệ
 * tổng hợp (vốn đã có ở tab "Học bạ"). Nguồn dữ liệu riêng (attendance.forStudent) — không đụng vào
 * SessionEvidenceTab (nhật ký học tập) hiển thị ngay bên dưới trong cùng tab.
 * Shared between parent-view.tsx and student-view.tsx (P6 finding #32 — attendance wasn't
 * discoverable for the student persona at all; extracted so both personas get the same data).
 */
export function AttendanceHistoryCard({ studentId, refreshKey }: { studentId: string; refreshKey: number }) {
  const [rows, setRows] = useState<AttendanceRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    setError('');
    trpc.attendance.forStudent
      .query({ studentId })
      .then(setRows)
      .catch((e) => {
        setError('Không tải được lịch sử điểm danh: ' + (e instanceof Error ? e.message : ''));
        notifyError(e, 'Tải điểm danh thất bại');
      });
  }, [studentId, refreshKey]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (rows === null) return <Center py="md"><Loader size="sm" /></Center>;
  if (rows.length === 0) return null;

  return (
    <Card radius="lg" p={0} style={{ border: '1px solid var(--cmc-border)' }}>
      <Text size="sm" fw={600} p="md" style={{ color: 'var(--cmc-text-2)', borderBottom: '1px solid var(--cmc-border-faint)' }}>
        Điểm danh ({rows.length})
      </Text>
      <Table striped highlightOnHover withTableBorder={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={thStyle}>Ngày</Table.Th>
            <Table.Th style={thStyle}>Lớp</Table.Th>
            <Table.Th style={thStyle}>Trạng thái</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                <Text size="sm">
                  {new Date(r.session.sessionDate).toLocaleDateString('vi-VN')} · {r.session.startTime}-{r.session.endTime}
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  <Text size="sm">{r.session.batch.name}</Text>
                  {r.session.isMakeup && (
                    <Badge size="xs" color="grape" variant="light" radius="xl">Học bù</Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  <Badge size="sm" color={ATTENDANCE_STATUS_COLOR[r.status]} variant="light" radius="xl">
                    {ATTENDANCE_STATUS_LABEL[r.status]}
                  </Badge>
                  {r.excused && (
                    <Badge size="xs" color="cmc" variant="outline" radius="xl">Có phép</Badge>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}
