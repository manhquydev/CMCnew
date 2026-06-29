import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  trpc,
  notifyError,
  notifySuccess,
  useSession,
  PageHeader,
  DataTable,
  StatusBadge,
  EmptyState,
  FilterBar,
  ViewSwitcher,
  useViewSwitcher,
  type DataTableColumn,
} from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconTargetArrow, IconCalendarStats } from '@tabler/icons-react';
import { getDefaultView, getAllowedViews } from './view-defaults';
import { STAGES, PROGRAMS, statusOf, isClosed, makeOwnerName } from './crm-shared';
import { OpportunityDetailPanel } from './opportunity-detail';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Opp = Awaited<ReturnType<typeof trpc.crm.opportunityList.query>>[number];
type TestAppt = Awaited<ReturnType<typeof trpc.crm.testList.query>>[number];
type Owner = Awaited<ReturnType<typeof trpc.crm.assignableOwners.query>>[number];

const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.value, s.label]));

/** Whole days since a date (used for the kanban "age in pipeline" hint). */
function daysAgo(date: string | Date): number {
  const ms = Date.now() - new Date(date).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// Kanban view of the pipeline: one column per stage (O1→O5). Cards open the record page.
// Card content is trimmed to what a consultant scans for: who, which program, who owns it,
// the phone to call, and how long it has sat in the pipeline.
function OppKanban({
  opps,
  loading,
  ownerName,
  onOpen,
}: {
  opps: Opp[];
  loading: boolean;
  ownerName: (id: string | null) => string;
  onOpen: (o: Opp) => void;
}) {
  if (loading) return <Skeleton height={200} radius="md" />;
  return (
    <ScrollArea>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm" style={{ minWidth: 760 }}>
        {STAGES.map((s) => {
          const col = opps.filter((o) => o.stage === s.value);
          // Badge counts OPEN opps in the stage (a lost/closed lead shouldn't inflate the pipeline).
          const openCount = col.filter((o) => !isClosed(o)).length;
          return (
            <Card key={s.value} withBorder p="sm" radius="md">
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={600}>{s.label}</Text>
                <Badge variant="light" radius="xl" size="sm">{openCount}</Badge>
              </Group>
              <Stack gap="xs">
                {col.length === 0 ? (
                  <Text size="xs" c="dimmed">—</Text>
                ) : (
                  col.map((o) => {
                    const st = statusOf(o);
                    const closed = isClosed(o);
                    return (
                      <Card
                        key={o.id}
                        withBorder p="xs" radius="md"
                        style={{ cursor: 'pointer' }}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpen(o)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(o); } }}
                      >
                        <Group justify="space-between" gap="xs" wrap="nowrap">
                          <Text size="sm" fw={500} lineClamp={1}>{o.studentName || o.contact.fullName}</Text>
                          {o.program && <Badge size="xs" variant="light" radius="sm">{o.program}</Badge>}
                        </Group>
                        <Text size="xs" c="dimmed">{o.contact.phone}</Text>
                        <Group justify="space-between" gap="xs" wrap="nowrap" mt={2}>
                          <Text size="xs" c="dimmed" lineClamp={1}>PT: {ownerName(o.ownerId)}</Text>
                          {closed ? (
                            <StatusBadge status={st.label} label={st.label} tone={st.tone} />
                          ) : (
                            <Text size="xs" style={{ color: 'var(--cmc-text-faint)' }}>{daysAgo(o.createdAt)} ngày</Text>
                          )}
                        </Group>
                      </Card>
                    );
                  })
                )}
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>
    </ScrollArea>
  );
}

function testStatus(t: TestAppt): { label: string; tone: ReturnType<typeof statusOf>['tone'] } {
  if (t.status === 'done') return { label: 'Đã test', tone: 'active' };
  if (t.status === 'no_show') return { label: 'Vắng', tone: 'rejected' };
  return { label: 'Đã đặt', tone: 'inactive' };
}

export function CrmPanel({ selectedOppId }: { selectedOppId?: string | null }) {
  const navigate = useNavigate();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [studentName, setStudentName] = useState('');
  const [program, setProgram] = useState<string | null>(null);
  const [medium, setMedium] = useState('');
  const [campaign, setCampaign] = useState('');
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<TestAppt[]>([]);
  const [oppsLoading, setOppsLoading] = useState(true);
  const [oppsError, setOppsError] = useState<string | null>(null);
  const [testsLoading, setTestsLoading] = useState(true);
  const { me } = useSession();
  const canGrade = me.isSuperAdmin || me.roles.some((r) => ['giao_vien', 'head_teacher', 'quan_ly'].includes(r));

  const [gradeTarget, setGradeTarget] = useState<TestAppt | null>(null);
  const [gradeScore, setGradeScore] = useState<number | string>('');
  const [gradeResult, setGradeResult] = useState('');
  const { view: oppView, setView: setOppView } = useViewSwitcher(
    'crm.opportunity',
    getDefaultView('opportunity'),
    getAllowedViews('opportunity'),
  );

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
    // Owner names for the pipeline (best-effort; falls back to a short id if unavailable).
    trpc.crm.assignableOwners.query({ facilityId }).then(setOwners).catch(() => setOwners([]));
    setTestsLoading(true);
    trpc.crm.testList
      .query({ facilityId })
      .then(setTests)
      .catch((e) => notifyError(e, 'Không tải được lịch test'))
      .finally(() => setTestsLoading(false));
  }, [facilityId]);
  useEffect(load, [load]);

  const ownerName = useMemo(() => makeOwnerName(owners), [owners]);

  const openOpp = useCallback((o: Opp) => navigate(`/crm/opportunities/${o.id}`), [navigate]);

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
        medium: medium.trim() || undefined,
        campaign: campaign.trim() || undefined,
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
      setMedium('');
      setCampaign('');
      load();
    } catch (e) {
      notifyError(e, 'Tạo cơ hội thất bại');
    } finally {
      setBusy(false);
    }
  }

  // Record page (Odoo-style form view) for a deep-linked / clicked opportunity. Replaces the
  // pipeline + create form until the user navigates back.
  if (selectedOppId) {
    return (
      <OpportunityDetailPanel
        oppId={selectedOppId}
        onBack={() => navigate('/crm')}
        onChanged={load}
      />
    );
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
      width: 160,
      sortValue: (o) => o.stage,
      render: (o) => <Badge variant="light" radius="sm">{STAGE_LABEL[o.stage] ?? o.stage}</Badge>,
    },
    { key: 'owner', header: 'Phụ trách', width: 150, render: (o) => ownerName(o.ownerId) },
    {
      key: 'status',
      header: 'Trạng thái',
      width: 140,
      render: (o) => {
        const st = statusOf(o);
        return <StatusBadge status={st.label} label={st.label} tone={st.tone} />;
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
        <Group grow align="flex-end" mt="sm">
          <TextInput
            label="Kênh nguồn / Medium (tùy chọn)"
            placeholder="cpc, organic, referral, event…"
            value={medium}
            onChange={(e) => setMedium(e.currentTarget.value)}
          />
          <TextInput
            label="Chiến dịch / Campaign (tùy chọn)"
            placeholder="he-2026, tet-ads…"
            value={campaign}
            onChange={(e) => setCampaign(e.currentTarget.value)}
          />
        </Group>
        <Group mt="md">
          <Button onClick={createLead} loading={busy}>
            Tạo cơ hội (O1)
          </Button>
        </Group>
      </Card>

      <Stack gap="xs">
        <FilterBar right={<ViewSwitcher value={oppView} allowed={getAllowedViews('opportunity')} onChange={setOppView} />}>
          <Title order={5}>Pipeline cơ hội</Title>
        </FilterBar>
        {oppView === 'kanban' ? (
          <OppKanban opps={opps} loading={oppsLoading} ownerName={ownerName} onOpen={openOpp} />
        ) : (
          <DataTable
            data={opps}
            columns={oppColumns}
            getRowKey={(o) => o.id}
            loading={oppsLoading}
            error={oppsError}
            onRetry={load}
            onRowClick={openOpp}
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
        )}
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
              description="Đặt lịch test cho một cơ hội ở trang chi tiết để hiển thị tại đây."
            />
          }
        />
      </Stack>

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
    </Stack>
  );
}
