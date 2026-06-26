import React, { useState, useEffect, useCallback } from 'react';
import { trpc, useSession } from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Drawer,
  Group,
  Stack,
  Table,
  Text,
} from '@mantine/core';

// Cast the payroll client surface to a local interface to avoid TS2589 (deep type instantiation)
// and to decouple the panel from the exact AppRouter shape during incremental merges.
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

const payrollApi = trpc.payroll as unknown as {
  roster: { query: (i: { facilityId: number }) => Promise<RosterEntry[]> };
  listByStaff: { query: (i: { staffId: string }) => Promise<PayslipRow[]> };
  payslipBulkPay: { mutate: (i: string[]) => Promise<BulkPayResult> };
};

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--mantine-color-gray-6)',
  fontWeight: 600,
};


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

  useEffect(() => {
    setLoading(true);
    setError('');
    payrollApi.roster
      .query({ facilityId })
      .then(setRoster)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Lỗi tải danh sách nhân sự'),
      )
      .finally(() => setLoading(false));
  }, [facilityId]);

  if (loading) return <Text c="dimmed">Đang tải danh sách nhân sự...</Text>;
  if (error) return <Alert color="red">{error}</Alert>;

  return (
    <Stack gap="md">
      <Text fw={600} size="lg">
        Nhân sự ({roster.length})
      </Text>
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
                  <Badge size="xs" variant="light" radius="xl">
                    {u.primaryRole}
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(u.id, u.displayName);
                  }}
                >
                  Xem lương
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {roster.length === 0 && (
        <Text c="dimmed" size="sm">
          Chưa có nhân sự tại cơ sở này.
        </Text>
      )}
    </Stack>
  );
}

function StaffDetailDrawer({
  staffId,
  staffName,
  onClose,
}: {
  staffId: string | null;
  staffName: string;
  onClose: () => void;
}) {
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadPayslips = useCallback(
    (id: string) => {
      setLoading(true);
      setMsg(null);
      payrollApi.listByStaff
        .query({ staffId: id })
        .then(setPayslips)
        .catch((e: unknown) =>
          setMsg({
            kind: 'err',
            text: e instanceof Error ? e.message : 'Lỗi tải phiếu lương',
          }),
        )
        .finally(() => setLoading(false));
    },
    [],
  );

  useEffect(() => {
    if (staffId) {
      setSelected([]);
      setPayslips([]);
      loadPayslips(staffId);
    } else {
      setPayslips([]);
      setSelected([]);
      setMsg(null);
    }
  }, [staffId, loadPayslips]);

  async function handleBulkPay() {
    if (selected.length === 0 || !staffId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await payrollApi.payslipBulkPay.mutate(selected);
      const failNote =
        r.failed.length > 0 ? ` (${r.failed.length} phiếu không hợp lệ bị bỏ qua)` : '';
      setMsg({
        kind: 'ok',
        text: `Đã thanh toán ${r.succeeded.length} phiếu${failNote}`,
      });
      setSelected([]);
      loadPayslips(staffId);
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Lỗi thanh toán' });
    } finally {
      setBusy(false);
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
      size="lg"
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

          {finalizedCount > 0 && (
            <Group justify="flex-end">
              <Button
                size="sm"
                variant="filled"
                radius={9999}
                disabled={selected.length === 0}
                loading={busy}
                onClick={() => void handleBulkPay()}
              >
                Thanh toán ({selected.length} phiếu)
              </Button>
            </Group>
          )}

          {loading ? (
            <Text c="dimmed" ta="center">
              Đang tải...
            </Text>
          ) : payslips.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">
              Chưa có phiếu lương
            </Text>
          ) : (
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={TH_STYLE} />
                  <Table.Th style={TH_STYLE}>Kỳ</Table.Th>
                  <Table.Th style={TH_STYLE}>Thực lĩnh</Table.Th>
                  <Table.Th style={TH_STYLE}>KPI</Table.Th>
                  <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {payslips.map((p) => (
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
                      {(p.netIncome ?? 0).toLocaleString('vi-VN')}đ
                    </Table.Td>
                    <Table.Td>
                      {p.kpiGrade ? (
                        <Badge size="xs" variant="dot" color="blue">
                          {p.kpiGrade}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="sm"
                        variant="light"
                        radius="xl"
                        color={
                          p.status === 'paid'
                            ? 'green'
                            : p.status === 'finalized'
                              ? 'blue'
                              : 'gray'
                        }
                      >
                        {p.status}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

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
      <StaffTable
        facilityId={activeFacilityId}
        onSelect={(id, name) => setSelectedStaff({ id, name })}
      />
      <StaffDetailDrawer
        staffId={selectedStaff?.id ?? null}
        staffName={selectedStaff?.name ?? ''}
        onClose={() => setSelectedStaff(null)}
      />
    </Stack>
  );
}
