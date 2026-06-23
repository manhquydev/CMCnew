import { useEffect, useState } from 'react';
import { LoginGate, trpc } from '@cmc/ui';
import {
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
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

function Org() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    trpc.facility.list.query().then(setFacilities).catch(() => {});
    trpc.user.list.query().then(setUsers).catch(() => {});
  }, []);
  return (
    <Stack>
      <Card withBorder>
        <Title order={5} mb="sm">
          Cơ sở ({facilities.length})
        </Title>
        <Table striped>
          <Table.Tbody>
            {facilities.map((f) => (
              <Table.Tr key={f.id}>
                <Table.Td w={60}>#{f.id}</Table.Td>
                <Table.Td w={80}>
                  <b>{f.code}</b>
                </Table.Td>
                <Table.Td>{f.name}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
      <Card withBorder>
        <Title order={5} mb="sm">
          Người dùng ({users.length})
        </Title>
        <Table striped>
          <Table.Tbody>
            {users.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.displayName}</Table.Td>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td>{u.roles.join(', ')}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
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
