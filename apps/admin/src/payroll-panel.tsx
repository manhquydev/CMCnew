import { useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
const pct = (r: number) => (r * 100).toFixed(1) + '%';
const todayMonth = () => new Date().toISOString().slice(0, 7);

type RosterEntry = { id: string; displayName: string; primaryRole: string };
type Rate = { id: string; effectiveFrom: string | Date; baseSalary: number; mealAllowance: number; otherAllowance: number; kpiMax: number; monthlyQuota: number };

type CommissionResult = {
  quota: number; newRevenue: number; renewalRevenue: number;
  attainment: number; rateNew: number; rateRenew: number;
  commissionNew: number; commissionRenewal: number;
  total: number; budgetCap: number; overBudget: boolean;
};

// Avoid TS2589 deep instantiation on payroll endpoints by loosening at call sites.
const payrollApi = trpc.payroll as unknown as {
  roster: { query: (i: { facilityId: number }) => Promise<RosterEntry[]> };
  profileUpsert: { mutate: (i: { userId: string; facilityId: number; position: string; grade?: string; dependents: number; startedAt?: string }) => Promise<unknown> };
  rateCreate: { mutate: (i: { userId: string; facilityId: number; baseSalary: number; mealAllowance: number; otherAllowance: number; kpiMax: number; monthlyQuota: number; effectiveFrom: string }) => Promise<unknown> };
  rateList: { query: (i: { userId: string }) => Promise<Rate[]> };
  commissionForSale: { query: (i: { userId: string; facilityId: number; periodKey: string; centreRetentionRatio?: number }) => Promise<CommissionResult> };
};

function SalaryRateCard({ userId, facilityId }: { userId: string; facilityId: number }) {
  const [rates, setRates] = useState<Rate[]>([]);
  const [form, setForm] = useState({ baseSalary: 0, mealAllowance: 0, otherAllowance: 0, kpiMax: 0, monthlyQuota: 0, effectiveFrom: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);

  const load = () =>
    payrollApi.rateList
      .query({ userId })
      .then(setRates)
      .catch((e) => notifyError(e, 'Không tải được lịch sử mức lương'));
  useEffect(() => { load(); }, [userId]);

  async function create() {
    setBusy(true);
    try {
      await payrollApi.rateCreate.mutate({ userId, facilityId, ...form });
      notifySuccess(`Đã thêm mức lương hiệu lực từ ${form.effectiveFrom}.`);
      load();
    } catch (e) {
      notifyError(e, 'Thêm mức lương thất bại');
    } finally { setBusy(false); }
  }

  const num = (field: keyof typeof form) => (v: string | number) =>
    setForm((f) => ({ ...f, [field]: Number(v) || 0 }));

  return (
    <Card withBorder>
      <Title order={6} mb="xs">Mức lương (effective-dated)</Title>
      <Stack gap="xs">
        <Group grow align="flex-end">
          <NumberInput label="Lương cơ bản (đ)" value={form.baseSalary} onChange={num('baseSalary')} thousandSeparator="." />
          <NumberInput label="PC ăn trưa (đ)" value={form.mealAllowance} onChange={num('mealAllowance')} thousandSeparator="." />
          <NumberInput label="PC khác (đ)" value={form.otherAllowance} onChange={num('otherAllowance')} thousandSeparator="." />
        </Group>
        <Group grow align="flex-end">
          <NumberInput label="KPI max (đ)" value={form.kpiMax} onChange={num('kpiMax')} thousandSeparator="." />
          <NumberInput label="Quota tháng (đ)" value={form.monthlyQuota} onChange={num('monthlyQuota')} thousandSeparator="." description="Ngưỡng doanh thu tính hoa hồng sale" />
          <TextInput label="Hiệu lực từ" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.currentTarget.value }))} placeholder="YYYY-MM-DD" />
        </Group>
        <Group justify="flex-end"><Button size="xs" onClick={create} loading={busy}>Thêm mức lương</Button></Group>
      </Stack>
      {rates.length > 0 && (
        <>
          <Divider my="sm" />
          <Table fz="xs">
            <Table.Thead>
              <Table.Tr><Table.Th>Hiệu lực từ</Table.Th><Table.Th>LCB</Table.Th><Table.Th>PC ăn trưa</Table.Th><Table.Th>PC khác</Table.Th><Table.Th>KPI max</Table.Th><Table.Th>Quota</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rates.map((r, i) => (
                <Table.Tr key={r.id}>
                  <Table.Td><Group gap={4}>{new Date(r.effectiveFrom).toLocaleDateString('vi-VN')}{i === 0 && <Badge size="xs" color="teal">hiện tại</Badge>}</Group></Table.Td>
                  <Table.Td>{vnd(r.baseSalary)}</Table.Td>
                  <Table.Td>{vnd(r.mealAllowance)}</Table.Td>
                  <Table.Td>{vnd(r.otherAllowance)}</Table.Td>
                  <Table.Td>{vnd(r.kpiMax)}</Table.Td>
                  <Table.Td>{vnd(r.monthlyQuota)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Card>
  );
}

function CommissionCard({ userId, facilityId, onUseAsVariable }: { userId: string; facilityId: number; onUseAsVariable: (v: number) => void }) {
  const [period, setPeriod] = useState(todayMonth());
  const [result, setResult] = useState<CommissionResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function compute() {
    setBusy(true);
    try {
      const r = await payrollApi.commissionForSale.query({ userId, facilityId, periodKey: period });
      setResult(r);
    } catch (e) {
      notifyError(e, 'Tính hoa hồng thất bại');
    } finally { setBusy(false); }
  }

  return (
    <Card withBorder>
      <Title order={6} mb="xs">Hoa hồng tự tính (CVTV)</Title>
      <Group align="flex-end" mb="sm">
        <TextInput label="Kỳ lương" value={period} onChange={(e) => setPeriod(e.currentTarget.value)} placeholder="YYYY-MM" style={{ width: 130 }} />
        <Button size="xs" onClick={compute} loading={busy}>Tính</Button>
      </Group>
      {result && (
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Quota tháng</Text>
            <Text size="sm" fw={500}>{vnd(result.quota)}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">DT mới / tái tục</Text>
            <Text size="sm">{vnd(result.newRevenue)} / {vnd(result.renewalRevenue)}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Đạt quota</Text>
            <Text size="sm" fw={500}>{pct(result.attainment)} → rate {pct(result.rateNew)} mới / {pct(result.rateRenew)} tái tục</Text>
          </Group>
          <Divider />
          <Group justify="space-between">
            <Text size="sm" c="dimmed">HH mới / tái tục</Text>
            <Text size="sm">{vnd(result.commissionNew)} / {vnd(result.commissionRenewal)}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" fw={600}>Tổng hoa hồng</Text>
            <Text size="sm" fw={700} c="teal">{vnd(result.total)}</Text>
          </Group>
          {result.overBudget && (
            <Alert color="orange">Vượt ngân sách ({vnd(result.budgetCap)}) — xem xét lại cùng BGĐ.</Alert>
          )}
          <Group justify="flex-end">
            <Button size="xs" variant="light" onClick={() => onUseAsVariable(result.total)}>
              Đưa vào variablePay
            </Button>
          </Group>
        </Stack>
      )}
    </Card>
  );
}

export function PayrollPanel({ facilityId }: { facilityId: number }) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [position, setPosition] = useState('');
  const [grade, setGrade] = useState('');
  const [dependents, setDependents] = useState(0);
  const [variable, setVariable] = useState(0);

  useEffect(() => {
    payrollApi.roster
      .query({ facilityId })
      .then(setRoster)
      .catch((e) => notifyError(e, 'Không tải được danh sách nhân sự'));
  }, [facilityId]);

  const rosterData = roster.map((r) => ({ value: r.id, label: `${r.displayName} (${r.primaryRole})` }));

  async function saveProfile() {
    if (!userId) return;
    try {
      await payrollApi.profileUpsert.mutate({ userId, facilityId, position, grade: grade || undefined, dependents });
      notifySuccess('Đã lưu hồ sơ nhân sự.');
    } catch (e) {
      notifyError(e, 'Lưu hồ sơ nhân sự thất bại');
    }
  }

  return (
    <Stack>
      <Alert color="blue" variant="light">
        Quản lý hồ sơ nhân sự, mức lương (có quota tháng cho sale), và tra cứu hoa hồng. HR / kế toán only.
      </Alert>
      <Select label="Nhân sự" placeholder="Chọn người" data={rosterData} value={userId} onChange={setUserId} searchable />

      {userId && (
        <>
          <Card withBorder>
            <Title order={6} mb="xs">Hồ sơ nhân sự</Title>
            <Group grow align="flex-end">
              <TextInput label="Vị trí" value={position} onChange={(e) => setPosition(e.currentTarget.value)} placeholder="vd: giao_vien, sale, quan_ly" />
              <TextInput label="Bậc" value={grade} onChange={(e) => setGrade(e.currentTarget.value)} placeholder="vd: B2, PT4" />
              <NumberInput label="Người phụ thuộc" value={dependents} onChange={(v) => setDependents(Number(v) || 0)} min={0} max={10} />
            </Group>
            <Group justify="flex-end" mt="xs"><Button size="xs" onClick={saveProfile}>Lưu hồ sơ</Button></Group>
          </Card>

          <SalaryRateCard userId={userId} facilityId={facilityId} />

          <CommissionCard
            userId={userId}
            facilityId={facilityId}
            onUseAsVariable={(v) => setVariable(v)}
          />

          {variable > 0 && (
            <Alert color="teal" variant="light">
              variablePay đã set: <b>{vnd(variable)}</b> — điền vào ô "Thu nhập biến đổi" khi tính phiếu lương.
            </Alert>
          )}
        </>
      )}
    </Stack>
  );
}
