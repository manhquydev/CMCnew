// Opportunity record page — the Odoo-style "form view" for ONE opportunity, reached from
// /crm/opportunities/:oppId (deep-linkable). Replaces the old thin detail modal: a clickable
// O1→O5 statusbar drives stage transitions, header buttons run the record actions (reassign /
// schedule test / mark-lost / reopen), and the body shows lead info, the assignment ledger, and
// the activity log. All writes reuse the existing crm.* endpoints — no new mutation behaviour.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { can } from '@cmc/auth/permissions';
import {
  trpc,
  Chatter,
  StatusBadge,
  notifyError,
  notifySuccess,
  useSession,
  DataTable,
  EmptyState,
  type DataTableColumn,
} from '@cmc/ui';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconArrowLeft, IconCalendarStats } from '@tabler/icons-react';
import {
  STAGES,
  LOST_REASON_OPTIONS,
  LOST_REASON_LABEL,
  STAGE_LABEL,
  makeOwnerName,
  type LostReasonValue,
  statusOf,
  isClosed,
  stageIndex,
} from './crm-shared';

type OppDetail = Awaited<ReturnType<typeof trpc.crm.opportunityGet.query>>;
type Owner = Awaited<ReturnType<typeof trpc.crm.assignableOwners.query>>[number];
type AssignmentLog = Awaited<ReturnType<typeof trpc.crm.assignmentHistory.query>>[number];
type TestAppt = Awaited<ReturnType<typeof trpc.crm.testList.query>>[number];
type Course = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type OwnReceipt = Awaited<ReturnType<typeof trpc.finance.receiptListOwn.query>>[number];
type ClassBatchOption = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];

function testStatus(t: TestAppt): { label: string; tone: ReturnType<typeof statusOf>['tone'] } {
  if (t.status === 'done') return { label: 'Đã test', tone: 'active' };
  if (t.status === 'no_show') return { label: 'Vắng', tone: 'rejected' };
  return { label: 'Đã đặt', tone: 'inactive' };
}

const PROGRAM_LABEL: Record<string, string> = {
  UCREA: 'UCREA',
  BRIGHT_IG: 'Bright I.G',
  BLACK_HOLE: 'Black Hole',
};
const YEARS = [
  { value: '1', label: '1 năm' },
  { value: '2', label: '2 năm' },
  { value: '3', label: '3 năm' },
];
const RECEIPT_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Nháp', color: 'gray' },
  approved: { label: 'Đã duyệt', color: 'teal' },
  sent: { label: 'Đã gửi', color: 'blue' },
  reconciled: { label: 'Đã đối soát', color: 'green' },
  cancelled: { label: 'Đã hủy', color: 'red' },
};

/** Two-column read-only field row — matches @cmc/ui's record-detail.tsx label conventions
 *  (160px right-aligned label) used across student/staff/schedule detail panels. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group wrap="nowrap" gap="md" align="center">
      <Text
        size="sm"
        style={{
          width: 'var(--cmc-form-label-w)',
          minWidth: 'var(--cmc-form-label-w)',
          flexShrink: 0,
          textAlign: 'right',
          fontSize: 'var(--cmc-form-label-font)',
          color: 'var(--cmc-form-label-color)',
        }}
      >
        {label}
      </Text>
      {/* component="div" so non-text values (e.g. a <Badge>) don't nest a block inside a <p>. */}
      <Text component="div" size="sm" style={{ flex: 1, minWidth: 0 }}>
        {value ?? '—'}
      </Text>
    </Group>
  );
}

/** Section heading with the shared accent-bar convention (matches record-detail.tsx). */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Group gap="xs" wrap="nowrap" align="center" mb="sm">
      <span
        aria-hidden="true"
        style={{ display: 'inline-block', width: 4, height: 20, borderRadius: 2, background: 'var(--cmc-brand)' }}
      />
      <Text fw={600} style={{ fontSize: 'var(--cmc-form-group-title)', color: 'var(--cmc-text)' }}>
        {children}
      </Text>
    </Group>
  );
}

