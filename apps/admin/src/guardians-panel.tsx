import React, { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';

type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type ParentT = Awaited<ReturnType<typeof trpc.guardian.parentList.query>>[number];
type GuardianT = Awaited<ReturnType<typeof trpc.guardian.listForStudent.query>>[number];

const RELATIONS = [
  { value: 'father', label: 'Bố' },
  { value: 'mother', label: 'Mẹ' },
  { value: 'guardian', label: 'Người giám hộ' },
];
const RELATION_LABEL: Record<string, string> = { father: 'Bố', mother: 'Mẹ', guardian: 'Người giám hộ' };

export function GuardiansPanel() {
  const [students, setStudents] = useState<StudentT[]>([]);
  const [parents, setParents] = useState<ParentT[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [guardians, setGuardians] = useState<GuardianT[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [relation, setRelation] = useState<string>('guardian');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

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

  const loadGuardians = useCallback(() => {
    if (!studentId) {
      setGuardians([]);
      return;
    }
    trpc.guardian.listForStudent
      .query({ studentId })
      .then(setGuardians)
      .catch((e) => notifyError(e, 'Không tải được phụ huynh của học sinh'));
  }, [studentId]);
  useEffect(loadGuardians, [loadGuardians]);

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
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');
      loadParents();
      setParentId(p.id);
    } catch (e) {
      notifyError(e, 'Tạo phụ huynh thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    if (!studentId || !parentId) {
      notifyError(new Error('Chọn học sinh và phụ huynh.'), 'Liên kết thất bại');
      return;
    }
    try {
      await trpc.guardian.link.mutate({
        parentAccountId: parentId,
        studentId,
        relation: relation as 'father' | 'mother' | 'guardian',
      });
      notifySuccess('Đã liên kết phụ huynh với học sinh');
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

  const TH_STYLE: React.CSSProperties = {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--cmc-text-muted)',
    fontWeight: 600,
  };

  return (
    <Stack>
      <Select
        label="Học sinh"
        w={360}
        searchable
        placeholder={students.length ? 'Chọn học sinh' : 'Chưa có học sinh'}
        data={students.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
        value={studentId}
        onChange={setStudentId}
      />

      {studentId && (
        <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
          <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">
            Phụ huynh của học sinh
          </Text>
          {guardians.length === 0 ? (
            <Text c="dimmed" size="sm">
              Chưa liên kết phụ huynh nào.
            </Text>
          ) : (
            <Table striped highlightOnHover withTableBorder={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={TH_STYLE}>Phụ huynh</Table.Th>
                  <Table.Th style={TH_STYLE}>Liên hệ</Table.Th>
                  <Table.Th style={TH_STYLE}>Quan hệ</Table.Th>
                  <Table.Th style={{ ...TH_STYLE, width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {guardians.map((g) => (
                  <Table.Tr key={g.id}>
                    <Table.Td><Text size="sm">{g.parent.displayName}</Text></Table.Td>
                    <Table.Td><Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>{g.parent.email ?? g.parent.phone ?? '—'}</Text></Table.Td>
                    <Table.Td>
                      <Badge variant="light" radius="xl" size="sm">{RELATION_LABEL[g.relation] ?? g.relation}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Button size="compact-xs" variant="subtle" color="red" onClick={() => unlink(g.id)}>
                        Gỡ
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Group align="flex-end" mt="md">
            <Select
              label="Liên kết phụ huynh có sẵn"
              searchable
              w={280}
              placeholder="Chọn phụ huynh"
              data={parents.map((p) => ({ value: p.id, label: `${p.displayName} (${p.email ?? p.phone ?? ''})` }))}
              value={parentId}
              onChange={setParentId}
            />
            <Select label="Quan hệ" w={150} data={RELATIONS} value={relation} onChange={(v) => v && setRelation(v)} allowDeselect={false} />
            <Button variant="filled" radius={9999} onClick={link}>Liên kết</Button>
          </Group>
        </Card>
      )}

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">
          Tạo tài khoản phụ huynh mới
        </Text>
        <Group grow align="flex-end">
          <TextInput label="Họ tên" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        </Group>
        <Group grow align="flex-end" mt="sm">
          <TextInput label="Số điện thoại" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
          <PasswordInput label="Mật khẩu" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        </Group>
        <Group mt="md">
          <Button variant="filled" radius={9999} onClick={createParent} loading={busy}>
            Tạo phụ huynh
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}
