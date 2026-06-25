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
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { GuardiansPanel } from './guardians-panel';
import { OverviewPanel } from './overview-panel';
import { CompensationConfigPanel } from './compensation-panel';
import { PayrollPanel } from './payroll-panel';
import { KpiEvaluationPanel } from './kpi-evaluation-panel';

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
    <Card withBorder>
      <Group justify="space-between" mb="md">
        <Title order={5}>Khóa học (dùng chung toàn hệ)</Title>
        <Button size="xs" onClick={open}>
          + Tạo khóa
        </Button>
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Mã</Table.Th>
            <Table.Th>Tên</Table.Th>
            <Table.Th>Chương trình</Table.Th>
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
      <Modal opened={opened} onClose={close} title="Tạo khóa học">
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
            <Button type="submit" loading={busy}>
              Tạo
            </Button>
          </Stack>
        </form>
      </Modal>
    </Card>
  );
}

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
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={5}>Cơ sở ({facilities.length})</Title>
        <Button size="xs" onClick={open}>
          + Tạo cơ sở
        </Button>
      </Group>
      <Table striped>
        <Table.Tbody>
          {facilities.map((f) => (
            <Table.Tr key={f.id}>
              <Table.Td w={60}>#{f.id}</Table.Td>
              <Table.Td w={80}>
                <b>{f.code}</b>
              </Table.Td>
              <Table.Td>{f.name}</Table.Td>
              <Table.Td w={90}>
                {f.isActive ? null : (
                  <Badge color="gray" size="sm">
                    ngừng
                  </Badge>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={opened} onClose={close} title="Tạo cơ sở">
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
            <Button type="submit" loading={busy}>
              Tạo
            </Button>
          </Stack>
        </form>
      </Modal>
    </Card>
  );
}

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

  const facilityData = facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }));

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
    <Modal opened={opened} onClose={close} title="Tạo người dùng">
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
          <Button type="submit" loading={busy}>
            Tạo
          </Button>
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

  const facilityData = facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }));

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
    <Modal opened={!!user} onClose={close} title={`Sửa: ${user.displayName}`} size="lg">
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
              () => trpc.user.setActive.mutate({ id: user.id, isActive: e.currentTarget.checked }),
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
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={5}>Người dùng ({users.length})</Title>
        <Button size="xs" onClick={open}>
          + Tạo người dùng
        </Button>
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Tên</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Vai trò</Table.Th>
            <Table.Th>Cơ sở</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>
                {u.displayName}
                {!u.isActive && (
                  <Badge color="gray" size="xs" ml="xs">
                    ngừng
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{u.email}</Table.Td>
              <Table.Td>{u.roles.join(', ')}</Table.Td>
              <Table.Td>{u.facilities.length}</Table.Td>
              <Table.Td w={70}>
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

function Org() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const loadFacilities = () =>
    trpc.facility.list.query().then(setFacilities).catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  const loadUsers = () =>
    trpc.user.list.query().then(setUsers).catch((e) => notifyError(e, 'Không tải được danh sách người dùng'));
  useEffect(() => {
    loadFacilities();
    loadUsers();
  }, []);

  return (
    <Stack>
      <Facilities facilities={facilities} reload={loadFacilities} />
      <Users users={users} facilities={facilities} reload={loadUsers} />
    </Stack>
  );
}

function HrPayrollTab() {
  const { me } = useSession();
  const [facilityId, setFacilityId] = useState<string | null>(
    me.facilityIds.length > 0 ? String(me.facilityIds[0]) : null,
  );
  const facilityOptions = me.facilityIds.map((id) => ({ value: String(id), label: `Cơ sở #${id}` }));

  if (me.facilityIds.length === 0) {
    return <Text c="dimmed">Tài khoản chưa được gán cơ sở.</Text>;
  }

  return (
    <Stack>
      {me.facilityIds.length > 1 && (
        <Select label="Cơ sở" data={facilityOptions} value={facilityId} onChange={setFacilityId} w={200} />
      )}
      {facilityId && <PayrollPanel facilityId={Number(facilityId)} />}
    </Stack>
  );
}

function Dashboard() {
  const { me } = useSession();
  const canHr = me.isSuperAdmin || me.roles.includes('hr') || me.roles.includes('ke_toan');
  const canKpi =
    me.isSuperAdmin ||
    me.roles.some((r) => ['hr', 'ke_toan', 'quan_ly', 'bgd', 'head_teacher'].includes(r));
  return (
    <Tabs defaultValue="overview">
      <Tabs.List>
        <Tabs.Tab value="overview">Tổng quan</Tabs.Tab>
        <Tabs.Tab value="courses">Khóa học</Tabs.Tab>
        <Tabs.Tab value="org">Cơ sở &amp; người dùng</Tabs.Tab>
        <Tabs.Tab value="guardians">Phụ huynh</Tabs.Tab>
        {canHr && <Tabs.Tab value="hr">Nhân sự &amp; Lương</Tabs.Tab>}
        {canKpi && <Tabs.Tab value="kpi">Đánh giá KPI</Tabs.Tab>}
        {me.isSuperAdmin && <Tabs.Tab value="compensation">Cơ cấu lương</Tabs.Tab>}
      </Tabs.List>
      <Tabs.Panel value="overview" pt="md">
        <OverviewPanel />
      </Tabs.Panel>
      <Tabs.Panel value="courses" pt="md">
        <Courses />
      </Tabs.Panel>
      <Tabs.Panel value="org" pt="md">
        <Org />
      </Tabs.Panel>
      <Tabs.Panel value="guardians" pt="md">
        <GuardiansPanel />
      </Tabs.Panel>
      {canHr && (
        <Tabs.Panel value="hr" pt="md">
          <HrPayrollTab />
        </Tabs.Panel>
      )}
      {canKpi && (
        <Tabs.Panel value="kpi" pt="md">
          <KpiEvaluationPanel />
        </Tabs.Panel>
      )}
      {me.isSuperAdmin && (
        <Tabs.Panel value="compensation" pt="md">
          <CompensationConfigPanel />
        </Tabs.Panel>
      )}
    </Tabs>
  );
}

export function App() {
  return (
    <LoginGate appTitle="Admin">
      <Dashboard />
    </LoginGate>
  );
}
