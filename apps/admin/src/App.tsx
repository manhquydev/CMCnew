import { useEffect, useState } from 'react';
import {
  LoginGate,
  trpc,
  useSession,
  notifyError,
  notifySuccess,
  required,
  email,
  minLength,
  combine,
} from '@cmc/ui';
import { useForm } from '@mantine/form';
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  MultiSelect,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCircleX,
  IconCircleCheck,
  IconPlus,
} from '@tabler/icons-react';
import { GuardiansPanel } from './guardians-panel';
import { OverviewPanel } from './overview-panel';
import { CompensationConfigPanel } from './compensation-panel';
import { PayrollPanel } from './payroll-panel';
import { KpiEvaluationPanel } from './kpi-evaluation-panel';
import { FinancePanel } from './finance-panel';
import { CrmPanel } from './crm-panel';
import { Shell, buildNavGroups, SECTION_TITLES, type SectionKey } from './shell';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type User = Awaited<ReturnType<typeof trpc.user.list.query>>[number];
type Course = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type Program = 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE';

const ROLES = [
  'super_admin',
  'quan_ly',
  'head_teacher',
  'giao_vien',
  'ke_toan',
  'hr',
  'sale',
  'cskh',
  'ctv_mkt',
  'bgd',
] as const;

// ─── Table header style ────────────────────────────────────────────────────────

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

// ─── Courses ──────────────────────────────────────────────────────────────────

