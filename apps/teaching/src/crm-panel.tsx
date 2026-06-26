import React, { useCallback, useEffect, useState } from 'react';
import { trpc, Chatter, notifyError, notifySuccess } from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Opp = Awaited<ReturnType<typeof trpc.crm.opportunityList.query>>[number];
type TestAppt = Awaited<ReturnType<typeof trpc.crm.testList.query>>[number];

const STAGES = [
  { value: 'O1_LEAD', label: 'O1 · Lead' },
  { value: 'O2_CONTACTED', label: 'O2 · Đã liên hệ' },
  { value: 'O3_TEST_SCHEDULED', label: 'O3 · Đặt lịch test' },
  { value: 'O4_TESTED', label: 'O4 · Đã test' },
  { value: 'O5_ENROLLED', label: 'O5 · Nhập học' },
];
const PROGRAMS = [
  { value: 'UCREA', label: 'UCREA' },
  { value: 'BRIGHT_IG', label: 'Bright I.G' },
  { value: 'BLACK_HOLE', label: 'Black Hole' },
];

function statusOf(o: Opp): { label: string; color: string } {
  if (o.lostReason) return { label: 'Mất', color: 'red' };
  if (o.stage === 'O5_ENROLLED' && o.closedAt) return { label: 'Thành công', color: 'teal' };
  return { label: 'Đang mở', color: 'blue' };
}

