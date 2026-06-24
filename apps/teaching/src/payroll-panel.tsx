import { useCallback, useEffect, useState } from 'react';
import { trpc } from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type RosterUser = Awaited<ReturnType<typeof trpc.payroll.roster.query>>[number];
type Payslip = Awaited<ReturnType<typeof trpc.payroll.payslipList.query>>[number];
type PeriodSummary = Awaited<ReturnType<typeof trpc.payroll.payslipPeriodSummary.query>>;

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
const ST: Record<string, { label: string; color: string }> = {
  draft: { label: 'Nháp', color: 'gray' },
  finalized: { label: 'Đã chốt', color: 'blue' },
  paid: { label: 'Đã trả', color: 'teal' },
};

export function PayrollPanel() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  // rate form
  const [base, setBase] = useState<number | string>(5700000);
  const [meal, setMeal] = useState<number | string>(500000);
  const [other, setOther] = useState<number | string>(2800000);
  const [kpiMax, setKpiMax] = useState<number | string>(1000000);
  const [quota, setQuota] = useState<number | string>(0);
  const [effFrom, setEffFrom] = useState('2026-01-01');
  // commission preview
  const [commission, setCommission] = useState<Awaited<ReturnType<typeof trpc.payroll.commissionForSale.query>> | null>(null);
  // compute form
  const [period, setPeriod] = useState('2026-06');
  const [stdDays, setStdDays] = useState<number | string>(26);
  const [workdays, setWorkdays] = useState<number | string>(26);
  const [kpiScore, setKpiScore] = useState<number | string>(90);
  const [variablePay, setVariablePay] = useState<number | string>(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    trpc.facility.list.query().then((fs) => {
      setFacilities(fs);
      setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
    });
  }, []);

  const userName = useCallback((id: string) => roster.find((u) => u.id === id)?.displayName ?? id.slice(0, 8), [roster]);

  const loadSummary = useCallback(() => {
    if (!facilityId || !/^\d{4}-\d{2}$/.test(period)) return setSummary(null);
    trpc.payroll.payslipPeriodSummary.query({ facilityId, periodKey: period }).then(setSummary).catch(() => setSummary(null));
  }, [facilityId, period]);

  const load = useCallback(() => {
    if (!facilityId) return;
    trpc.payroll.roster.query({ facilityId }).then(setRoster).catch(() => setRoster([]));
    trpc.payroll.payslipList.query({ facilityId }).then(setSlips).catch(() => setSlips([]));
    loadSummary();
  }, [facilityId, loadSummary]);
  useEffect(load, [load]);

  const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);

  async function saveRate() {
    if (!facilityId || !userId) return setMsg({ kind: 'err', text: 'Chọn cơ sở và nhân sự.' });
    setBusy(true); setMsg(null);
    try {
      await trpc.payroll.rateCreate.mutate({
        userId, facilityId, baseSalary: num(base), mealAllowance: num(meal),
        otherAllowance: num(other), kpiMax: num(kpiMax), monthlyQuota: num(quota), effectiveFrom: effFrom,
      });
      setMsg({ kind: 'ok', text: 'Đã lưu mức lương.' });
    } catch (e) { setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') }); }
    finally { setBusy(false); }
  }

  async function previewCommission() {
    if (!facilityId || !userId) return setMsg({ kind: 'err', text: 'Chọn cơ sở và nhân sự.' });
    setMsg(null); setCommission(null);
    try {
      const c = await trpc.payroll.commissionForSale.query({ userId, facilityId, periodKey: period });
      setCommission(c);
    } catch (e) { setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') }); }
  }

  async function compute() {
    if (!facilityId || !userId) return setMsg({ kind: 'err', text: 'Chọn cơ sở và nhân sự.' });
    setBusy(true); setMsg(null);
    try {
      const r = await trpc.payroll.payslipCompute.mutate({
        userId, facilityId, periodKey: period, standardDays: num(stdDays),
        workdays: num(workdays), kpiScore: num(kpiScore), variablePay: num(variablePay),
      });
      setMsg({ kind: 'ok', text: `Kỳ ${period}: gộp ${vnd(r.grossIncome)} · KPI ${r.kpiGrade} · thuế ${vnd(r.pitAmount)} · thực lĩnh ${vnd(r.netIncome)}.` });
      load();
    } catch (e) { setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') }); }
    finally { setBusy(false); }
  }

  async function act(fn: () => Promise<unknown>) {
    setMsg(null);
    try { await fn(); load(); } catch (e) { setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') }); }
  }

  return (
    <Stack>
      <Group grow>
        <Select label="Cơ sở" data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
          value={facilityId ? String(facilityId) : null} onChange={(v) => setFacilityId(v ? Number(v) : null)} allowDeselect={false} />
        <Select label="Nhân sự" searchable placeholder={roster.length ? 'Chọn nhân sự' : 'Chưa có'}
          data={roster.map((u) => ({ value: u.id, label: `${u.displayName} (${u.primaryRole})` }))} value={userId} onChange={setUserId} />
      </Group>

      {msg && <Alert color={msg.kind === 'ok' ? 'green' : 'red'} withCloseButton onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <Card withBorder>
        <Title order={6} mb="sm">Mức lương (hiệu lực từ)</Title>
        <Group grow>
          <NumberInput label="Lương cơ bản" value={base} onChange={setBase} thousandSeparator="," />
          <NumberInput label="PC ăn trưa" value={meal} onChange={setMeal} thousandSeparator="," />
          <NumberInput label="PC khác/định mức" value={other} onChange={setOther} thousandSeparator="," />
        </Group>
        <Group grow mt="sm" align="flex-end">
          <NumberInput label="KPI tối đa" value={kpiMax} onChange={setKpiMax} thousandSeparator="," />
          <NumberInput label="Chỉ tiêu DS tháng (quota)" value={quota} onChange={setQuota} thousandSeparator="," />
          <TextInput label="Hiệu lực từ" value={effFrom} onChange={(e) => setEffFrom(e.currentTarget.value)} placeholder="YYYY-MM-DD" />
          <Button onClick={saveRate} loading={busy}>Lưu mức lương</Button>
        </Group>
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={6}>Hoa hồng tự tính (kỳ {period})</Title>
          <Button size="compact-sm" variant="light" onClick={previewCommission}>Tính hoa hồng từ phiếu thu</Button>
        </Group>
        {commission ? (
          <Stack gap={4}>
            <Group gap="xl">
              <Text size="sm">DT khách mới: <b>{vnd(commission.newRevenue)}</b> / quota {vnd(commission.quota)} → đạt <b>{Math.round(commission.attainment * 100)}%</b> → tỷ lệ <b>{(commission.rateNew * 100).toFixed(1)}%</b></Text>
              <Text size="sm">DT tái tục: <b>{vnd(commission.renewalRevenue)}</b> → tỷ lệ <b>{(commission.rateRenew * 100).toFixed(1)}%</b></Text>
            </Group>
            <Group gap="xl" align="center">
              <Text size="sm">HH khách mới: <b>{vnd(commission.commissionNew)}</b></Text>
              <Text size="sm">HH tái tục: <b>{vnd(commission.commissionRenewal)}</b></Text>
              <Text size="sm">Tổng hoa hồng: <b style={{ color: 'var(--mantine-color-teal-7)' }}>{vnd(commission.total)}</b></Text>
              {commission.overBudget && <Badge color="orange">Vượt ngân sách {vnd(commission.budgetCap)}</Badge>}
              <Button size="compact-xs" onClick={() => setVariablePay(commission.total)}>Đưa vào ô biến đổi ↓</Button>
            </Group>
          </Stack>
        ) : (
          <Text c="dimmed" size="sm">Bấm "Tính hoa hồng" để gom doanh thu sale đã gán trong kỳ và tính theo chính sách hiệu lực.</Text>
        )}
      </Card>

      <Card withBorder>
        <Title order={6} mb="sm">Tính lương theo kỳ</Title>
        <Group grow>
          <TextInput label="Kỳ (YYYY-MM)" value={period} onChange={(e) => setPeriod(e.currentTarget.value)} />
          <NumberInput label="Ngày công chuẩn" value={stdDays} onChange={setStdDays} />
          <NumberInput label="Ngày công thực" value={workdays} onChange={setWorkdays} />
        </Group>
        <Group grow mt="sm" align="flex-end">
          <NumberInput label="Điểm KPI (0–100)" value={kpiScore} onChange={setKpiScore} min={0} max={100} />
          <NumberInput label="Hoa hồng/vượt giờ" value={variablePay} onChange={setVariablePay} thousandSeparator="," />
          <Button onClick={compute} loading={busy}>Tính (nháp)</Button>
        </Group>
      </Card>

      {summary && summary.count > 0 && (
        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={6}>Bảng lương kỳ {summary.periodKey}</Title>
            <Button size="compact-sm" color="teal" disabled={summary.finalizedCount === 0} loading={busy}
              onClick={() => act(async () => {
                setBusy(true);
                try {
                  const r = await trpc.payroll.payslipBulkMarkPaid.mutate({ facilityId: facilityId!, periodKey: period });
                  setMsg({ kind: 'ok', text: `Đã trả ${r.paidCount} phiếu kỳ ${period}.` });
                } finally { setBusy(false); }
              })}>
              Trả hàng loạt ({summary.finalizedCount})
            </Button>
          </Group>
          <Group gap="xl">
            <Text size="sm">Số phiếu: <b>{summary.count}</b> ({summary.draftCount} nháp · {summary.finalizedCount} chốt · {summary.paidCount} đã trả)</Text>
            <Text size="sm">Tổng gộp: <b>{vnd(summary.totalGross)}</b></Text>
            <Text size="sm">Tổng thuế TNCN: <b>{vnd(summary.totalPit)}</b></Text>
            <Text size="sm">Tổng thực lĩnh: <b>{vnd(summary.totalNet)}</b></Text>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <Title order={6} mb="sm">Phiếu lương</Title>
        {slips.length === 0 ? (
          <Text c="dimmed" size="sm">Chưa có phiếu lương.</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nhân sự</Table.Th><Table.Th>Kỳ</Table.Th><Table.Th>Gộp</Table.Th>
                <Table.Th>Thuế</Table.Th><Table.Th>Thực lĩnh</Table.Th><Table.Th>Trạng thái</Table.Th><Table.Th /></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {slips.map((s) => {
                const st = ST[s.status] ?? { label: s.status, color: 'gray' };
                return (
                  <Table.Tr key={s.id}>
                    <Table.Td>{userName(s.userId)}</Table.Td>
                    <Table.Td>{s.periodKey}</Table.Td>
                    <Table.Td>{vnd(s.grossIncome)}</Table.Td>
                    <Table.Td>{vnd(s.pitAmount)}</Table.Td>
                    <Table.Td>{vnd(s.netIncome)}</Table.Td>
                    <Table.Td><Badge color={st.color}>{st.label}</Badge></Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end">
                        {s.status === 'draft' && <Button size="compact-xs" onClick={() => act(() => trpc.payroll.payslipFinalize.mutate({ id: s.id }))}>Chốt</Button>}
                        {s.status === 'finalized' && <Button size="compact-xs" color="teal" onClick={() => act(() => trpc.payroll.payslipMarkPaid.mutate({ id: s.id }))}>Đã trả</Button>}
                        {s.status === 'finalized' && <Button size="compact-xs" variant="light" onClick={() => act(() => trpc.payroll.payslipReopen.mutate({ id: s.id }))}>Mở lại</Button>}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