function Courses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [opened, { open, close }] = useDisclosure(false);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { code: '', name: '', program: 'UCREA' as Program },
    validate: {
      code: combine(required('Nhập mã khóa'), minLength(2, 'Mã cần tối thiểu 2 ký tự')),
      name: required('Nhập tên khóa'),
      program: required('Chọn chương trình'),
    },
  });

  const load = () =>
    trpc.course.list
      .query()
      .then(setCourses)
      .catch((e) => notifyError(e, 'Không tải được danh sách khóa học'));

  useEffect(() => {
    load();
  }, []);

  async function create(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.course.create.mutate(values);
      notifySuccess(`Đã tạo khóa "${values.name}"`);
      close();
      form.reset();
      load();
    } catch (e) {
      notifyError(e, 'Tạo khóa học thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack>
      <Group justify="space-between" mb="xs">
        <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }}>
          Khóa học
        </Text>
        <Button
          variant="filled"
          radius={9999}
          leftSection={<IconPlus size={16} />}
          onClick={open}
        >
          Tạo khóa
        </Button>
      </Group>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Table striped highlightOnHover withTableBorder={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={TH_STYLE}>Mã</Table.Th>
              <Table.Th style={TH_STYLE}>Tên</Table.Th>
              <Table.Th style={TH_STYLE}>Chương trình</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {courses.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>{c.code}</Table.Td>
                <Table.Td>{c.name}</Table.Td>
                <Table.Td>{c.program}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {courses.length === 0 && (
          <Text c="dimmed" size="sm" mt="sm">
            Chưa có khóa học.
          </Text>
        )}
      </Card>

      <Modal opened={opened} onClose={close} title="Tạo khóa học" radius="xl" centered>
        <form onSubmit={form.onSubmit(create)}>
          <Stack>
            <TextInput label="Mã" withAsterisk {...form.getInputProps('code')} />
            <TextInput label="Tên" withAsterisk {...form.getInputProps('name')} />
            <Select
              label="Chương trình"
              withAsterisk
              data={['UCREA', 'BRIGHT_IG', 'BLACK_HOLE']}
              {...form.getInputProps('program')}
            />
            <Group justify="flex-end" mt="xs">
              <Button variant="subtle" onClick={close}>Hủy</Button>
              <Button type="submit" variant="filled" radius={9999} loading={busy}>
                Tạo
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

// ─── Facilities ───────────────────────────────────────────────────────────────

function Facilities({
  facilities,
  reload,
}: {
  facilities: Facility[];
  reload: () => void;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { code: '', name: '', address: '' },
    validate: {
      code: combine(required('Nhập mã cơ sở'), minLength(2, 'Mã cần tối thiểu 2 ký tự')),
      name: required('Nhập tên cơ sở'),
    },
  });

  async function create(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.facility.create.mutate({
        code: values.code,
        name: values.name,
        address: values.address || undefined,
      });
      notifySuccess(`Đã tạo cơ sở "${values.name}"`);
      close();
      form.reset();
      reload();
    } catch (e) {
      notifyError(e, 'Tạo cơ sở thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Group justify="space-between" mb="md">
        <Text fw={600} style={{ color: 'var(--cmc-text)' }}>
          Cơ sở ({facilities.length})
        </Text>
        <Button
          variant="filled"
          radius={9999}
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={open}
        >
          Tạo cơ sở
        </Button>
      </Group>
      <Table striped highlightOnHover withTableBorder={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={TH_STYLE}>#</Table.Th>
            <Table.Th style={TH_STYLE}>Mã</Table.Th>
            <Table.Th style={TH_STYLE}>Tên</Table.Th>
            <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {facilities.map((f) => (
            <Table.Tr key={f.id}>
              <Table.Td style={{ color: 'var(--cmc-text-muted)', fontSize: 13 }}>
                #{f.id}
              </Table.Td>
              <Table.Td>
                <Text fw={500} size="sm">
                  {f.code}
                </Text>
              </Table.Td>
              <Table.Td>{f.name}</Table.Td>
              <Table.Td>
                {f.isActive ? (
                  <Group gap={4}>
                    <IconCircleCheck size={12} color="var(--cmc-status-active)" />
                    <Badge color="green" variant="light" radius="xl" size="sm">
                      Hoạt động
                    </Badge>
                  </Group>
                ) : (
                  <Group gap={4}>
                    <IconCircleX size={12} color="var(--cmc-status-inactive)" />
                    <Badge color="gray" variant="light" radius="xl" size="sm">
                      Ngừng
                    </Badge>
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={opened} onClose={close} title="Tạo cơ sở" radius="xl" centered>
        <form onSubmit={form.onSubmit(create)}>
          <Stack>
            <TextInput
              label="Mã"
              placeholder="VD: CS3"
              withAsterisk
              {...form.getInputProps('code')}
            />
            <TextInput label="Tên" withAsterisk {...form.getInputProps('name')} />
            <TextInput label="Địa chỉ" {...form.getInputProps('address')} />
            <Group justify="flex-end" mt="xs">
              <Button variant="subtle" onClick={close}>Hủy</Button>
              <Button type="submit" variant="filled" radius={9999} loading={busy}>
                Tạo
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Card>
  );
}

// ─── User modals ──────────────────────────────────────────────────────────────

function UserCreateModal({
  opened,
  close,
  facilities,
  reload,
}: {
  opened: boolean;
  close: () => void;
  facilities: Facility[];
  reload: () => void;
}) {
  const [roles, setRoles] = useState<string[]>([]);
  const [primaryRole, setPrimaryRole] = useState<string | null>(null);
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { email: '', displayName: '', password: '' },
    validate: {
      email: email('Email không hợp lệ'),
      password: minLength(8, 'Mật khẩu tối thiểu 8 ký tự'),
      displayName: required('Nhập tên hiển thị'),
    },
  });

  const facilityData = facilities.map((f) => ({
    value: String(f.id),
    label: `${f.code} — ${f.name}`,
  }));

  async function create(values: typeof form.values) {
    if (roles.length === 0) {
      notifyError(new Error('Chọn ít nhất một vai trò'), 'Tạo người dùng thất bại');
      return;
    }
    setBusy(true);
    try {
      await trpc.user.create.mutate({
        email: values.email,
        displayName: values.displayName,
        password: values.password,
        roles: roles as User['roles'],
        primaryRole: (primaryRole ?? roles[0]) as User['primaryRole'],
        facilityIds: facilityIds.map(Number),
      });
      notifySuccess(`Đã tạo người dùng "${values.displayName}"`);
      close();
      form.reset();
      setRoles([]);
      setPrimaryRole(null);
      setFacilityIds([]);
      reload();
    } catch (e) {
      notifyError(e, 'Tạo người dùng thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={close} title="Tạo người dùng" radius="xl" centered>
      <form onSubmit={form.onSubmit(create)}>
        <Stack>
          <TextInput label="Email" withAsterisk {...form.getInputProps('email')} />
          <TextInput label="Tên hiển thị" withAsterisk {...form.getInputProps('displayName')} />
          <PasswordInput
            label="Mật khẩu"
            description="Tối thiểu 8 ký tự"
            withAsterisk
            {...form.getInputProps('password')}
          />
          <MultiSelect
            label="Vai trò"
            data={ROLES as unknown as string[]}
            value={roles}
            onChange={(v) => {
              setRoles(v);
              if (primaryRole && !v.includes(primaryRole)) setPrimaryRole(null);
            }}
          />
          <Select
            label="Vai trò chính"
            data={roles}
            value={primaryRole}
            onChange={setPrimaryRole}
            disabled={roles.length === 0}
            placeholder={roles.length ? 'Chọn' : 'Chọn vai trò trước'}
          />
          <MultiSelect
            label="Cơ sở được truy cập"
            data={facilityData}
            value={facilityIds}
            onChange={setFacilityIds}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={close}>Hủy</Button>
            <Button type="submit" variant="filled" radius={9999} loading={busy}>
              Tạo
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function UserEditModal({
  user,
  close,
  facilities,
  reload,
}: {
  user: User | null;
  close: () => void;
  facilities: Facility[];
  reload: () => void;
}) {
  const [roles, setRoles] = useState<string[]>([]);
  const [primaryRole, setPrimaryRole] = useState<string | null>(null);
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setRoles(user.roles);
    setPrimaryRole(user.primaryRole);
    setFacilityIds(user.facilities.map((f) => String(f.facilityId)));
  }, [user]);

  const facilityData = facilities.map((f) => ({
    value: String(f.id),
    label: `${f.code} — ${f.name}`,
  }));

  async function run(fn: () => Promise<unknown>, successMsg: string) {
    setBusy(true);
    try {
      await fn();
      notifySuccess(successMsg);
      reload();
    } catch (e) {
      notifyError(e, 'Cập nhật thất bại');
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <Modal
      opened={!!user}
      onClose={close}
      title={`Sửa: ${user.displayName}`}
      size="lg"
      radius="xl"
      centered
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {user.email}
        </Text>

        <MultiSelect
          label="Vai trò"
          data={ROLES as unknown as string[]}
          value={roles}
          onChange={(v) => {
            setRoles(v);
            if (primaryRole && !v.includes(primaryRole)) setPrimaryRole(null);
          }}
        />
        <Select
          label="Vai trò chính"
          data={roles}
          value={primaryRole}
          onChange={setPrimaryRole}
          disabled={roles.length === 0}
        />
        <Button
          variant="light"
          size="xs"
          loading={busy}
          disabled={roles.length === 0 || !primaryRole}
          onClick={() =>
            run(
              () =>
                trpc.user.setRoles.mutate({
                  id: user.id,
                  roles: roles as User['roles'],
                  primaryRole: primaryRole as User['primaryRole'],
                }),
              'Đã lưu vai trò',
            )
          }
        >
          Lưu vai trò
        </Button>

        <MultiSelect
          label="Cơ sở được truy cập"
          data={facilityData}
          value={facilityIds}
          onChange={setFacilityIds}
        />
        <Button
          variant="light"
          size="xs"
          loading={busy}
          onClick={() =>
            run(
              () =>
                trpc.user.setFacilities.mutate({
                  id: user.id,
                  facilityIds: facilityIds.map(Number),
                }),
              'Đã lưu cơ sở',
            )
          }
        >
          Lưu cơ sở
        </Button>

        <Switch
          label="Đang hoạt động"
          checked={user.isActive}
          onChange={(e) =>
            run(
              () =>
                trpc.user.setActive.mutate({
                  id: user.id,
                  isActive: e.currentTarget.checked,
                }),
              'Đã cập nhật trạng thái',
            )
          }
        />
        <Text size="xs" c="dimmed">
          Đổi vai trò / cơ sở / trạng thái sẽ vô hiệu hóa các phiên đăng nhập hiện tại của người dùng.
        </Text>
      </Stack>
    </Modal>
  );
}

// ─── Users ────────────────────────────────────────────────────────────────────

function Users({
  users,
  facilities,
  reload,
}: {
  users: User[];
  facilities: Facility[];
  reload: () => void;
}) {
  const [createOpen, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<User | null>(null);

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Group justify="space-between" mb="md">
        <Text fw={600} style={{ color: 'var(--cmc-text)' }}>
          Người dùng ({users.length})
        </Text>
        <Button
          variant="filled"
          radius={9999}
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={open}
        >
          Tạo người dùng
        </Button>
      </Group>
      <Table striped highlightOnHover withTableBorder={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={TH_STYLE}>Tên</Table.Th>
            <Table.Th style={TH_STYLE}>Email</Table.Th>
            <Table.Th style={TH_STYLE}>Vai trò</Table.Th>
            <Table.Th style={TH_STYLE}>Cơ sở</Table.Th>
            <Table.Th style={{ ...TH_STYLE, width: 80 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>
                <Group gap="xs">
                  <Text size="sm">{u.displayName}</Text>
                  {!u.isActive && (
                    <Badge color="gray" variant="light" radius="xl" size="xs">
                      Ngừng
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>
                  {u.email}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{u.roles.join(', ')}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{u.facilities.length}</Text>
              </Table.Td>
              <Table.Td>
                <Button variant="subtle" size="compact-xs" onClick={() => setEditing(u)}>
                  Sửa
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <UserCreateModal opened={createOpen} close={close} facilities={facilities} reload={reload} />
      <UserEditModal
        user={editing}
        close={() => setEditing(null)}
        facilities={facilities}
        reload={reload}
      />
    </Card>
  );
}

// ─── Org (Cơ sở & Users) ─────────────────────────────────────────────────────

function OrgPanel() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const loadFacilities = () =>
    trpc.facility.list
      .query()
      .then(setFacilities)
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  const loadUsers = () =>
    trpc.user.list
      .query()
      .then(setUsers)
      .catch((e) => notifyError(e, 'Không tải được danh sách người dùng'));

  useEffect(() => {
    loadFacilities();
    loadUsers();
  }, []);

  return (
    <Stack>
      <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">
        Cơ sở &amp; Người dùng
      </Text>
      <Facilities facilities={facilities} reload={loadFacilities} />
      <Users users={users} facilities={facilities} reload={loadUsers} />
    </Stack>
  );
}

// ─── HR / Payroll tab ─────────────────────────────────────────────────────────

function HrPayrollSection() {
  const { me } = useSession();
  const [facilityId, setFacilityId] = useState<string | null>(
    me.facilityIds.length > 0 ? String(me.facilityIds[0]) : null,
  );
  const facilityOptions = me.facilityIds.map((id) => ({
    value: String(id),
    label: `Cơ sở #${id}`,
  }));

  if (me.facilityIds.length === 0) {
    return <Text c="dimmed">Tài khoản chưa được gán cơ sở.</Text>;
  }

  return (
    <Stack>
      <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">
        Nhân sự &amp; Lương
      </Text>
      {me.facilityIds.length > 1 && (
        <Select
          label="Cơ sở"
          data={facilityOptions}
          value={facilityId}
          onChange={setFacilityId}
          w={200}
        />
      )}
      {facilityId && <PayrollPanel facilityId={Number(facilityId)} />}
    </Stack>
  );
}

// ─── Dashboard (AppShell wrapper) ─────────────────────────────────────────────

const ALL_ADMIN_KEYS = new Set<string>([
  'overview', 'courses', 'org', 'guardians', 'hr', 'kpi', 'compensation', 'finance', 'crm',
]);

function hashToAdminSection(): SectionKey | undefined {
  const raw = window.location.hash.slice(1);
  return ALL_ADMIN_KEYS.has(raw) ? (raw as SectionKey) : undefined;
}

function Dashboard() {
  const { me } = useSession();
  const canHr = me.isSuperAdmin || me.roles.includes('hr') || me.roles.includes('ke_toan');
  const canKpi =
    me.isSuperAdmin ||
    me.roles.some((r) => ['hr', 'ke_toan', 'quan_ly', 'bgd', 'head_teacher'].includes(r));
  const canFinance =
    me.isSuperAdmin || me.roles.some((r) => ['ke_toan', 'quan_ly'].includes(r));
  const canCrm =
    me.isSuperAdmin || me.roles.some((r) => ['sale', 'quan_ly', 'cskh'].includes(r));

  const [activeSection, setActiveSection] = useState<SectionKey>(
    hashToAdminSection() ?? 'overview',
  );

  useEffect(() => {
    const onHashChange = () => {
      const next = hashToAdminSection();
      if (next) setActiveSection(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navGroups = buildNavGroups({
    canHr,
    canKpi,
    canFinance,
    canCrm,
    isSuperAdmin: me.isSuperAdmin,
  });

  // Guard: if user navigates to a section they lost access to, fall back to overview
  const handleSectionChange = (key: SectionKey) => {
    if (key === 'hr' && !canHr) return;
    if (key === 'kpi' && !canKpi) return;
    if (key === 'compensation' && !me.isSuperAdmin) return;
    if (key === 'finance' && !canFinance) return;
    if (key === 'crm' && !canCrm) return;
    window.location.hash = key;
    setActiveSection(key);
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return <OverviewPanel />;
      case 'courses':
        return <Courses />;
      case 'org':
        return <OrgPanel />;
      case 'guardians':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">
              Phụ huynh
            </Text>
            <GuardiansPanel />
          </Stack>
        );
      case 'hr':
        return canHr ? <HrPayrollSection /> : null;
      case 'kpi':
        return canKpi ? (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">
              Đánh giá KPI
            </Text>
            <KpiEvaluationPanel />
          </Stack>
        ) : null;
      case 'compensation':
        return me.isSuperAdmin ? (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">
              Cơ cấu lương
            </Text>
            <CompensationConfigPanel />
          </Stack>
        ) : null;
      case 'finance':
        return canFinance ? (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">
              Tài chính
            </Text>
            <FinancePanel />
          </Stack>
        ) : null;
      case 'crm':
        return canCrm ? (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">
              CRM
            </Text>
            <CrmPanel />
          </Stack>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <Shell
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
      navGroups={navGroups}
      sectionTitle={SECTION_TITLES[activeSection]}
    >
      {renderContent()}
    </Shell>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export function App() {
  return (
    <LoginGate appTitle="Admin">
      <Dashboard />
    </LoginGate>
  );
}
