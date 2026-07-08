import { useCallback, useEffect, useState } from 'react';
import {
  trpc,
  notifyError,
  notifySuccess,
  StatusBadge,
  InitialsAvatar,
  PageHeader,
  DataTable,
  EmptyState,
  type DataTableColumn,
} from '@cmc/ui';
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { IconArrowLeft, IconUsers } from '@tabler/icons-react';

type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type ParentT = Awaited<ReturnType<typeof trpc.guardian.parentList.query>>[number];
type GuardianForParentT = Awaited<ReturnType<typeof trpc.guardian.listForParent.query>>[number];
type LinkRequestT = Awaited<ReturnType<typeof trpc.guardian.linkRequestList.query>>[number];

const RELATIONS = [
  { value: 'father', label: 'Bố' },
  { value: 'mother', label: 'Mẹ' },
  { value: 'guardian', label: 'Người giám hộ' },
];
const RELATION_LABEL: Record<string, string> = { father: 'Bố', mother: 'Mẹ', guardian: 'Người giám hộ' };

/**
 * Staff review queue for parent self-link requests (anti-takeover design — approve is the only
 * path that creates a Guardian row for a parent-initiated request). Ambiguous rows (no
 * matched student resolved at request time) carry `candidates`; staff must pick one explicitly.
 * Stays as a standalone workflow queue above the parents list — it is triage work, not a record.
 */
