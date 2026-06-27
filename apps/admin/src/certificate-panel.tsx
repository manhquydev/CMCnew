import React, { useCallback, useEffect, useState } from 'react';
import { trpc, API_URL, notifyError, notifySuccess } from '@cmc/ui';
import { Button, Card, Group, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type Cert = Awaited<ReturnType<typeof trpc.certificate.list.query>>[number];

export function CertificatePanel() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [students, setStudents] = useState<StudentT[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [level, setLevel] = useState('');
  const [title, setTitle] = useState('Hoàn thành cấp độ');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    trpc.facility.list
      .query()
      .then((fs) => {
        setFacilities(fs);
        setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
      })
      .catch((e) => notifyError(e, 'Tải danh sách cơ sở thất bại'));
    trpc.student.list
      .query()
      .then(setStudents)
      .catch((e) => { setStudents([]); notifyError(e, 'Tải danh sách học sinh thất bại'); });
  }, []);

  const studentName = useCallback(
    (id: string) => students.find((s) => s.id === id)?.fullName ?? id.slice(0, 8),
    [students],
  );

  const load = useCallback(() => {
    if (!facilityId) return;
    trpc.certificate.list
      .query({ facilityId })
      .then(setCerts)
      .catch((e) => { setCerts([]); notifyError(e, 'Tải chứng chỉ thất bại'); });
  }, [facilityId]);
  useEffect(load, [load]);

  async function issue() {
    const student = students.find((s) => s.id === studentId);
    if (!student || !title.trim()) {
      notifyError(new Error('Chọn học sinh và nhập tiêu đề'), 'Cấp chứng chỉ thất bại');
      return;
    }
    setBusy(true);
    try {
      await trpc.certificate.issue.mutate({
        studentId: student.id,
        program: student.program,
        level: level.trim() || undefined,
        title: title.trim(),
      });
      notifySuccess(`Đã cấp chứng chỉ cho ${student.fullName}`);
      setLevel('');
      load();
    } catch (e) {
      notifyError(e, 'Cấp chứng chỉ thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack>
      <Select
        label="Cơ sở"
        w={280}
        data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
        value={facilityId ? String(facilityId) : null}
        onChange={(v) => setFacilityId(v ? Number(v) : null)}
        allowDeselect={false}
      />

      <Card withBorder>
        <Title order={5} mb="sm">
          Cấp chứng chỉ
        </Title>
        <Group grow align="flex-end">
          <Select
            label="Học sinh"
            searchable
            placeholder={students.length ? 'Chọn học sinh' : 'Chưa có học sinh'}
            data={students.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
            value={studentId}
            onChange={setStudentId}
          />
          <TextInput label="Cấp độ (tùy chọn)" placeholder="vd L2" value={level} onChange={(e) => setLevel(e.currentTarget.value)} />
        </Group>
        <TextInput label="Tiêu đề" mt="sm" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        <Group mt="md">
          <Button onClick={issue} loading={busy}>
            Cấp chứng chỉ
          </Button>
        </Group>
      </Card>

      <Card withBorder>
        <Title order={6} mb="sm">
          Chứng chỉ đã cấp
        </Title>
        {certs.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa cấp chứng chỉ nào.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Học sinh</Table.Th>
                <Table.Th style={TH_STYLE}>Tiêu đề</Table.Th>
                <Table.Th style={TH_STYLE}>Cấp độ</Table.Th>
                <Table.Th style={TH_STYLE}>Ngày cấp</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {certs.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{studentName(c.studentId)}</Table.Td>
                  <Table.Td>{c.title}</Table.Td>
                  <Table.Td>{c.level ?? '—'}</Table.Td>
                  <Table.Td>{new Date(c.issuedAt).toLocaleDateString('vi-VN')}</Table.Td>
                  <Table.Td>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => window.open(`${API_URL}/files/certificate/${c.id}`, '_blank', 'noopener')}
                    >
                      In
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