// Clickable stage statusbar (Odoo statusbar widget). Past stages read as "done", the current as
// "active"; clicking a LATER stage advances the opportunity. Forward-only by product decision —
// past/current are non-clickable so an accidental click can't silently regress a lead. Frozen
// entirely when the opp is closed (won/lost).
function StageBar({
  current,
  disabled,
  onPick,
}: {
  current: string;
  disabled: boolean;
  onPick: (stage: string) => void;
}) {
  const idx = stageIndex(current);
  return (
    <Group gap={0} wrap="nowrap" style={{ overflowX: 'auto' }}>
      {STAGES.map((s, i) => {
        const active = s.value === current;
        const done = i < idx;
        return (
          <Button
            key={s.value}
            size="xs"
            variant={active ? 'filled' : done ? 'light' : 'default'}
            color={active ? 'cmc' : done ? 'teal' : 'gray'}
            disabled={disabled || active || done}
            onClick={() => onPick(s.value)}
            radius={0}
            styles={{
              root: {
                flex: '1 0 auto',
                borderTopLeftRadius: i === 0 ? 8 : 0,
                borderBottomLeftRadius: i === 0 ? 8 : 0,
                borderTopRightRadius: i === STAGES.length - 1 ? 8 : 0,
                borderBottomRightRadius: i === STAGES.length - 1 ? 8 : 0,
              },
            }}
          >
            {s.label}
          </Button>
        );
      })}
    </Group>
  );
}

function AssignmentHistoryBlock({
  opportunityId,
  ownerName,
}: {
  opportunityId: string;
  ownerName: (id: string | null) => string;
}) {
  const [logs, setLogs] = useState<AssignmentLog[] | null>(null);
  useEffect(() => {
    trpc.crm.assignmentHistory
      .query({ opportunityId })
      .then(setLogs)
      .catch(() => setLogs([]));
  }, [opportunityId]);

  if (!logs)
    return (
      <Text size="sm" c="dimmed">
        Đang tải lịch sử phân bổ...
      </Text>
    );
  if (logs.length === 0)
    return (
      <Text size="sm" c="dimmed">
        Chưa có lịch sử phân bổ.
      </Text>
    );

  return (
    <Stack gap={4}>
      {logs.map((log) => (
        <Text key={log.id} size="xs" c="dimmed">
          {new Date(log.createdAt).toLocaleString('vi-VN')}
          {' — '}
          {log.fromOwnerId ? ownerName(log.fromOwnerId) : '(chưa có)'}
          {' → '}
          {log.toOwnerId ? ownerName(log.toOwnerId) : '(bỏ trống)'}
          {log.reason ? ` · ${log.reason}` : ''}
        </Text>
      ))}
    </Stack>
  );
}

