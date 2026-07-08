import { useEffect, useState } from 'react';
import { Anchor, Card, Group, Loader, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifyError, trpc } from '@cmc/ui';
import { erpHrefForSection } from './app-surface';

type Teacher = Awaited<ReturnType<typeof trpc.user.listTeachers.query>>[number];

/**
 * Teacher-lite lean staff view: directors see their teaching team (giao_vien roster).
 * Read-only by design — creating a teacher requires the full HR onboarding (CCCD/ngày vào làm/
 * vị trí/email cá nhân) which lives on the ERP surface, so "Thêm giáo viên" links there rather
 * than duplicating the 10-field form. Assigning a teacher to a class happens during class creation.
 */
export function TeacherStaffLitePanel() {
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    trpc.user.listTeachers
      .query()
      .then(setTeachers)
      .catch((e) => notifyError(e, 'Không tải được danh sách giáo viên'));
  }, []);

  const rows = (teachers ?? []).filter((t) => t.displayName.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Đội ngũ giáo viên</Text>
          <Text size="sm" c="dimmed">{teachers ? `${teachers.length} giáo viên đang hoạt động` : 'Đang tải…'}</Text>
        </div>
        <Anchor href={erpHrefForSection('org')} size="sm">+ Thêm giáo viên (ERP đầy đủ)</Anchor>
      </Group>

      <TextInput placeholder="Tìm theo tên giáo viên" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={320} />

      <Card withBorder radius="md" p={0}>
        {teachers === null ? (
          <Group justify="center" p="xl"><Loader size="sm" /></Group>
        ) : rows.length === 0 ? (
          <Text c="dimmed" p="lg" ta="center">{q ? 'Không tìm thấy giáo viên phù hợp' : 'Chưa có giáo viên nào'}</Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Giáo viên</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>{t.displayName}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Text size="xs" c="dimmed">
        Phân công giáo viên vào lớp thực hiện khi tạo lớp. Thêm/sửa hồ sơ nhân sự đầy đủ (CCCD, ngày vào
        làm, vị trí) thực hiện trên ERP đầy đủ.
      </Text>
    </Stack>
  );
}