export function CrmPanel() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [studentName, setStudentName] = useState('');
  const [program, setProgram] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lostTarget, setLostTarget] = useState<Opp | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [tests, setTests] = useState<TestAppt[]>([]);
  const [testTarget, setTestTarget] = useState<Opp | null>(null);
  const [testAt, setTestAt] = useState<Date | null>(null);
  const [gradeTarget, setGradeTarget] = useState<TestAppt | null>(null);
  const [gradeScore, setGradeScore] = useState<number | string>('');
  const [gradeResult, setGradeResult] = useState('');
  const [detailTarget, setDetailTarget] = useState<Opp | null>(null);

  useEffect(() => {
    trpc.facility.list.query().then((fs) => {
      setFacilities(fs);
      setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
    });
  }, []);

  const load = useCallback(() => {
    if (!facilityId) return;
    trpc.crm.opportunityList.query({ facilityId }).then(setOpps).catch(() => setOpps([]));
    trpc.crm.testList.query({ facilityId }).then(setTests).catch(() => setTests([]));
  }, [facilityId]);
  useEffect(load, [load]);

  async function scheduleTest() {
    if (!facilityId || !testTarget || !testAt) return;
    try {
      await trpc.crm.testCreate.mutate({
        facilityId,
        opportunityId: testTarget.id,
        studentName: testTarget.studentName ?? undefined,
        type: 'entrance',
        scheduledAt: testAt.toISOString(),
      });
      notifySuccess('Đã đặt lịch test (cơ hội tự lên O3)');
      setTestTarget(null);
      setTestAt(null);
      load();
    } catch (e) {
      notifyError(e, 'Đặt lịch test thất bại');
    }
  }
  async function doGrade() {
    if (!gradeTarget || typeof gradeScore !== 'number') return;
    try {
      await trpc.crm.testGrade.mutate({ id: gradeTarget.id, score: gradeScore, result: gradeResult.trim() || undefined });
      notifySuccess('Đã chấm test (cơ hội tự lên O4)');
      setGradeTarget(null);
      setGradeScore('');
      setGradeResult('');
      load();
    } catch (e) {
      notifyError(e, 'Chấm test thất bại');
    }
  }

  async function createLead() {
    if (!facilityId || !fullName.trim() || !phone.trim()) {
      notifyError(new Error('Nhập tên liên hệ và số điện thoại'), 'Tạo cơ hội thất bại');
      return;
    }
    setBusy(true);
    try {
      const contact = await trpc.crm.contactCreate.mutate({
        facilityId,
        fullName: fullName.trim(),
        phone: phone.trim(),
      });
      await trpc.crm.opportunityCreate.mutate({
        contactId: contact.id,
        studentName: studentName.trim() || undefined,
        program: (program as 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE') || undefined,
      });
      notifySuccess(`Đã tạo cơ hội cho ${contact.fullName}`);
      setFullName('');
      setPhone('');
      setStudentName('');
      setProgram(null);
      load();
    } catch (e) {
      notifyError(e, 'Tạo cơ hội thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function transition(o: Opp, stage: string) {
    try {
      await trpc.crm.opportunityTransition.mutate({ id: o.id, stage: stage as Opp['stage'] });
      load();
    } catch (e) {
      notifyError(e, 'Chuyển bước cơ hội thất bại');
    }
  }
  async function reopen(o: Opp) {
    try {
      await trpc.crm.opportunityReopen.mutate({ id: o.id });
      notifySuccess('Đã mở lại cơ hội');
      load();
    } catch (e) {
      notifyError(e, 'Mở lại cơ hội thất bại');
    }
  }
  async function doMarkLost() {
    if (!lostTarget || !lostReason.trim()) return;
    try {
      await trpc.crm.opportunityMarkLost.mutate({ id: lostTarget.id, reason: lostReason.trim() });
      notifySuccess('Đã đánh dấu cơ hội mất');
      setLostTarget(null);
      setLostReason('');
      load();
    } catch (e) {
      notifyError(e, 'Đánh dấu cơ hội mất thất bại');
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
          Tạo cơ hội mới
        </Title>
        <Group grow align="flex-end">
          <TextInput label="Tên liên hệ" value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
          <TextInput label="Số điện thoại" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
        </Group>
        <Group grow align="flex-end" mt="sm">
          <TextInput
            label="Tên học sinh (tùy chọn)"
            value={studentName}
            onChange={(e) => setStudentName(e.currentTarget.value)}
          />
          <Select label="Chương trình (tùy chọn)" data={PROGRAMS} value={program} onChange={setProgram} clearable />
        </Group>
        <Group mt="md">
          <Button onClick={createLead} loading={busy}>
            Tạo cơ hội (O1)
          </Button>
        </Group>
      </Card>

      <Card withBorder>
        <Title order={6} mb="sm">
          Pipeline cơ hội
        </Title>
        {opps.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có cơ hội nào.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Học sinh / Liên hệ</Table.Th>
                <Table.Th style={TH_STYLE}>SĐT</Table.Th>
                <Table.Th style={TH_STYLE} w={210}>Bước</Table.Th>
                <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {opps.map((o) => {
                const st = statusOf(o);
                const closed = !!o.lostReason;
                return (
                  <Table.Tr key={o.id}>
                    <Table.Td>{o.studentName || o.contact.fullName}</Table.Td>
                    <Table.Td>{o.contact.phone}</Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        data={STAGES}
                        value={o.stage}
                        disabled={closed}
                        onChange={(v) => v && transition(o, v)}
                        allowDeselect={false}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Badge color={st.color}>{st.label}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end">
                        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setDetailTarget(o)}>
                          Nhật ký
                        </Button>
                        {!closed && (
                          <Button size="compact-xs" variant="light" onClick={() => setTestTarget(o)}>
                            Đặt test
                          </Button>
                        )}
                        {closed ? (
                          <Button size="compact-xs" variant="light" onClick={() => reopen(o)}>
                            Mở lại
                          </Button>
                        ) : (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="red"
                            onClick={() => setLostTarget(o)}
                          >
                            Mất
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Card withBorder>
        <Title order={6} mb="sm">
          Lịch test
        </Title>
        {tests.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có lịch test.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Học sinh</Table.Th>
                <Table.Th style={TH_STYLE}>Loại</Table.Th>
                <Table.Th style={TH_STYLE}>Lịch</Table.Th>
                <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
                <Table.Th style={TH_STYLE}>Điểm</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tests.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>{t.studentName || '—'}</Table.Td>
                  <Table.Td>{t.type === 'entrance' ? 'Đầu vào' : 'Định kỳ'}</Table.Td>
                  <Table.Td>{new Date(t.scheduledAt).toLocaleString('vi-VN')}</Table.Td>
                  <Table.Td>
                    <Badge color={t.status === 'done' ? 'teal' : t.status === 'no_show' ? 'red' : 'gray'}>
                      {t.status === 'done' ? 'Đã test' : t.status === 'no_show' ? 'Vắng' : 'Đã đặt'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{t.score ?? '—'}</Table.Td>
                  <Table.Td>
                    {t.status === 'scheduled' && (
                      <Button size="compact-xs" variant="light" onClick={() => setGradeTarget(t)}>
                        Chấm
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Modal opened={!!testTarget} onClose={() => setTestTarget(null)} title="Đặt lịch test đầu vào">
        <Stack>
          <Text size="sm">
            {testTarget?.studentName || testTarget?.contact.fullName} — cơ hội sẽ tự chuyển sang O3.
          </Text>
          <DateTimePicker label="Thời gian test" value={testAt} onChange={(v) => setTestAt(v ? new Date(v) : null)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setTestTarget(null)}>
              Đóng
            </Button>
            <Button disabled={!testAt} onClick={scheduleTest}>
              Đặt lịch
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!gradeTarget} onClose={() => setGradeTarget(null)} title="Chấm test">
        <Stack>
          <NumberInput label="Điểm" min={0} max={10} step={0.5} value={gradeScore} onChange={setGradeScore} />
          <TextInput label="Kết quả (tùy chọn)" placeholder="đạt / chưa đạt" value={gradeResult} onChange={(e) => setGradeResult(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setGradeTarget(null)}>
              Đóng
            </Button>
            <Button disabled={typeof gradeScore !== 'number'} onClick={doGrade}>
              Lưu điểm
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!lostTarget} onClose={() => setLostTarget(null)} title="Đánh dấu cơ hội mất">
        <Stack>
          <Textarea
            label="Lý do"
            autosize
            minRows={2}
            value={lostReason}
            onChange={(e) => setLostReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLostTarget(null)}>
              Đóng
            </Button>
            <Button color="red" disabled={!lostReason.trim()} onClick={doMarkLost}>
              Xác nhận
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title={`Cơ hội — ${detailTarget?.studentName || detailTarget?.contact.fullName || ''}`}
        size="lg"
      >
        {detailTarget && (
          <Chatter entityType="opportunity" entityId={detailTarget.id} />
        )}
      </Modal>
    </Stack>
  );
}
