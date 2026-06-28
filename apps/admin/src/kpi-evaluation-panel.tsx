import React, { useCallback, useEffect, useState } from 'react';
import { trpc, useSession, notifyError, notifySuccess } from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

// ─── Loose re-type to avoid TS2589 on deep tRPC inference ───────────────────

type RosterEntry = { id: string; displayName: string; primaryRole: string };

type KpiRow = {
  id: string;
  userId: string;
  facilityId: number;
  periodKey: string;
  block: string;
  status: string;
  autoScore: number;
  overrideScore: number | null;
  criterionScores: unknown;
};

type CriterionConfig = { key: string; label: string; weight: number };

type KpiEvalGetResult = {
  row: KpiRow;
  criteriaConfig: CriterionConfig[];
};

type ScoreEntry = { key: string; score: number };

const payrollApi = trpc.payroll as unknown as {
  roster: { query: (i: { facilityId: number }) => Promise<RosterEntry[]> };
  kpiList: { query: (i: { facilityId: number; periodKey: string }) => Promise<KpiRow[]> };
  kpiEvalStart: { mutate: (i: { userId: string; facilityId: number; periodKey: string; block: 'training' | 'sales' }) => Promise<unknown> };
  kpiAutoPrefill: { mutate: (i: { userId: string; facilityId: number; periodKey: string }) => Promise<unknown> };
  kpiEvalSubmit: { mutate: (i: { periodKey: string; scores: ScoreEntry[] }) => Promise<unknown> };
  kpiEvalConfirm: { mutate: (i: { userId: string; periodKey: string }) => Promise<unknown> };
  kpiEvalApprove: { mutate: (i: { userId: string; periodKey: string }) => Promise<unknown> };
  kpiOverride: { mutate: (i: { userId: string; periodKey: string; overrideScore: number; reason: string }) => Promise<unknown> };
  kpiEvalGet: { query: (i: { userId: string; periodKey: string }) => Promise<KpiEvalGetResult> };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const todayMonth = () => new Date().toISOString().slice(0, 7);

function statusColor(status: string): string {
  switch (status) {
    case 'draft': return 'gray';
    case 'submitted': return 'blue';
    case 'confirmed': return 'orange';
    case 'approved': return 'green';
    default: return 'gray';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'draft': return 'Nháp';
    case 'submitted': return 'Đã nộp';
    case 'confirmed': return 'Đã xác nhận';
    case 'approved': return 'Đã duyệt';
    default: return status;
  }
}

function previewTotal(criteria: CriterionConfig[], scores: ScoreEntry[]): string {
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return '—';
  const weighted = criteria.reduce((s, c) => {
    const se = scores.find((e) => e.key === c.key);
    return s + c.weight * (se?.score ?? 0);
  }, 0);
  return (weighted / totalWeight).toFixed(1);
}

// ─── Detail card ─────────────────────────────────────────────────────────────

function KpiDetailCard({
  row,
  rosterMap,
  facilityId,
  onClose,
  onRefresh,
}: {
  row: KpiRow;
  rosterMap: Map<string, string>;
  facilityId: number;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [detail, setDetail] = useState<KpiEvalGetResult | null>(null);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [busy, setBusy] = useState(false);
  // Audited score adjustment (kpiOverride): a manager/tree-authority sets a final score + mandatory
  // reason. This is the ONLY in-app way to change a score after the draft stage; the change is logged.
  const [ovScore, setOvScore] = useState(0);
  const [ovReason, setOvReason] = useState('');

  const load = useCallback(() => {
    payrollApi.kpiEvalGet
      .query({ userId: row.userId, periodKey: row.periodKey })
      .then((d) => {
        setDetail(d);
        const saved = (d.row.criterionScores as ScoreEntry[] | null) ?? [];
        setScores(
          d.criteriaConfig.map((c) => ({
            key: c.key,
            score: saved.find((s) => s.key === c.key)?.score ?? 0,
          })),
        );
      })
      .catch((e) => notifyError(e, 'Không thể tải chi tiết phiếu KPI'));
  }, [row.userId, row.periodKey]);

  useEffect(() => { load(); }, [load]);

  function setScore(key: string, val: number) {
    setScores((prev) => prev.map((s) => (s.key === key ? { ...s, score: val } : s)));
  }

  async function doPrefill() {
    setBusy(true);
    try {
      await payrollApi.kpiAutoPrefill.mutate({ userId: row.userId, facilityId, periodKey: row.periodKey });
      notifySuccess('Tự điền thành công — đã cập nhật tiêu chí từ dữ liệu thực.');
      load();
      onRefresh();
    } catch (e) {
      notifyError(e, 'Tự điền KPI thất bại');
    } finally { setBusy(false); }
  }

  async function doSubmit() {
    setBusy(true);
    try {
      await payrollApi.kpiEvalSubmit.mutate({ periodKey: row.periodKey, scores });
      notifySuccess('Đã nộp phiếu KPI.');
      onRefresh();
    } catch (e) {
      notifyError(e, 'Nộp phiếu KPI thất bại');
    } finally { setBusy(false); }
  }

  async function doConfirm() {
    setBusy(true);
    try {
      // Confirm = đồng ý y nguyên điểm; KHÔNG gửi scores (server bỏ qua). Muốn sửa điểm thì dùng
      // chức năng "Điều chỉnh KPI" (kpiOverride) — có ghi log minh bạch.
      await payrollApi.kpiEvalConfirm.mutate({ userId: row.userId, periodKey: row.periodKey });
      notifySuccess('Đã xác nhận phiếu KPI.');
      onRefresh();
    } catch (e) {
      notifyError(e, 'Xác nhận phiếu KPI thất bại');
    } finally { setBusy(false); }
  }

  async function doApprove() {
    setBusy(true);
    try {
      await payrollApi.kpiEvalApprove.mutate({ userId: row.userId, periodKey: row.periodKey });
      notifySuccess('Đã phê duyệt phiếu KPI. Điểm chính thức đã được ghi.');
      onRefresh();
    } catch (e) {
      notifyError(e, 'Phê duyệt phiếu KPI thất bại');
    } finally { setBusy(false); }
  }

  async function doOverride() {
    setBusy(true);
    try {
      await payrollApi.kpiOverride.mutate({
        userId: row.userId, periodKey: row.periodKey, overrideScore: ovScore, reason: ovReason.trim(),
      });
      notifySuccess('Đã điều chỉnh điểm KPI (đã ghi log).');
      setOvReason('');
      load();
      onRefresh();
    } catch (e) {
      notifyError(e, 'Điều chỉnh KPI thất bại');
    } finally { setBusy(false); }
  }

  const staffName = rosterMap.get(row.userId) ?? row.userId;
  const criteria = detail?.criteriaConfig ?? [];

  return (
    <Card radius="lg" mt="sm" style={{ border: '1px solid var(--cmc-border)' }}>
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Text fw={600} size="sm" style={{ color: 'var(--cmc-text)' }}>{staffName}</Text>
          <Badge size="sm" color={row.block === 'sales' ? 'violet' : 'cyan'} variant="light" radius="xl">{row.block}</Badge>
          <Badge size="sm" color={statusColor(row.status)} variant="light" radius="xl">{statusLabel(row.status)}</Badge>
        </Group>
        <Button size="xs" variant="subtle" onClick={onClose}>Đóng</Button>
      </Group>

      {criteria.length > 0 && (
        <>
          <Table fz="sm" mb="sm" striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Tiêu chí</Table.Th>
                <Table.Th style={TH_STYLE}>Trọng số</Table.Th>
                <Table.Th style={TH_STYLE}>Điểm (0–100)</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {criteria.map((c) => (
                <Table.Tr key={c.key}>
                  <Table.Td>{c.label}</Table.Td>
                  <Table.Td>{(c.weight * 100).toFixed(0)}%</Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      min={0}
                      max={100}
                      value={scores.find((s) => s.key === c.key)?.score ?? 0}
                      onChange={(v) => setScore(c.key, Number(v) || 0)}
                      disabled={row.status !== 'draft'}
                      w={90}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="sm" c="dimmed" mb="sm">
            Điểm tổng dự kiến: <b>{previewTotal(criteria, scores)}</b> / 100
            {row.status === 'approved' && row.autoScore !== null && (
              <> &nbsp;·&nbsp; Điểm chính thức (server): <b>{row.autoScore.toFixed(1)}</b></>
            )}
          </Text>
        </>
      )}

      {row.status === 'draft' && (
        <Group>
          <Button size="xs" variant="light" onClick={doPrefill} loading={busy}>Tự điền</Button>
          <Button size="xs" onClick={doSubmit} loading={busy}>Nộp</Button>
        </Group>
      )}
      {row.status === 'submitted' && (
        <Button size="xs" onClick={doConfirm} loading={busy}>Xác nhận</Button>
      )}
      {row.status === 'confirmed' && (
        <Button size="xs" color="orange" onClick={doApprove} loading={busy}>Duyệt</Button>
      )}
      {(row.status === 'submitted' || row.status === 'confirmed') && (
        <Group align="flex-end" gap="xs" mt="sm">
          <NumberInput
            label="Điều chỉnh KPI (0–100)" min={0} max={100} w={150} size="xs"
            value={ovScore} onChange={(v) => setOvScore(Number(v) || 0)}
          />
          <TextInput
            label="Lý do (bắt buộc)" w={240} size="xs"
            value={ovReason} onChange={(e) => setOvReason(e.currentTarget.value)}
          />
          <Button size="xs" variant="light" color="grape" onClick={doOverride} loading={busy} disabled={!ovReason.trim()}>
            Áp dụng (ghi log)
          </Button>
        </Group>
      )}
    </Card>
  );
}

// ─── Kanban column ────────────────────────────────────────────────────────────

function KanbanColumn({
  status,
  rows,
  rosterMap,
  facilityId,
  selectedId,
  onSelect,
  onRefresh,
}: {
  status: string;
  rows: KpiRow[];
  rosterMap: Map<string, string>;
  facilityId: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRefresh: () => void;
}) {
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Badge color={statusColor(status)}>{statusLabel(status)}</Badge>
        <Text size="xs" c="dimmed">({rows.length})</Text>
      </Group>
      {rows.length === 0 && <Text size="xs" c="dimmed">Không có phiếu</Text>}
      {rows.map((r) => (
        <Card key={r.id} radius="lg" padding="xs" style={{ cursor: 'pointer', border: '1px solid var(--cmc-border)', transition: 'box-shadow 200ms' }}>
          <Stack gap={4} onClick={() => onSelect(selectedId === r.id ? null : r.id)}>
            <Text size="sm" fw={500}>{rosterMap.get(r.userId) ?? r.userId}</Text>
            <Group gap="xs">
              <Badge size="xs" color={r.block === 'sales' ? 'violet' : 'cyan'}>{r.block}</Badge>
              {r.autoScore != null && r.status === 'approved' && (
                <Text size="xs" c="teal">Điểm: {r.autoScore.toFixed(1)}</Text>
              )}
              {r.overrideScore != null && (
                <Text size="xs" c="orange">Override: {r.overrideScore.toFixed(1)}</Text>
              )}
            </Group>
          </Stack>
          {selectedId === r.id && (
            <KpiDetailCard
              row={r}
              rosterMap={rosterMap}
              facilityId={facilityId}
              onClose={() => onSelect(null)}
              onRefresh={() => { onSelect(null); onRefresh(); }}
            />
          )}
        </Card>
      ))}
    </Stack>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function KpiEvaluationPanel() {
  const { me } = useSession();

  const [facilityId, setFacilityId] = useState<string | null>(
    me.facilityIds.length > 0 ? String(me.facilityIds[0]) : null,
  );
  const facilityOptions = me.facilityIds.map((id) => ({ value: String(id), label: `Cơ sở #${id}` }));

  const [periodKey, setPeriodKey] = useState(todayMonth());
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [kpiRows, setKpiRows] = useState<KpiRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create-eval form state
  const [createUserId, setCreateUserId] = useState<string | null>(null);
  const [createBlock, setCreateBlock] = useState<string>('training');
  const [createBusy, setCreateBusy] = useState(false);

  const fid = facilityId ? Number(facilityId) : null;

  const loadRoster = useCallback(() => {
    if (!fid) return;
    payrollApi.roster
      .query({ facilityId: fid })
      .then(setRoster)
      .catch((e) => notifyError(e, 'Không tải được danh sách nhân sự'));
  }, [fid]);

  const loadKpiList = useCallback(() => {
    if (!fid || !periodKey) return;
    payrollApi.kpiList
      .query({ facilityId: fid, periodKey })
      .then(setKpiRows)
      .catch((e) => notifyError(e, 'Không tải được danh sách phiếu KPI'));
  }, [fid, periodKey]);

  useEffect(() => { loadRoster(); }, [loadRoster]);
  useEffect(() => { loadKpiList(); }, [loadKpiList]);

  const rosterMap = new Map(roster.map((r) => [r.id, r.displayName]));
  const rosterData = roster.map((r) => ({ value: r.id, label: `${r.displayName} (${r.primaryRole})` }));

  const byStatus = (s: string) => kpiRows.filter((r) => r.status === s);

  if (me.facilityIds.length === 0) {
    return <Text c="dimmed">Tài khoản chưa được gán cơ sở.</Text>;
  }

  async function createEval() {
    if (!fid || !createUserId) return;
    setCreateBusy(true);
    try {
      await payrollApi.kpiEvalStart.mutate({
        userId: createUserId,
        facilityId: fid,
        periodKey,
        block: createBlock as 'training' | 'sales',
      });
      notifySuccess(`Đã tạo phiếu KPI cho ${rosterMap.get(createUserId) ?? createUserId}.`);
      setCreateUserId(null);
      loadKpiList();
    } catch (e) {
      notifyError(e, 'Tạo phiếu KPI thất bại');
    } finally { setCreateBusy(false); }
  }

  return (
    <Stack>
      <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)', backgroundColor: 'var(--cmc-info-bg)' }}>
        <Text size="sm" style={{ color: 'var(--cmc-info-text)' }}>
          Vòng đời phiếu KPI: <b>Nháp</b> → Nhân sự tự nộp (<b>Đã nộp</b>) → Quản lý xác nhận (<b>Đã xác nhận</b>) → BGĐ phê duyệt (<b>Đã duyệt</b>).
          Khi phê duyệt, điểm khóa lại và đổ vào phiếu lương kỳ đó.
        </Text>
      </Card>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} size="sm" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }} mb="sm">Bộ lọc</Text>
        <Group align="flex-end">
          {me.facilityIds.length > 1 && (
            <Select label="Cơ sở" data={facilityOptions} value={facilityId} onChange={setFacilityId} w={160} />
          )}
          <TextInput
            label="Kỳ lương (YYYY-MM)"
            value={periodKey}
            onChange={(e) => setPeriodKey(e.currentTarget.value)}
            placeholder="YYYY-MM"
            w={150}
          />
          <Button variant="subtle" onClick={() => { loadRoster(); loadKpiList(); }}>
            Tải lại
          </Button>
        </Group>
      </Card>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="sm">Tạo phiếu kỳ này cho nhân sự</Text>
        <Group align="flex-end">
          <Select
            label="Nhân sự"
            placeholder="Chọn người"
            data={rosterData}
            value={createUserId}
            onChange={setCreateUserId}
            searchable
            w={280}
          />
          <Select
            label="Bộ phận"
            data={[
              { value: 'training', label: 'Đào tạo (training)' },
              { value: 'sales', label: 'Kinh doanh (sales)' },
            ]}
            value={createBlock}
            onChange={(v) => setCreateBlock(v ?? 'training')}
            w={200}
          />
          <Button variant="filled" radius={9999} onClick={createEval} loading={createBusy} disabled={!createUserId || !fid}>
            Tạo phiếu
          </Button>
        </Group>
      </Card>

      <Text fw={600} size="lg" style={{ color: 'var(--cmc-text)' }}>Phiếu KPI kỳ {periodKey}</Text>

      {fid && (
        <SimpleGrid cols={4} spacing="sm">
          {(['draft', 'submitted', 'confirmed', 'approved'] as const).map((s) => (
            <KanbanColumn
              key={s}
              status={s}
              rows={byStatus(s)}
              rosterMap={rosterMap}
              facilityId={fid}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRefresh={loadKpiList}
            />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
