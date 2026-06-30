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
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconArrowLeft } from '@tabler/icons-react';
import {
  STAGES,
  LOST_REASON_OPTIONS,
  LOST_REASON_LABEL,
  makeOwnerName,
  type LostReasonValue,
  statusOf,
  isClosed,
  stageIndex,
} from './crm-shared';

type OppDetail = Awaited<ReturnType<typeof trpc.crm.opportunityGet.query>>;
type Owner = Awaited<ReturnType<typeof trpc.crm.assignableOwners.query>>[number];
type AssignmentLog = Awaited<ReturnType<typeof trpc.crm.assignmentHistory.query>>[number];

const PROGRAM_LABEL: Record<string, string> = {
  UCREA: 'UCREA',
  BRIGHT_IG: 'Bright I.G',
  BLACK_HOLE: 'Black Hole',
};

/** Two-column read-only field row (matches student/staff/schedule detail visual language). */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <Text size="sm" c="dimmed">{label}</Text>
      {/* component="div" so non-text values (e.g. a <Badge>) don't nest a block inside a <p>. */}
      <Text component="div" size="sm" style={{ textAlign: 'right' }}>{value ?? '—'}</Text>
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
            color={active ? 'cmcRed' : done ? 'teal' : 'gray'}
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
    trpc.crm.assignmentHistory.query({ opportunityId }).then(setLogs).catch(() => setLogs([]));
  }, [opportunityId]);

  if (!logs) return <Text size="sm" c="dimmed">Đang tải lịch sử phân bổ...</Text>;
  if (logs.length === 0) return <Text size="sm" c="dimmed">Chưa có lịch sử phân bổ.</Text>;

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

  const [opp, setOpp] = useState<OppDetail | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignToOwnerId, setReassignToOwnerId] = useState<string | null>(null);
  const [reassignReason, setReassignReason] = useState('');
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState<LostReasonValue | null>(null);
  const [lostNote, setLostNote] = useState('');
  const [testOpen, setTestOpen] = useState(false);
  const [testAt, setTestAt] = useState<Date | null>(null);

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
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được cơ hội'))
      .finally(() => setLoading(false));
  }, [oppId]);
  useEffect(load, [load]);

  // Refresh the record after any write, and let the parent list refresh too.
  const refresh = useCallback(() => {
    load();
    onChanged?.();
  }, [load, onChanged]);

  const ownerName = useMemo(() => makeOwnerName(owners), [owners]);

  async function pickStage(stage: string) {
    if (!opp) return;
    try {
      await trpc.crm.opportunityTransition.mutate({ id: opp.id, stage: stage as OppDetail['stage'] });
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
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack} w="fit-content">
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
            <Text size="sm" c="dimmed">{opp.contact.phone}</Text>
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
      <Card withBorder p="sm" radius="md">
        <StageBar current={opp.stage} disabled={closed} onPick={pickStage} />
        {closed && (
          <Text size="xs" c="dimmed" mt="xs">
            Cơ hội đã đóng — mở lại để tiếp tục chuyển bước.
          </Text>
        )}
      </Card>

      {/* Lead + attribution info */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        <Card withBorder p="md" radius="md">
          <Title order={6} mb="sm">Thông tin liên hệ</Title>
          <Stack gap="xs">
            <Field label="Liên hệ" value={opp.contact.fullName} />
            <Field label="Số điện thoại" value={opp.contact.phone} />
            <Field label="Email" value={opp.contact.email} />
            <Field label="Học sinh" value={opp.studentName} />
            <Field label="Chương trình" value={opp.program ? PROGRAM_LABEL[opp.program] ?? opp.program : '—'} />
          </Stack>
        </Card>
        <Card withBorder p="md" radius="md">
          <Title order={6} mb="sm">Phân bổ &amp; nguồn</Title>
          <Stack gap="xs">
            <Field label="Người phụ trách" value={<Badge variant="light">{ownerName(opp.ownerId)}</Badge>} />
            <Field label="Kênh nguồn" value={opp.contact.medium || opp.contact.source} />
            <Field label="Chiến dịch" value={opp.contact.campaign} />
            <Field label="Ngày tạo" value={new Date(opp.createdAt).toLocaleString('vi-VN')} />
            {opp.lostNote && <Field label="Ghi chú mất" value={opp.lostNote} />}
          </Stack>
        </Card>
      </SimpleGrid>

      <Divider label="Lịch sử phân bổ" labelPosition="left" />
      <AssignmentHistoryBlock opportunityId={opp.id} ownerName={ownerName} />

      <Divider label="Nhật ký hoạt động" labelPosition="left" />
      <Chatter entityType="opportunity" entityId={opp.id} />

      {/* ── Action modals ──────────────────────────────────────────────────── */}
      <Modal opened={reassignOpen} onClose={() => setReassignOpen(false)} title="Đổi người phụ trách">
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
            <Button variant="default" onClick={() => setReassignOpen(false)}>Đóng</Button>
            <Button color="violet" disabled={!reassignToOwnerId} onClick={doReassign}>Xác nhận</Button>
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
            <Button variant="default" onClick={() => setLostOpen(false)}>Đóng</Button>
            <Button color="red" disabled={!lostReason} onClick={doMarkLost}>Xác nhận</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={testOpen} onClose={() => setTestOpen(false)} title="Đặt lịch test đầu vào">
        <Stack>
          <Text size="sm">{title} — cơ hội sẽ tự chuyển sang O3.</Text>
          <DateTimePicker label="Thời gian test" value={testAt} onChange={(v: Date | null) => setTestAt(v)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setTestOpen(false)}>Đóng</Button>
            <Button disabled={!testAt} onClick={scheduleTest}>Đặt lịch</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