export function OpportunityDetailPanel({
  oppId,
  onBack,
  onChanged,
}: {
  oppId: string;
  onBack: () => void;
  onChanged?: () => void;
}) {
  const { me } = useSession();
  // Mirror the server gate exactly (no hand-kept role list): only roles that hold
  // crm.opportunityReassign see the button; the mutation re-checks server-side regardless.
  const canReassign = can(me.roles, me.isSuperAdmin, 'crm', 'opportunityReassign');
  const canCreateReceipt = can(me.roles, me.isSuperAdmin, 'finance', 'receiptCreate');
  // KHÔNG đổi: giữ nguyên danh sách role được phép chấm test (đồng bộ với crm.testGrade gate).
  const canGrade =
    me.isSuperAdmin || me.roles.some((r) => ['giao_vien', 'giam_doc_dao_tao'].includes(r));

  const [opp, setOpp] = useState<OppDetail | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<TestAppt[]>([]);
  const [testsLoading, setTestsLoading] = useState(true);
  const [courses, setCourses] = useState<Course[]>([]);
  const [classBatches, setClassBatches] = useState<ClassBatchOption[]>([]);
  const [ownReceipts, setOwnReceipts] = useState<OwnReceipt[]>([]);

  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignToOwnerId, setReassignToOwnerId] = useState<string | null>(null);
  const [reassignReason, setReassignReason] = useState('');
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState<LostReasonValue | null>(null);
  const [lostNote, setLostNote] = useState('');
  const [testOpen, setTestOpen] = useState(false);
  const [testAt, setTestAt] = useState<Date | null>(null);
  const [gradeTarget, setGradeTarget] = useState<TestAppt | null>(null);
  const [gradeScore, setGradeScore] = useState<number | string>('');
  const [gradeResult, setGradeResult] = useState('');
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptCourseId, setReceiptCourseId] = useState<string | null>(null);
  const [receiptYears, setReceiptYears] = useState('1');
  const [receiptVoucher, setReceiptVoucher] = useState('');
  const [receiptClassBatchId, setReceiptClassBatchId] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    trpc.crm.opportunityGet
      .query({ id: oppId })
      .then(async (o) => {
        setOpp(o);
        await trpc.crm.assignableOwners
          .query({ facilityId: o.facilityId })
          .then(setOwners)
          .catch(() => setOwners([]));
        await Promise.all([
          trpc.course.list
            .query()
            .then(setCourses)
            .catch(() => setCourses([])),
          trpc.classBatch.list
            .query()
            .then(setClassBatches)
            .catch(() => setClassBatches([])),
          canCreateReceipt
            ? trpc.finance.receiptListOwn
                .query({ opportunityId: oppId })
                .then(setOwnReceipts)
                .catch(() => setOwnReceipts([]))
            : Promise.resolve(),
        ]);
        setTestsLoading(true);
        // Same crm.testList call as before (facility-scoped, no server-side opp filter);
        // only the rendering location moved — filtered to this opportunity client-side below.
        await trpc.crm.testList
          .query({ facilityId: o.facilityId })
          .then(setTests)
          .catch((e) => notifyError(e, 'Không tải được lịch test'))
          .finally(() => setTestsLoading(false));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được cơ hội'))
      .finally(() => setLoading(false));
  }, [canCreateReceipt, oppId]);
  useEffect(load, [load]);

  const oppTests = useMemo(() => tests.filter((t) => t.opportunityId === oppId), [tests, oppId]);

  // Refresh the record after any write, and let the parent list refresh too.
  const refresh = useCallback(() => {
    load();
    onChanged?.();
  }, [load, onChanged]);

  const ownerName = useMemo(() => makeOwnerName(owners), [owners]);

  async function doGrade() {
    if (!gradeTarget || typeof gradeScore !== 'number') return;
    try {
      await trpc.crm.testGrade.mutate({
        id: gradeTarget.id,
        score: gradeScore,
        result: gradeResult.trim() || undefined,
      });
      notifySuccess('Đã chấm test (cơ hội tự lên O4)');
      setGradeTarget(null);
      setGradeScore('');
      setGradeResult('');
      refresh();
    } catch (e) {
      notifyError(e, 'Chấm test thất bại');
    }
  }

  async function pickStage(stage: string) {
    if (!opp) return;
    try {
      await trpc.crm.opportunityTransition.mutate({
        id: opp.id,
        stage: stage as OppDetail['stage'],
      });
      notifySuccess('Đã chuyển bước cơ hội');
      refresh();
    } catch (e) {
      notifyError(e, 'Chuyển bước cơ hội thất bại');
    }
  }
  async function reopen() {
    if (!opp) return;
    try {
      await trpc.crm.opportunityReopen.mutate({ id: opp.id });
      notifySuccess('Đã mở lại cơ hội');
      refresh();
    } catch (e) {
      notifyError(e, 'Mở lại cơ hội thất bại');
    }
  }
  async function doReassign() {
    if (!opp || !reassignToOwnerId) return;
    try {
      await trpc.crm.opportunityReassign.mutate({
        id: opp.id,
        toOwnerId: reassignToOwnerId,
        reason: reassignReason.trim() || undefined,
      });
      notifySuccess('Đã đổi người phụ trách');
      setReassignOpen(false);
      setReassignToOwnerId(null);
      setReassignReason('');
      refresh();
    } catch (e) {
      notifyError(e, 'Đổi người phụ trách thất bại');
    }
  }
  async function doMarkLost() {
    if (!opp || !lostReason) return;
    try {
      await trpc.crm.opportunityMarkLost.mutate({
        id: opp.id,
        reason: lostReason,
        note: lostNote.trim() || undefined,
      });
      notifySuccess('Đã đánh dấu cơ hội mất');
      setLostOpen(false);
      setLostReason(null);
      setLostNote('');
      refresh();
    } catch (e) {
      notifyError(e, 'Đánh dấu cơ hội mất thất bại');
    }
  }
  async function scheduleTest() {
    if (!opp || !testAt) return;
    try {
      await trpc.crm.testCreate.mutate({
        facilityId: opp.facilityId,
        opportunityId: opp.id,
        studentName: opp.studentName ?? undefined,
        type: 'entrance',
        scheduledAt: testAt.toISOString(),
      });
      notifySuccess('Đã đặt lịch test (cơ hội tự lên O3)');
      setTestOpen(false);
      setTestAt(null);
      refresh();
    } catch (e) {
      notifyError(e, 'Đặt lịch test thất bại');
    }
  }

  async function createOpportunityReceipt() {
    if (!opp || !receiptCourseId) return;
    setReceiptBusy(true);
    try {
      const result = await trpc.finance.receiptCreate.mutate({
        facilityId: opp.facilityId,
        courseId: receiptCourseId,
        yearsPrepaid: Number(receiptYears),
        voucherCode: receiptVoucher.trim() || undefined,
        opportunityId: opp.id,
        parentPhone: opp.contact.phone,
        parentName: opp.contact.fullName,
        studentName: (opp.studentName || opp.contact.fullName).trim(),
        classBatchId: receiptClassBatchId ?? undefined,
      });
      // Always passes opportunityId above, so the duplicate-warning branch (decision 0037) never
      // triggers here — but the union return still requires narrowing before reading `.receipt`.
      if (result.status !== 'success') {
        notifyError('Tạo phiếu thu thất bại (không mong đợi: cảnh báo trùng dù đã gắn cơ hội)');
        return;
      }
      notifySuccess(`Đã tạo phiếu nháp ${result.receipt.code ?? ''}`.trim());
      setReceiptOpen(false);
      setReceiptCourseId(null);
      setReceiptYears('1');
      setReceiptVoucher('');
      setReceiptClassBatchId(null);
      refresh();
    } catch (e) {
      notifyError(e, 'Tạo phiếu thu thất bại');
    } finally {
      setReceiptBusy(false);
    }
  }

  if (loading) {
    return (
      <Group>
        <Loader size="sm" />
        <Text c="dimmed">Đang tải cơ hội…</Text>
      </Group>
    );
  }
  if (error || !opp) {
    return (
      <Stack>
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={onBack}
          w="fit-content"
        >
          Quay lại pipeline
        </Button>
        <Alert color="cmcRed" title="Không mở được cơ hội">
          {error ?? 'Không tìm thấy cơ hội.'}
        </Alert>
      </Stack>
    );
  }

  const closed = isClosed(opp);
  const st = statusOf(opp);
  const statusLabel = opp.lostReason
    ? `Mất · ${LOST_REASON_LABEL[opp.lostReason] ?? opp.lostReason}`
    : st.label;
  const title = opp.studentName || opp.contact.fullName;
  // The current owner cannot be the reassign target (server rejects it too).
  const ownerOptions = owners
    .filter((o) => o.id !== opp.ownerId)
    .map((o) => ({ value: o.id, label: `${o.displayName} · ${o.primaryRole}` }));

  const testColumns: DataTableColumn<TestAppt>[] = [
    {
      key: 'type',
      header: 'Loại',
      width: 100,
      render: (t) => (t.type === 'entrance' ? 'Đầu vào' : 'Định kỳ'),
    },
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
        const ts = testStatus(t);
        return <StatusBadge status={ts.label} label={ts.label} tone={ts.tone} />;
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
      {/* Header: back + title + status + record actions */}
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="sm" wrap="nowrap">
          <ActionIcon variant="subtle" size="lg" aria-label="Quay lại" onClick={onBack}>
            <IconArrowLeft size={18} />
          </ActionIcon>
          <div>
            <Title order={4}>{title}</Title>
            <Text size="sm" c="dimmed">
              {opp.contact.phone}
            </Text>
          </div>
          <StatusBadge status={st.label} label={statusLabel} tone={st.tone} />
        </Group>
        <Group gap="xs">
          {!closed && (
            <Button size="xs" variant="light" onClick={() => setTestOpen(true)}>
              Đặt test
            </Button>
          )}
          {!closed && canReassign && (
            <Button size="xs" variant="light" color="violet" onClick={() => setReassignOpen(true)}>
              Đổi phụ trách
            </Button>
          )}
          {!closed && canCreateReceipt && (
            <Button size="xs" onClick={() => setReceiptOpen(true)}>
              Tạo phiếu thu
            </Button>
          )}
          {closed ? (
            <Button size="xs" variant="light" onClick={reopen}>
              Mở lại
            </Button>
          ) : (
            <Button size="xs" variant="light" color="red" onClick={() => setLostOpen(true)}>
              Đánh dấu mất
            </Button>
          )}
        </Group>
      </Group>

      {/* Clickable stage statusbar */}
      <Card withBorder p="sm" radius="sm">
        <StageBar current={opp.stage} disabled={closed} onPick={pickStage} />
        {closed && (
          <Text size="xs" c="dimmed" mt="xs">
            Cơ hội đã đóng — mở lại để tiếp tục chuyển bước.
          </Text>
        )}
      </Card>

      {/* Lead + attribution info */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        <Card withBorder p="lg" radius="sm">
          <SectionHeading>Thông tin liên hệ</SectionHeading>
          <Stack gap="xs">
            <Field label="Liên hệ" value={opp.contact.fullName} />
            <Field label="Số điện thoại" value={opp.contact.phone} />
            <Field label="Email" value={opp.contact.email} />
            <Field label="Học sinh" value={opp.studentName} />
            <Field
              label="Chương trình"
              value={opp.program ? (PROGRAM_LABEL[opp.program] ?? opp.program) : '—'}
            />
          </Stack>
        </Card>
        <Card withBorder p="lg" radius="sm">
          <SectionHeading>Phân bổ &amp; nguồn</SectionHeading>
          <Stack gap="xs">
            <Field
              label="Người phụ trách"
              value={<Badge variant="light">{ownerName(opp.ownerId)}</Badge>}
            />
            <Field label="Kênh nguồn" value={opp.contact.medium || opp.contact.source} />
            <Field label="Chiến dịch" value={opp.contact.campaign} />
            <Field label="Ngày tạo" value={new Date(opp.createdAt).toLocaleString('vi-VN')} />
            {opp.lostNote && <Field label="Ghi chú mất" value={opp.lostNote} />}
          </Stack>
        </Card>
      </SimpleGrid>

      {canCreateReceipt && ownReceipts.length > 0 && (
        <Card withBorder p="lg" radius="sm">
          <SectionHeading>Phiếu thu của tôi</SectionHeading>
          <Stack gap="xs">
            {ownReceipts.map((receipt) => {
              const status = RECEIPT_STATUS[receipt.status] ?? {
                label: receipt.status,
                color: 'gray',
              };
              return (
                <Group key={receipt.id} justify="space-between" gap="md">
                  <Text size="sm">{receipt.code ?? 'Phiếu nháp'}</Text>
                  <Group gap="xs">
                    <Text size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {receipt.netAmount.toLocaleString('vi-VN')}đ
                    </Text>
                    <Badge color={status.color}>{status.label}</Badge>
                  </Group>
                </Group>
              );
            })}
          </Stack>
        </Card>
      )}

      <Divider label="Lịch sử phân bổ" labelPosition="left" />
      <AssignmentHistoryBlock opportunityId={opp.id} ownerName={ownerName} />

      <Divider label="Lịch test" labelPosition="left" />
      <DataTable
        data={oppTests}
        columns={testColumns}
        getRowKey={(t) => t.id}
        loading={testsLoading}
        pageSize={10}
        emptyState={
          <EmptyState
            icon={<IconCalendarStats size={28} stroke={1.5} />}
            title="Chưa có lịch test"
            description="Bấm “Đặt test” ở trên để đặt lịch test đầu vào cho cơ hội này."
          />
        }
      />

      <Divider label="Nhật ký hoạt động" labelPosition="left" />
      <Chatter
        entityType="opportunity"
        entityId={opp.id}
        fieldLabels={{ stage: 'Giai đoạn', ownerId: 'Người phụ trách' }}
        formatValue={(field, value) => {
          if (field === 'stage') return STAGE_LABEL[value as string] ?? String(value);
          if (field === 'ownerId') return value ? ownerName(value as string) : '(chưa có)';
          if (value === null || value === undefined || value === '') return '(trống)';
          return String(value);
        }}
      />

      {/* ── Action modals ──────────────────────────────────────────────────── */}
      <Modal
        opened={reassignOpen}
        onClose={() => setReassignOpen(false)}
        title="Đổi người phụ trách"
      >
        <Stack>
          <Text size="sm">
            Cơ hội: <strong>{title}</strong> · hiện tại: {ownerName(opp.ownerId)}
          </Text>
          <Select
            label="Người phụ trách mới"
            placeholder={ownerOptions.length ? 'Chọn nhân viên…' : 'Không có nhân viên phù hợp'}
            data={ownerOptions}
            value={reassignToOwnerId}
            onChange={setReassignToOwnerId}
            searchable
            nothingFoundMessage="Không tìm thấy"
            allowDeselect={false}
          />
          <TextInput
            label="Lý do (tùy chọn)"
            placeholder="Chia lại vùng, nghỉ phép…"
            value={reassignReason}
            onChange={(e) => setReassignReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setReassignOpen(false)}>
              Đóng
            </Button>
            <Button color="violet" disabled={!reassignToOwnerId} onClick={doReassign}>
              Xác nhận
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={lostOpen} onClose={() => setLostOpen(false)} title="Đánh dấu cơ hội mất">
        <Stack>
          <Select
            label="Lý do"
            data={LOST_REASON_OPTIONS}
            value={lostReason}
            onChange={(v) => setLostReason(v as LostReasonValue)}
            placeholder="Chọn lý do..."
            allowDeselect={false}
          />
          <Textarea
            label="Ghi chú (tùy chọn)"
            description={lostReason === 'other' ? 'Vui lòng mô tả thêm lý do cụ thể.' : undefined}
            autosize
            minRows={2}
            value={lostNote}
            onChange={(e) => setLostNote(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLostOpen(false)}>
              Đóng
            </Button>
            <Button color="red" disabled={!lostReason} onClick={doMarkLost}>
              Xác nhận
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={testOpen} onClose={() => setTestOpen(false)} title="Đặt lịch test đầu vào">
        <Stack>
          <Text size="sm">{title} — cơ hội sẽ tự chuyển sang O3.</Text>
          <DateTimePicker
            label="Thời gian test"
            value={testAt}
            onChange={(v: Date | null) => setTestAt(v)}
            error={testAt && testAt.getHours() === 0 && testAt.getMinutes() === 0 ? 'Chọn giờ cụ thể, chưa chỉ chọn ngày' : undefined}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setTestOpen(false)}>
              Đóng
            </Button>
            <Button
              disabled={!testAt || (testAt.getHours() === 0 && testAt.getMinutes() === 0)}
              onClick={scheduleTest}
            >
              Đặt lịch
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        title="Tạo phiếu thu từ cơ hội"
      >
        <Stack>
          <Text size="sm">
            {title} · {opp.contact.phone}
          </Text>
          <Select
            label="Khóa học"
            withAsterisk
            searchable
            placeholder={courses.length ? 'Chọn khóa học' : 'Chưa có khóa học'}
            data={courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
            value={receiptCourseId}
            onChange={setReceiptCourseId}
          />
          <Select
            label="Lớp học (tùy chọn)"
            description="Ghi danh học sinh vào lớp này ngay khi phiếu thu được duyệt — không cần thao tác Ghi danh riêng"
            searchable
            clearable
            placeholder={
              classBatches.filter((b) => b.facilityId === opp.facilityId).length
                ? 'Chọn lớp'
                : 'Chưa có lớp tại cơ sở này'
            }
            // Scoped to this opportunity's facility — receiptApprove rejects a cross-facility
            // batch server-side too, but filtering here keeps the picker from listing options
            // that are guaranteed to fail on submit for a multi-facility staff member.
            data={classBatches
              .filter((b) => b.facilityId === opp.facilityId)
              .map((b) => ({
                value: b.id,
                label: `${b.code} · ${b.course.code}`,
              }))}
            value={receiptClassBatchId}
            onChange={setReceiptClassBatchId}
          />
          <Group grow align="flex-end">
            <Select
              label="Đóng trước"
              data={YEARS}
              value={receiptYears}
              allowDeselect={false}
              onChange={(v) => v && setReceiptYears(v)}
            />
            <TextInput
              label="Voucher"
              placeholder="Tùy chọn"
              value={receiptVoucher}
              onChange={(e) => setReceiptVoucher(e.currentTarget.value)}
            />
          </Group>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setReceiptOpen(false)}>
              Đóng
            </Button>
            <Button
              disabled={!receiptCourseId}
              loading={receiptBusy}
              onClick={createOpportunityReceipt}
            >
              Tạo phiếu nháp
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!gradeTarget} onClose={() => setGradeTarget(null)} title="Chấm test">
        <Stack>
          <NumberInput
            label="Điểm"
            min={0}
            max={10}
            step={0.5}
            value={gradeScore}
            onChange={setGradeScore}
          />
          <TextInput
            label="Kết quả (tùy chọn)"
            placeholder="đạt / chưa đạt"
            value={gradeResult}
            onChange={(e) => setGradeResult(e.currentTarget.value)}
          />
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