function LinkRequestQueue() {
  const [requests, setRequests] = useState<LinkRequestT[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    trpc.guardian.linkRequestList
      .query()
      .then(setRequests)
      .catch((e) => notifyError(e, 'Không tải được hàng chờ yêu cầu liên kết'));
  }, []);
  useEffect(load, [load]);

  async function review(r: LinkRequestT, decision: 'approved' | 'rejected') {
    const studentId = r.matchedStudentId ?? picked[r.id];
    if (decision === 'approved' && !studentId) {
      notifyError(new Error('Chọn học sinh trước khi duyệt.'), 'Thiếu học sinh');
      return;
    }
    setBusyId(r.id);
    try {
      await trpc.guardian.linkRequestReview.mutate({
        id: r.id,
        decision,
        studentId: studentId ?? undefined,
        relation: 'guardian',
      });
      notifySuccess(decision === 'approved' ? 'Đã duyệt liên kết' : 'Đã từ chối yêu cầu');
      load();
    } catch (e) {
      notifyError(e, 'Xử lý yêu cầu thất bại');
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) return null;

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">
        Yêu cầu tự liên kết từ phụ huynh ({requests.length})
      </Text>
      <Stack gap="sm">
        {requests.map((r) => (
          <Group key={r.id} align="flex-end" wrap="nowrap" gap="sm">
            <div style={{ flex: 1 }}>
              <Group gap={6} wrap="nowrap">
                <InitialsAvatar name={r.requestedBy.displayName} size={22} />
                <Text size="sm" fw={600}>{r.requestedBy.displayName}</Text>
              </Group>
              <Text size="sm" c="dimmed">
                {r.requestedBy.email ?? r.requestedBy.phone ?? '—'} · Tra cứu: {r.studentCode ?? r.studentPhone}
              </Text>
              {r.matchedStudentId ? (
                <Box mt={4}>
                  <StatusBadge status="matched" label="Đã khớp 1 học sinh" tone="active" pill />
                </Box>
              ) : r.candidates.length > 0 ? (
                <Select
                  mt={4}
                  size="xs"
                  w={300}
                  placeholder="Chọn học sinh trùng khớp"
                  data={r.candidates.map((c) => ({ value: c.id, label: `${c.studentCode} — ${c.fullName}` }))}
                  value={picked[r.id] ?? null}
                  onChange={(v) => setPicked((m) => ({ ...m, [r.id]: v ?? '' }))}
                />
              ) : (
                <Box mt={4}>
                  <StatusBadge status="unmatched" label="Không tìm thấy học sinh khớp" tone="inactive" pill />
                </Box>
              )}
            </div>
            <Button
              size="compact-sm"
              variant="filled"
              radius={9999}
              loading={busyId === r.id}
              disabled={busyId !== null}
              onClick={() => review(r, 'approved')}
            >
              Duyệt
            </Button>
            <Button
              size="compact-sm"
              variant="subtle"
              color="red"
              radius={9999}
              loading={busyId === r.id}
              disabled={busyId !== null}
              onClick={() => review(r, 'rejected')}
            >
              Từ chối
            </Button>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

/** Modal tạo tài khoản phụ huynh mới — mở từ PageHeader của list. */
function CreateParentModal({ onCreated }: { onCreated: (id: string) => void }) {
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setName(''); setEmail(''); setPhone(''); setPassword('');
  }

  async function createParent() {
    if (!name.trim() || !password.trim() || (!email.trim() && !phone.trim())) {
      notifyError(new Error('Nhập tên, mật khẩu và email hoặc SĐT.'), 'Thông tin chưa đủ');
      return;
    }
    setBusy(true);
    try {
      const p = await trpc.guardian.parentCreate.mutate({
        displayName: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password: password.trim(),
      });
      notifySuccess(`Đã tạo phụ huynh ${p.displayName}`);
      reset();
      setOpened(false);
      onCreated(p.id);
    } catch (e) {
      notifyError(e, 'Tạo phụ huynh thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="filled" size="xs" onClick={() => setOpened(true)}>Tạo phụ huynh mới</Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Tạo tài khoản phụ huynh">
        <Stack gap="sm">
          <TextInput label="Họ tên" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Group grow>
            <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <TextInput label="Số điện thoại" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
          </Group>
          <PasswordInput label="Mật khẩu" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <Button variant="filled" onClick={createParent} loading={busy}>Tạo phụ huynh</Button>
        </Stack>
      </Modal>
    </>
  );
}

/** Record-detail hub cho 1 phụ huynh — header + Thao tác + Thông tin + học sinh liên kết. */
function ParentHub({
  parent,
  students,
  onBack,
  onChanged,
}: {
  parent: ParentT;
  students: StudentT[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [guardians, setGuardians] = useState<GuardianForParentT[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(parent.displayName);
  const [editEmail, setEditEmail] = useState(parent.email ?? '');
  const [editPhone, setEditPhone] = useState(parent.phone ?? '');
  const [editBusy, setEditBusy] = useState(false);
  const [linkStudentId, setLinkStudentId] = useState<string | null>(null);
  const [linkRelation, setLinkRelation] = useState('guardian');

  const loadGuardians = useCallback(() => {
    trpc.guardian.listForParent
      .query({ parentAccountId: parent.id })
      .then(setGuardians)
      .catch((e) => notifyError(e, 'Không tải được học sinh liên kết'));
  }, [parent.id]);
  useEffect(loadGuardians, [loadGuardians]);

  async function saveEdit() {
    if (!editName.trim()) {
      notifyError(new Error('Nhập họ tên.'), 'Thiếu thông tin');
      return;
    }
    setEditBusy(true);
    try {
      await trpc.guardian.parentUpdate.mutate({
        id: parent.id,
        displayName: editName.trim(),
        email: editEmail.trim() || undefined,
        phone: editPhone.trim() || undefined,
      });
      notifySuccess('Đã cập nhật phụ huynh');
      setEditOpen(false);
      onChanged();
    } catch (e) {
      notifyError(e, 'Cập nhật phụ huynh thất bại');
    } finally {
      setEditBusy(false);
    }
  }

  async function archive() {
    if (!window.confirm(`Lưu trữ phụ huynh ${parent.displayName}? Chỉ thực hiện được khi không còn liên kết học sinh nào.`)) return;
    try {
      await trpc.guardian.parentArchive.mutate({ id: parent.id });
      notifySuccess('Đã lưu trữ phụ huynh');
      onBack();
      onChanged();
    } catch (e) {
      notifyError(e, 'Lưu trữ phụ huynh thất bại (còn liên kết học sinh?)');
    }
  }

  async function resetPassword() {
    if (!window.confirm('Đặt lại mật khẩu đăng nhập gia đình về mặc định. Tiếp tục?')) return;
    try {
      await trpc.guardian.resetFamilyPassword.mutate({ parentAccountId: parent.id });
      notifySuccess('Mật khẩu đã đặt lại về Cmc2026@');
    } catch (e) {
      notifyError(e, 'Đặt lại mật khẩu thất bại');
    }
  }

  async function link() {
    if (!linkStudentId) {
      notifyError(new Error('Chọn học sinh.'), 'Liên kết thất bại');
      return;
    }
    try {
      await trpc.guardian.link.mutate({
        parentAccountId: parent.id,
        studentId: linkStudentId,
        relation: linkRelation as 'father' | 'mother' | 'guardian',
      });
      notifySuccess('Đã liên kết học sinh');
      setLinkStudentId(null);
      loadGuardians();
    } catch (e) {
      notifyError(e, 'Liên kết thất bại');
    }
  }

  async function unlink(id: string) {
    try {
      await trpc.guardian.unlink.mutate({ id });
      notifySuccess('Đã gỡ liên kết');
      loadGuardians();
    } catch (e) {
      notifyError(e, 'Gỡ liên kết thất bại');
    }
  }

  const subtitle = [parent.email, parent.phone].filter(Boolean).join(' · ');

  return (
    <Stack>
      <Group>
        <Button variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={16} />} onClick={onBack}>
          Phụ huynh
        </Button>
      </Group>

      <Card withBorder radius="md" p="lg" style={{ borderColor: 'var(--cmc-border)' }}>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Group gap="sm" align="flex-start">
            <InitialsAvatar name={parent.displayName} size={40} />
            <div>
              <Text
                style={{
                  fontSize: 'var(--cmc-text-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--cmc-text-muted)',
                  fontWeight: 600,
                }}
              >
                Phụ huynh
              </Text>
              <Text fw={700} style={{ fontSize: 'var(--cmc-text-xl)', lineHeight: 1.15 }}>
                {parent.displayName}
              </Text>
              {subtitle && <Text size="sm" c="dimmed">{subtitle}</Text>}
            </div>
          </Group>

          <Group gap="sm" align="center">
            <StatusBadge
              status={parent.isActive ? 'active' : 'inactive'}
              label={parent.isActive ? 'Đang hoạt động' : 'Đã lưu trữ'}
              tone={parent.isActive ? 'active' : 'inactive'}
              pill
            />
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button variant="default" size="xs">Thao tác</Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => setEditOpen(true)}>Sửa thông tin</Menu.Item>
                <Menu.Item onClick={resetPassword}>Đặt lại mật khẩu gia đình</Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" onClick={archive}>Lưu trữ phụ huynh</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </Card>

      <Card withBorder radius="sm" p="lg">
        <Text fw={600} mb="sm">Học sinh liên kết</Text>
        {guardians.length === 0 ? (
          <Text c="dimmed" size="sm">Chưa liên kết học sinh nào.</Text>
        ) : (
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--cmc-text-muted)' }}>Học sinh</Table.Th>
                <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--cmc-text-muted)' }}>Quan hệ</Table.Th>
                <Table.Th style={{ width: 80 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {guardians.map((g) => (
                <Table.Tr key={g.id}>
                  <Table.Td>
                    <Text size="sm">{g.student.studentCode} — {g.student.fullName}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" radius="xl" size="sm">{RELATION_LABEL[g.relation] ?? g.relation}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button size="compact-xs" variant="subtle" color="red" onClick={() => unlink(g.id)}>Gỡ</Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Group align="flex-end" mt="md">
          <Select
            label="Liên kết học sinh"
            searchable
            w={280}
            placeholder="Chọn học sinh"
            data={students.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
            value={linkStudentId}
            onChange={setLinkStudentId}
          />
          <Select label="Quan hệ" w={150} data={RELATIONS} value={linkRelation} onChange={(v) => v && setLinkRelation(v)} allowDeselect={false} />
          <Button variant="filled" onClick={link}>Liên kết</Button>
        </Group>
      </Card>

      <Modal opened={editOpen} onClose={() => setEditOpen(false)} title="Sửa thông tin phụ huynh">
        <Stack gap="sm">
          <TextInput label="Họ tên" value={editName} onChange={(e) => setEditName(e.currentTarget.value)} />
          <Group grow>
            <TextInput label="Email" value={editEmail} onChange={(e) => setEditEmail(e.currentTarget.value)} />
            <TextInput label="SĐT" value={editPhone} onChange={(e) => setEditPhone(e.currentTarget.value)} />
          </Group>
          <Button variant="filled" onClick={saveEdit} loading={editBusy}>Lưu thay đổi</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function GuardiansPanel() {
  const [students, setStudents] = useState<StudentT[]>([]);
  const [parents, setParents] = useState<ParentT[]>([]);
  const [selected, setSelected] = useState<ParentT | null>(null);

  const loadParents = useCallback(() => {
    trpc.guardian.parentList
      .query()
      .then(setParents)
      .catch((e) => notifyError(e, 'Không tải được danh sách phụ huynh'));
  }, []);
  useEffect(() => {
    trpc.student.list
      .query()
      .then(setStudents)
      .catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));
    loadParents();
  }, [loadParents]);

  function handleCreated(id: string) {
    loadParents();
    // Chọn ngay phụ huynh vừa tạo khi danh sách đã tải xong.
    trpc.guardian.parentList.query().then((ps) => {
      setParents(ps);
      const p = ps.find((x) => x.id === id);
      if (p) setSelected(p);
    }).catch(() => {});
  }

  if (selected) {
    return (
      <ParentHub
        parent={selected}
        students={students}
        onBack={() => setSelected(null)}
        onChanged={loadParents}
      />
    );
  }

  const columns: DataTableColumn<ParentT>[] = [
    {
      key: 'name',
      header: 'Phụ huynh',
      render: (p) => (
        <Group gap={6} wrap="nowrap">
          <InitialsAvatar name={p.displayName} size={22} />
          <Text size="sm" fw={500} c="var(--cmc-brand)">{p.displayName}</Text>
        </Group>
      ),
      sortValue: (p) => p.displayName,
    },
    {
      key: 'contact',
      header: 'Liên hệ',
      render: (p) => <Text size="sm" c="dimmed">{p.email ?? p.phone ?? '—'}</Text>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: 130,
      render: (p) => (
        <StatusBadge
          status={p.isActive ? 'active' : 'inactive'}
          label={p.isActive ? 'Đang hoạt động' : 'Đã lưu trữ'}
          tone={p.isActive ? 'active' : 'inactive'}
          pill
        />
      ),
    },
  ];

  return (
    <Stack>
      <LinkRequestQueue />

      <PageHeader
        title="Phụ huynh"
        subtitle={`${parents.length} phụ huynh`}
        actions={<CreateParentModal onCreated={handleCreated} />}
      />

      <DataTable
        data={parents}
        columns={columns}
        getRowKey={(p) => p.id}
        searchText={(p) => `${p.displayName} ${p.email ?? ''} ${p.phone ?? ''}`}
        searchPlaceholder="Tên, email hoặc SĐT"
        onRowClick={(p) => setSelected(p)}
        emptyState={
          <EmptyState
            icon={<IconUsers size={28} stroke={1.5} />}
            title="Chưa có phụ huynh"
            description="Tạo tài khoản phụ huynh để liên kết với học sinh."
          />
        }
      />
    </Stack>
  );
}
