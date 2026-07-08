import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Group, Loader, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifyError, notifySuccess, trpc, useSession, FacilityPicker } from '@cmc/ui';

type Teacher = Awaited<ReturnType<typeof trpc.user.listTeachers.query>>[number];

/**
 * Thêm giáo viên nhanh — form gọn, gọi thẳng user.create (director-gated) với các field bắt buộc
 * tối thiểu (CCCD/ngày vào làm/vị trí/email cá nhân — quyết định chống tài khoản "mồ côi" hồ sơ,
 * xem docs/decisions/0026). Không redirect sang ERP: roles/primaryRole cố định 'giao_vien'.
 */
function AddTeacherModal({ facilityId, onCreated }: { facilityId: number | null; onCreated: () => void }) {
  const [opened, setOpened] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [personalEmail, setPersonalEmail] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setDisplayName(''); setEmail(''); setPhone(''); setNationalId('');
    setStartedAt(new Date().toISOString().slice(0, 10)); setPersonalEmail('');
  }

  async function create() {
    if (!facilityId) {
      notifyError(new Error('Chưa chọn cơ sở.'), 'Thiếu thông tin');
      return;
    }
    if (!displayName.trim() || !email.trim() || !phone.trim() || !nationalId.trim() || !personalEmail.trim()) {
      notifyError(new Error('Nhập đủ họ tên, email, SĐT, CCCD và email cá nhân.'), 'Thiếu thông tin');
      return;
    }
    setBusy(true);
    try {
      await trpc.user.create.mutate({
        email: email.trim(),
        displayName: displayName.trim(),
        phone: phone.trim(),
        roles: ['giao_vien'],
        primaryRole: 'giao_vien',
        facilityIds: [facilityId],
        nationalId: nationalId.trim(),
        startedAt,
        position: 'Giáo viên',
        personalEmail: personalEmail.trim(),
      });
      notifySuccess('Đã thêm giáo viên. Tài khoản đăng nhập qua SSO Microsoft.');
      reset();
      setOpened(false);
      onCreated();
    } catch (e) {
      notifyError(e, 'Thêm giáo viên thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="xs" variant="filled" onClick={() => setOpened(true)}>+ Thêm giáo viên</Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Thêm giáo viên nhanh">
        <Stack gap="sm">
          <TextInput label="Họ tên" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
          <TextInput label="Email công ty (đăng nhập SSO)" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <Group grow>
            <TextInput label="Số điện thoại" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
            <TextInput label="CCCD/CMND" value={nationalId} onChange={(e) => setNationalId(e.currentTarget.value)} />
          </Group>
          <Group grow>
            <TextInput label="Ngày vào làm" type="date" value={startedAt} onChange={(e) => setStartedAt(e.currentTarget.value)} />
            <TextInput label="Email cá nhân (nhận thư mời)" value={personalEmail} onChange={(e) => setPersonalEmail(e.currentTarget.value)} />
          </Group>
          <Text size="xs" c="dimmed">
            Vai trò mặc định: Giáo viên. Hồ sơ nhân sự đầy đủ (hợp đồng, liên hệ khẩn cấp...) điền sau trên ERP.
          </Text>
          <Button onClick={create} loading={busy}>Thêm giáo viên</Button>
        </Stack>
      </Modal>
    </>
  );
}

/**
 * Teacher-lite lean staff view: directors see their teaching team (giao_vien roster) and can add
 * a new teacher directly here (quick-add), without the full ERP HR onboarding surface.
 */
export function TeacherStaffLitePanel() {
  const { me } = useSession();
  const [facilities, setFacilities] = useState<Awaited<ReturnType<typeof trpc.facility.list.query>>>([]);
  const [facilityId, setFacilityId] = useState<number | null>(me.facilityIds[0] ?? null);
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    trpc.facility.list.query().then(setFacilities).catch(() => {});
  }, []);

  const load = useCallback(() => {
    trpc.user.listTeachers
      .query()
      .then(setTeachers)
      .catch((e) => notifyError(e, 'Không tải được danh sách giáo viên'));
  }, []);
  useEffect(load, [load]);

  const rows = (teachers ?? []).filter((t) => t.displayName.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600}>Đội ngũ giáo viên</Text>
          <Text size="sm" c="dimmed">{teachers ? `${teachers.length} giáo viên đang hoạt động` : 'Đang tải…'}</Text>
        </div>
        <Group gap="sm">
          {facilities.length > 1 && (
            <FacilityPicker facilities={facilities} value={facilityId} onChange={setFacilityId} clearable={false} w={200} />
          )}
          <AddTeacherModal facilityId={facilityId} onCreated={load} />
        </Group>
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
        Phân công giáo viên vào lớp thực hiện khi tạo lớp.
      </Text>
    </Stack>
  );
}
