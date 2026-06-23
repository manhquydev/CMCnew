import { useEffect, useState } from 'react';
import { LoginGate, trpc } from '@cmc/ui';
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
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [program, setProgram] = useState<string | null>('UCREA');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => trpc.course.list.query().then(setCourses).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setBusy(true);
    setErr('');
    try {
      await trpc.course.create.mutate({ code, name, program: program as Program });
      close();
      setCode('');
      setName('');
      load();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
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
        <Stack>
          <TextInput label="Mã" value={code} onChange={(e) => setCode(e.currentTarget.value)} />
          <TextInput label="Tên" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Select
            label="Chương trình"
            data={['UCREA', 'BRIGHT_IG', 'BLACK_HOLE']}
            value={program}
            onChange={setProgram}
          />
          {err && (
            <Text c="red" size="sm">
              {err}
            </Text>
          )}
          <Button onClick={create} loading={busy}>
            Tạo
          </Button>
        </Stack>
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
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    setBusy(true);
    setErr('');
    try {
      await trpc.facility.create.mutate({
        code,
        name,
        address: address || undefined,
      });
      close();
      setCode('');
      setName('');
      setAddress('');
      reload();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
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
        <Stack>
          <TextInput
            label="Mã"
            placeholder="VD: CS3"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
          />
          <TextInput label="Tên" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <TextInput
            label="Địa chỉ"
            value={address}
            onChange={(e) => setAddress(e.currentTarget.value)}
          />
          {err && (
            <Text c="red" size="sm">
              {err}
            </Text>
          )}
          <Button onClick={create} loading={busy}>
            Tạo
          </Button>
        </Stack>
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
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [primaryRole, setPrimaryRole] = useState<string | null>(null);
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const facilityData = facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }));

  async function create() {
    setBusy(true);
    setErr('');
    try {
      await trpc.user.create.mutate({
        email,
        displayName,
        password,
        roles: roles as User['roles'],
        primaryRole: (primaryRole ?? roles[0]) as User['primaryRole'],
        facilityIds: facilityIds.map(Number),
      });
      close();
      setEmail('');
      setDisplayName('');
      setPassword('');
      setRoles([]);
      setPrimaryRole(null);
      setFacilityIds([]);
      reload();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={close} title="Tạo người dùng">
      <Stack>
        <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <TextInput
          label="Tên hiển thị"
          value={displayName}
          onChange={(e) => setDisplayName(e.currentTarget.value)}
        />
        <PasswordInput
          label="Mật khẩu"
          description="Tối thiểu 8 ký tự"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
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
        {err && (
          <Text c="red" size="sm">
            {err}
          </Text>
        )}
        <Button onClick={create} loading={busy} disabled={roles.length === 0}>
          Tạo
        </Button>
      </Stack>
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
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    setRoles(user.roles);
    setPrimaryRole(user.primaryRole);
    setFacilityIds(user.facilities.map((f) => String(f.facilityId)));
    setErr('');
  }, [user]);

  const facilityData = facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
      reload();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
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
            run(() =>
              trpc.user.setRoles.mutate({
                id: user.id,
                roles: roles as User['roles'],
                primaryRole: primaryRole as User['primaryRole'],
              }),
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
            run(() =>
              trpc.user.setFacilities.mutate({
                id: user.id,
                facilityIds: facilityIds.map(Number),
              }),
            )
          }
        >
          Lưu cơ sở
        </Button>

        <Switch
          label="Đang hoạt động"
          checked={user.isActive}
          onChange={(e) =>
            run(() =>
              trpc.user.setActive.mutate({ id: user.id, isActive: e.currentTarget.checked }),
            )
          }
        />
        <Text size="xs" c="dimmed">
          Đổi vai trò / cơ sở / trạng thái sẽ vô hiệu hóa các phiên đăng nhập hiện tại của người dùng.
        </Text>

        {err && (
          <Text c="red" size="sm">
            {err}
          </Text>
        )}
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

  const loadFacilities = () => trpc.facility.list.query().then(setFacilities).catch(() => {});
  const loadUsers = () => trpc.user.list.query().then(setUsers).catch(() => {});
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

function Dashboard() {
  return (
    <Tabs defaultValue="courses">
      <Tabs.List>
        <Tabs.Tab value="courses">Khóa học</Tabs.Tab>
        <Tabs.Tab value="org">Cơ sở &amp; người dùng</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="courses" pt="md">
        <Courses />
      </Tabs.Panel>
      <Tabs.Panel value="org" pt="md">
        <Org />
      </Tabs.Panel>
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
