import { useCallback, useEffect, useState } from 'react';
import {
  trpc,
  Chatter,
  notifyError,
  notifySuccess,
  useSession,
  PageHeader,
  DataTable,
  StatusBadge,
  EmptyState,
  type DataTableColumn,
  type StatusTone,
} from '@cmc/ui';
import {
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconTargetArrow, IconCalendarStats } from '@tabler/icons-react';

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

function statusOf(o: Opp): { label: string; tone: StatusTone } {
  if (o.lostReason) return { label: 'Mất', tone: 'rejected' };
  if (o.stage === 'O5_ENROLLED' && o.closedAt) return { label: 'Thành công', tone: 'active' };
  return { label: 'Đang mở', tone: 'info' };
}

function testStatus(t: TestAppt): { label: string; tone: StatusTone } {
  if (t.status === 'done') return { label: 'Đã test', tone: 'active' };
  if (t.status === 'no_show') return { label: 'Vắng', tone: 'rejected' };
  return { label: 'Đã đặt', tone: 'inactive' };
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
  const [oppsLoading, setOppsLoading] = useState(true);
  const [oppsError, setOppsError] = useState<string | null>(null);
  const [testsLoading, setTestsLoading] = useState(true);
  const { me } = useSession();
  const canGrade = me.isSuperAdmin || me.roles.some((r) => ['giao_vien', 'head_teacher', 'quan_ly'].includes(r));

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
    setOppsLoading(true);
    setOppsError(null);
    trpc.crm.opportunityList
      .query({ facilityId })
      .then(setOpps)
      .catch((e) => {
        setOppsError(e instanceof Error ? e.message : 'Không tải được cơ hội');
        notifyError(e, 'Không tải được cơ hội');
      })
      .finally(() => setOppsLoading(false));
    setTestsLoading(true);
    trpc.crm.testList
      .query({ facilityId })
      .then(setTests)
      .catch((e) => notifyError(e, 'Không tải được lịch test'))
      .finally(() => setTestsLoading(false));
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

  const oppColumns: DataTableColumn<Opp>[] = [
    {
      key: 'name',
      header: 'Học sinh / Liên hệ',
      sortValue: (o) => o.studentName || o.contact.fullName,
      render: (o) => o.studentName || o.contact.fullName,
    },
    { key: 'phone', header: 'SĐT', width: 130, render: (o) => o.contact.phone },
    {
      key: 'stage',
      header: 'Bước',
      width: 210,
      render: (o) => {
        const closed = !!o.lostReason || !!(o.closedAt && o.stage === 'O5_ENROLLED');
        return (
          <Select
            size="xs"
            data={STAGES}
            value={o.stage}
            disabled={closed}
            onChange={(v) => v && transition(o, v)}
            allowDeselect={false}
          />
        );
      },
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: 130,
      render: (o) => {
        const st = statusOf(o);
        return <StatusBadge status={st.label} label={st.label} tone={st.tone} />;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (o) => {
        const closed = !!o.lostReason || !!(o.closedAt && o.stage === 'O5_ENROLLED');
        return (
          <Group gap="xs" justify="flex-end" wrap="nowrap">
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
              <Button size="compact-xs" variant="light" color="red" onClick={() => setLostTarget(o)}>
                Mất
              </Button>
            )}
          </Group>
        );
      },
    },
  ];

  const testColumns: DataTableColumn<TestAppt>[] = [
    { key: 'student', header: 'Học sinh', render: (t) => t.studentName || '—' },
    { key: 'type', header: 'Loại', width: 100, render: (t) => (t.type === 'entrance' ? 'Đầu vào' : 'Định kỳ') },
    {
      key: 'when',
      header: 'Lịch',
      sortValue: (t) => t.scheduledAt,
      render: (t) => new Date(t.scheduledAt).toLocaleString('vi-VN'),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: 120,
      render: (t) => {
        const st = testStatus(t);
        return <StatusBadge status={st.label} label={st.label} tone={st.tone} />;
      },
    },
    { key: 'score', header: 'Điểm', width: 70, render: (t) => t.score ?? '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) =>
        t.status === 'scheduled' && canGrade ? (
          <Button size="compact-xs" variant="light" onClick={() => setGradeTarget(t)}>
            Chấm
          </Button>
        ) : null,
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="CRM"
        subtitle="Quản lý cơ hội tuyển sinh & lịch test"
        actions={
          <Select
            aria-label="Cơ sở"
            w={240}
            data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
            value={facilityId ? String(facilityId) : null}
            onChange={(v) => setFacilityId(v ? Number(v) : null)}
            allowDeselect={false}
          />
        }
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

      <Stack gap="xs">
        <Title order={5}>Pipeline cơ hội</Title>
        <DataTable
          data={opps}
          columns={oppColumns}
          getRowKey={(o) => o.id}
          loading={oppsLoading}
          error={oppsError}
          onRetry={load}
          searchText={(o) => `${o.studentName ?? ''} ${o.contact.fullName} ${o.contact.phone}`}
          searchPlaceholder="Tên hoặc SĐT"
          pageSize={15}
          emptyState={
            <EmptyState
              icon={<IconTargetArrow size={28} stroke={1.5} />}
              title="Chưa có cơ hội nào"
              description="Tạo cơ hội đầu tiên ở khung phía trên để bắt đầu theo dõi pipeline tuyển sinh."
            />
          }
        />
      </Stack>

      <Stack gap="xs">
        <Title order={5}>Lịch test</Title>
        <DataTable
          data={tests}
          columns={testColumns}
          getRowKey={(t) => t.id}
          loading={testsLoading}
          pageSize={15}
          emptyState={
            <EmptyState
              icon={<IconCalendarStats size={28} stroke={1.5} />}
              title="Chưa có lịch test"
              description="Đặt lịch test cho một cơ hội ở pipeline để hiển thị tại đây."
            />
          }
        />
      </Stack>

      <Modal opened={!!testTarget} onClose={() => setTestTarget(null)} title="Đặt lịch test đầu vào">
        <Stack>
          <Text size="sm">
            {testTarget?.studentName || testTarget?.contact.fullName} — cơ hội sẽ tự chuyển sang O3.
          </Text>
          <DateTimePicker label="Thời gian test" value={testAt} onChange={(v: Date | null) => setTestAt(v)} />
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
