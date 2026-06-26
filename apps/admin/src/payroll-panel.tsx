import React, { useState, useEffect, useCallback } from 'react';
import { trpc, notifyError, notifySuccess, useSession } from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';

// ─── Types ────────────────────────────────────────────────────────────────────
// Explicit shapes to avoid TS2589 (deep type instantiation from AppRouter).

type PayslipRow = {
  id: string;
  periodKey: string;
  status: string;
  netIncome: number | null;
  grossIncome: number | null;
  kpiGrade: string | null;
};

type RosterEntry = { id: string; displayName: string; primaryRole: string | null };
type BulkPayResult = { succeeded: string[]; failed: string[] };
type PeriodSummary = {
  periodKey: string;
  count: number;
  totalGross: number;
  totalNet: number;
  totalPit: number;
  totalInsurance: number;
  draftCount: number;
  finalizedCount: number;
  paidCount: number;
  finalizedNet: number;
};

// Cast to a typed local interface to keep TS compilation fast across agent merges.
const payrollApi = trpc.payroll as unknown as {
  roster: { query: (i: { facilityId: number }) => Promise<RosterEntry[]> };
  listByStaff: { query: (i: { staffId: string }) => Promise<PayslipRow[]> };
  payslipCompute: {
    mutate: (i: {
      userId: string;
      facilityId: number;
      periodKey: string;
      standardDays: number;
      workdays: number;
      kpiScore?: number;
      variablePay?: number;
      variableNote?: string;
      insuranceDeduction?: number;
    }) => Promise<PayslipRow>;
  };
  payslipFinalize: { mutate: (i: { id: string }) => Promise<PayslipRow> };
  payslipMarkPaid: { mutate: (i: { id: string }) => Promise<PayslipRow> };
  payslipReopen: { mutate: (i: { id: string }) => Promise<PayslipRow> };
  payslipBulkPay: { mutate: (i: string[]) => Promise<BulkPayResult> };
  payslipPeriodSummary: {
    query: (i: { facilityId: number; periodKey: string }) => Promise<PeriodSummary>;
  };
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--mantine-color-gray-6)',
  fontWeight: 600,
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft: { label: 'Nháp', color: 'gray' },
  finalized: { label: 'Đã chốt', color: 'blue' },
  paid: { label: 'Đã trả', color: 'green' },
};

const vnd = (n: number | null) =>
  n != null ? n.toLocaleString('vi-VN') + 'đ' : '—';

// Reasonable defaults for a monthly payroll cycle.
const DEFAULT_STANDARD_DAYS = 26;

// ─── Period Summary Card ──────────────────────────────────────────────────────

function PeriodSummaryCard({ facilityId }: { facilityId: number }) {
  const [periodKey, setPeriodKey] = useState('');
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!periodKey.match(/^\d{4}-\d{2}$/)) {
      setError('Nhập kỳ theo định dạng YYYY-MM');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const s = await payrollApi.payslipPeriodSummary.query({ facilityId, periodKey });
      setSummary(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Lỗi tải tóm tắt kỳ');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Tóm tắt kỳ lương
      </Title>
      <Group align="flex-end" mb="sm">
        <TextInput
          label="Kỳ (YYYY-MM)"
          placeholder="2026-06"
          value={periodKey}
          onChange={(e) => setPeriodKey(e.currentTarget.value)}
          w={160}
          error={error && !periodKey.match(/^\d{4}-\d{2}$/) ? error : undefined}
        />
        <Button onClick={() => void load()} loading={loading} disabled={!periodKey}>
          Xem tóm tắt
        </Button>
      </Group>

      {error && periodKey.match(/^\d{4}-\d{2}$/) && (
        <Alert color="red" mb="sm">
          {error}
          <Button size="xs" variant="subtle" mt="xs" onClick={() => void load()}>
            Thử lại
          </Button>
        </Alert>
      )}

      {summary && (
        <Stack gap="xs">
          <Group gap="xl">
            <Stack gap={2}>
              <Text size="xs" c="dimmed">Tổng phiếu</Text>
              <Text fw={600}>{summary.count}</Text>
            </Stack>
            <Stack gap={2}>
              <Text size="xs" c="dimmed">Nháp</Text>
              <Text fw={600} c="gray">{summary.draftCount}</Text>
            </Stack>
            <Stack gap={2}>
              <Text size="xs" c="dimmed">Đã chốt</Text>
              <Text fw={600} c="blue">{summary.finalizedCount}</Text>
            </Stack>
            <Stack gap={2}>
              <Text size="xs" c="dimmed">Đã trả</Text>
              <Text fw={600} c="green">{summary.paidCount}</Text>
            </Stack>
          </Group>
          <Group gap="xl">
            <Stack gap={2}>
              <Text size="xs" c="dimmed">Tổng thực lĩnh</Text>
              <Text fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(summary.totalNet)}</Text>
            </Stack>
            <Stack gap={2}>
              <Text size="xs" c="dimmed">Chờ thanh toán</Text>
              <Text fw={600} c="blue" style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(summary.finalizedNet)}</Text>
            </Stack>
            <Stack gap={2}>
              <Text size="xs" c="dimmed">PIT</Text>
              <Text fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(summary.totalPit)}</Text>
            </Stack>
            <Stack gap={2}>
              <Text size="xs" c="dimmed">Bảo hiểm</Text>
              <Text fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(summary.totalInsurance)}</Text>
            </Stack>
          </Group>
        </Stack>
      )}
    </Card>
  );
}

// ─── Compute Form ─────────────────────────────────────────────────────────────

function ComputeForm({
  staffId,
  facilityId,
  onDone,
}: {
  staffId: string;
  facilityId: number;
  onDone: () => void;
}) {
  const [periodKey, setPeriodKey] = useState('');
  const [standardDays, setStandardDays] = useState<number | string>(DEFAULT_STANDARD_DAYS);
  const [workdays, setWorkdays] = useState<number | string>(DEFAULT_STANDARD_DAYS);
  const [kpiScore, setKpiScore] = useState<number | string>('');
  const [variablePay, setVariablePay] = useState<number | string>(0);
  const [variableNote, setVariableNote] = useState('');
  const [insuranceDeduction, setInsuranceDeduction] = useState<number | string>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function compute() {
    if (!periodKey.match(/^\d{4}-\d{2}$/)) {
      setErr('Kỳ phải theo định dạng YYYY-MM');
      return;
    }
    if (typeof standardDays !== 'number' || standardDays < 1) {
      setErr('Số ngày chuẩn phải ≥ 1');
      return;
    }
    if (typeof workdays !== 'number' || workdays < 0) {
      setErr('Số ngày làm phải ≥ 0');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const slip = await payrollApi.payslipCompute.mutate({
        userId: staffId,
        facilityId,
        periodKey,
        standardDays: standardDays as number,
        workdays: workdays as number,
        kpiScore: typeof kpiScore === 'number' ? kpiScore : undefined,
        variablePay: typeof variablePay === 'number' ? variablePay : 0,
        variableNote: variableNote.trim() || undefined,
        insuranceDeduction: typeof insuranceDeduction === 'number' ? insuranceDeduction : 0,
      });
      notifySuccess(`Đã tính lương kỳ ${slip.periodKey}: thực lĩnh ${vnd(slip.netIncome)}`);
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Lỗi tính lương';
      notifyError(e, 'Tính lương thất bại');
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder mt="sm">
      <Title order={6} mb="sm">Tính lương mới</Title>
      {err && <Alert color="red" mb="sm">{err}</Alert>}
      <Stack gap="sm">
        <Group grow align="flex-end">
          <TextInput
            label="Kỳ (YYYY-MM)"
            placeholder="2026-06"
            value={periodKey}
            onChange={(e) => setPeriodKey(e.currentTarget.value)}
          />
          <NumberInput
            label="Ngày chuẩn"
            min={1}
            value={standardDays}
            onChange={setStandardDays}
          />
          <NumberInput
            label="Ngày làm thực tế"
            min={0}
            value={workdays}
            onChange={setWorkdays}
          />
        </Group>
        <Group grow align="flex-end">
          <NumberInput
            label="Điểm KPI (0–100, để trống = tự động)"
            min={0}
            max={100}
            step={1}
            value={kpiScore}
            onChange={setKpiScore}
            placeholder="Tự động"
          />
          <NumberInput
            label="Thu nhập biến đổi (VNĐ)"
            min={0}
            step={100000}
            value={variablePay}
            onChange={setVariablePay}
          />
        </Group>
        <Group grow align="flex-end">
          <TextInput
            label="Ghi chú thu nhập biến đổi"
            placeholder="Hoa hồng, phụ cấp..."
            value={variableNote}
            onChange={(e) => setVariableNote(e.currentTarget.value)}
          />
          <NumberInput
            label="Khấu trừ bảo hiểm (VNĐ)"
            min={0}
            step={100000}
            value={insuranceDeduction}
            onChange={setInsuranceDeduction}
          />
        </Group>
        <Group>
          <Button onClick={() => void compute()} loading={busy}>
            Tính lương
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

// ─── Staff Detail Drawer ──────────────────────────────────────────────────────

function StaffDetailDrawer({
  staffId,
  staffName,
  facilityId,
  onClose,
}: {
  staffId: string | null;
  staffName: string;
  facilityId: number;
  onClose: () => void;
}) {
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null); // holds payslip id being actioned
  const [bulkBusy, setBulkBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showCompute, setShowCompute] = useState(false);

  const loadPayslips = useCallback((id: string) => {
    setLoading(true);
    setLoadError('');
    setMsg(null);
    payrollApi.listByStaff
      .query({ staffId: id })
      .then((rows) => {
        setPayslips(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : 'Lỗi tải phiếu lương');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (staffId) {
      setSelected([]);
      setPayslips([]);
      setShowCompute(false);
      loadPayslips(staffId);
    }
  }, [staffId, loadPayslips]);

  async function handleBulkPay() {
    if (selected.length === 0 || !staffId) return;
    setBulkBusy(true);
    setMsg(null);
    try {
      const r = await payrollApi.payslipBulkPay.mutate(selected);
      const failNote = r.failed.length > 0 ? ` (${r.failed.length} phiếu bị bỏ qua)` : '';
      setMsg({ kind: 'ok', text: `Đã thanh toán ${r.succeeded.length} phiếu${failNote}` });
      setSelected([]);
      loadPayslips(staffId);
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Lỗi thanh toán' });
    } finally {
      setBulkBusy(false);
    }
  }

  async function action(
    fn: () => Promise<PayslipRow>,
    slipId: string,
    successMsg: string,
  ) {
    setActionBusy(slipId);
    try {
      await fn();
      notifySuccess(successMsg);
      if (staffId) loadPayslips(staffId);
    } catch (e) {
      notifyError(e, 'Thao tác thất bại');
    } finally {
      setActionBusy(null);
    }
  }

  function toggleSelect(id: string, checked: boolean) {
    if (checked) setSelected((s) => [...s, id]);
    else setSelected((s) => s.filter((x) => x !== id));
  }

  const finalizedCount = payslips.filter((p) => p.status === 'finalized').length;

  return (
    <Drawer
      opened={!!staffId}
      onClose={onClose}
      position="right"
      size="xl"
      title={<Text fw={600}>{staffName} — Phiếu lương</Text>}
      padding="xl"
    >
      {staffId && (
        <Stack gap="md">
          {msg && (
            <Alert
              color={msg.kind === 'ok' ? 'green' : 'red'}
              withCloseButton
              onClose={() => setMsg(null)}
            >
              {msg.text}
            </Alert>
          )}

          <Group justify="space-between">
            <Button
              size="xs"
              variant="light"
              onClick={() => setShowCompute((v) => !v)}
            >
              {showCompute ? 'Ẩn form tính lương' : '+ Tính lương mới'}
            </Button>
            {finalizedCount > 0 && (
              <Button
                size="sm"
                variant="filled"
                radius={9999}
                disabled={selected.length === 0}
                loading={bulkBusy}
                onClick={() => void handleBulkPay()}
              >
                Thanh toán ({selected.length} phiếu)
              </Button>
            )}
          </Group>

          {showCompute && (
            <ComputeForm
              staffId={staffId}
              facilityId={facilityId}
              onDone={() => {
                setShowCompute(false);
                loadPayslips(staffId);
              }}
            />
          )}

          {loadError && (
            <Alert color="red" title="Lỗi tải phiếu lương">
              {loadError}
              <Button size="xs" variant="subtle" mt="xs" onClick={() => loadPayslips(staffId)}>
                Thử lại
              </Button>
            </Alert>
          )}

          {loading && <Text c="dimmed" ta="center">Đang tải...</Text>}

          {!loading && !loadError && payslips.length === 0 && (
            <Text c="dimmed" ta="center" py="xl">Chưa có phiếu lương</Text>
          )}

          {!loading && payslips.length > 0 && (
            <Table striped fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={TH_STYLE} />
                  <Table.Th style={TH_STYLE}>Kỳ</Table.Th>
                  <Table.Th style={TH_STYLE}>Thực lĩnh</Table.Th>
                  <Table.Th style={TH_STYLE}>KPI</Table.Th>
                  <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
                  <Table.Th style={TH_STYLE}>Thao tác</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {payslips.map((p) => {
                  const st = STATUS_LABEL[p.status] ?? { label: p.status, color: 'gray' };
                  const isBusy = actionBusy === p.id;
                  return (
                    <Table.Tr key={p.id}>
                      <Table.Td>
                        {p.status === 'finalized' && (
                          <Checkbox
                            checked={selected.includes(p.id)}
                            onChange={(e) => toggleSelect(p.id, e.currentTarget.checked)}
                            aria-label={`Chọn kỳ ${p.periodKey}`}
                          />
                        )}
                      </Table.Td>
                      <Table.Td>{p.periodKey}</Table.Td>
                      <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {vnd(p.netIncome)}
                      </Table.Td>
                      <Table.Td>
                        {p.kpiGrade ? (
                          <Badge size="xs" variant="dot" color="blue">{p.kpiGrade}</Badge>
                        ) : '—'}
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" radius="xl" color={st.color}>
                          {st.label}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {/* draft → finalized */}
                          {p.status === 'draft' && (
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="blue"
                              loading={isBusy}
                              onClick={() =>
                                action(
                                  () => payrollApi.payslipFinalize.mutate({ id: p.id }),
                                  p.id,
                                  `Đã chốt phiếu kỳ ${p.periodKey}`,
                                )
                              }
                            >
                              Chốt
                            </Button>
                          )}
                          {/* finalized → paid */}
                          {p.status === 'finalized' && (
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="green"
                              loading={isBusy}
                              onClick={() =>
                                action(
                                  () => payrollApi.payslipMarkPaid.mutate({ id: p.id }),
                                  p.id,
                                  `Đã trả lương kỳ ${p.periodKey}`,
                                )
                              }
                            >
                              Trả lương
                            </Button>
                          )}
                          {/* finalized → draft (reopen) */}
                          {p.status === 'finalized' && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              color="orange"
                              loading={isBusy}
                              onClick={() =>
                                action(
                                  () => payrollApi.payslipReopen.mutate({ id: p.id }),
                                  p.id,
                                  `Đã mở lại phiếu kỳ ${p.periodKey}`,
                                )
                              }
                            >
                              Mở lại
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
        </Stack>
      )}
    </Drawer>
  );
}

// ─── Staff Table ──────────────────────────────────────────────────────────────

function StaffTable({
  facilityId,
  onSelect,
}: {
  facilityId: number;
  onSelect: (userId: string, displayName: string) => void;
}) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    payrollApi.roster
      .query({ facilityId })
      .then((rows) => {
        setRoster(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Lỗi tải danh sách nhân sự');
        setLoading(false);
      });
  }, [facilityId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Text c="dimmed">Đang tải danh sách nhân sự...</Text>;
  if (error) {
    return (
      <Alert color="red" title="Lỗi tải nhân sự">
        {error}
        <Button size="xs" variant="subtle" mt="xs" onClick={load}>Thử lại</Button>
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Text fw={600} size="lg">Nhân sự ({roster.length})</Text>
      {roster.length === 0 ? (
        <Text c="dimmed" size="sm">Chưa có nhân sự tại cơ sở này.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={TH_STYLE}>Tên</Table.Th>
              <Table.Th style={TH_STYLE}>Vai trò chính</Table.Th>
              <Table.Th style={TH_STYLE}>Thao tác</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {roster.map((u) => (
              <Table.Tr
                key={u.id}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(u.id, u.displayName)}
              >
                <Table.Td>{u.displayName}</Table.Td>
                <Table.Td>
                  {u.primaryRole && (
                    <Badge size="xs" variant="light" radius="xl">{u.primaryRole}</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={(e) => { e.stopPropagation(); onSelect(u.id, u.displayName); }}
                  >
                    Xem lương
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function PayrollPanel({ facilityId }: { facilityId?: number }) {
  const { me } = useSession();
  const [selectedStaff, setSelectedStaff] = useState<{ id: string; name: string } | null>(null);

  if (!me.isSuperAdmin && !me.roles.includes('hr') && !me.roles.includes('ke_toan')) {
    return <Text c="dimmed">Chỉ HR và Kế toán mới được truy cập mục này.</Text>;
  }

  const activeFacilityId = facilityId ?? me.facilityIds[0];
  if (!activeFacilityId) {
    return <Text c="dimmed">Chọn cơ sở để xem nhân sự.</Text>;
  }

  return (
    <Stack gap="xl">
      <PeriodSummaryCard facilityId={activeFacilityId} />
      <StaffTable
        facilityId={activeFacilityId}
        onSelect={(id, name) => setSelectedStaff({ id, name })}
      />
      <StaffDetailDrawer
        staffId={selectedStaff?.id ?? null}
        staffName={selectedStaff?.name ?? ''}
        facilityId={activeFacilityId}
        onClose={() => setSelectedStaff(null)}
      />
    </Stack>
  );
}
