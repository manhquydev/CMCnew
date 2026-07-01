import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, useSession, notifyError, notifySuccess } from '@cmc/ui';
import { Badge, Button, Card, Group, Stack, Table, Text } from '@mantine/core';
import { IconClock, IconWifi, IconWifiOff } from '@tabler/icons-react';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)', fontWeight: 600,
};

type TodayStatus = Awaited<ReturnType<typeof trpc.checkInOut.todayStatus.query>>;
type PendingManualPunch = Awaited<ReturnType<typeof trpc.checkInOut.pendingManual.query>>[number];
type Punch = { id: string; time: string | Date; method: string };

export function CheckInPanel() {
  const { me } = useSession();
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [ipCheck, setIpCheck] = useState<{ allowed: boolean; ip: string }>({ allowed: false, ip: '...' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [pendingManual, setPendingManual] = useState<PendingManualPunch[]>([]);
  const [clock, setClock] = useState(dayjs().format('HH:mm:ss'));

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setClock(dayjs().format('HH:mm:ss')), 1000);
    return () => clearInterval(timer);
  }, []);

  const fid = me.facilityIds[0];
  // Mirrors checkInOut.punch/todayStatus's permission list — a manager-only role
  // is never in it, so checkIP/todayStatus always 403 for them.
  const canPunch = me.isSuperAdmin || me.roles.some((r) =>
    ['giao_vien', 'sale', 'cskh'].includes(r),
  );
  const canApproveManual = me.isSuperAdmin || me.roles.some((r) =>
    ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'].includes(r),
  );
  const loadStatus = useCallback(() => {
    if (!fid) return;
    setLoading(true);
    // Independent settle — a manager-only account 403ing on checkIP/todayStatus must
    // not also blank out their (unrelated) pending-approval list.
    Promise.allSettled([
      canPunch ? trpc.checkInOut.checkIP.query({ facilityId: fid }) : Promise.resolve(null),
      canPunch ? trpc.checkInOut.todayStatus.query() : Promise.resolve(null),
      canApproveManual ? trpc.checkInOut.pendingManual.query({ facilityId: fid }) : Promise.resolve([]),
    ])
      .then(([ip, s, pending]) => {
        if (ip.status === 'fulfilled' && ip.value) setIpCheck(ip.value);
        if (s.status === 'fulfilled') setStatus(s.value);
        if (pending.status === 'fulfilled') setPendingManual(pending.value);
        else notifyError(pending.reason, 'Không tải được danh sách chờ duyệt');
      })
      .finally(() => setLoading(false));
  }, [canApproveManual, canPunch, fid]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function punch() {
    setBusy(true);
    try {
      await trpc.checkInOut.punch.mutate();
      notifySuccess('Chấm công thành công!');
      loadStatus();
    } catch (e) {
      notifyError(e, 'Chấm công thất bại');
    } finally { setBusy(false); }
  }

  async function approveManual(punchId: string) {
    setApprovingId(punchId);
    try {
      await trpc.checkInOut.approveManual.mutate({ punchId });
      notifySuccess('Đã duyệt chấm công thủ công');
      loadStatus();
    } catch (e) {
      notifyError(e, 'Duyệt chấm công thất bại');
    } finally {
      setApprovingId(null);
    }
  }

  const today = dayjs().format('DD/MM/YYYY (dddd)');
  const isCheckedIn = status?.status === 'checked_in' || status?.status === 'completed';
  const isCompleted = status?.status === 'completed';

  return (
    <Stack maw={520}>
      {/* Header */}
      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)', textAlign: 'center' }}>
        <Text size="xl" fw={700} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-text)' }}>
          {clock}
        </Text>
        <Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>{today}</Text>
      </Card>

      {/* Status Card — hidden for manager-only roles: they can't punch (checkInOut.punch
          has no manager role in its allow-list), so this card would just show a
          CHECK-IN button that always 403s. */}
      {canPunch && (
      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        {/* IP Status */}
        <Group mb="md" gap="xs">
          {ipCheck.allowed ? (
            <IconWifi size={16} color="var(--cmc-ok)" />
          ) : (
            <IconWifiOff size={16} color="var(--cmc-warn)" />
          )}
          <Text size="sm" style={{ color: ipCheck.allowed ? 'var(--cmc-ok)' : 'var(--cmc-warn)' }}>
            {ipCheck.allowed ? `WiFi công ty (${ipCheck.ip})` : `Ngoài mạng công ty (${ipCheck.ip}) — cần manager duyệt`}
          </Text>
        </Group>

        {/* Check-in/out status */}
        {!loading && (
          <>
            {!isCheckedIn && (
              <Group justify="center" mb="md">
                <Badge color="gray" variant="light" radius="xl" size="lg">Chưa check-in</Badge>
              </Group>
            )}
            {isCheckedIn && !isCompleted && (
              <Group justify="center" mb="md">
                <Badge color="blue" variant="light" radius="xl" size="lg">
                  Đã check-in {status?.checkIn ? dayjs(status.checkIn.time).format('HH:mm') : ''}
                </Badge>
              </Group>
            )}
            {isCompleted && (
              <Group justify="center" mb="md">
                <Badge color="green" variant="light" radius="xl" size="lg">
                  Hoàn thành — {status?.checkIn ? dayjs(status.checkIn.time).format('HH:mm') : ''} → {status?.checkOut ? dayjs(status.checkOut.time).format('HH:mm') : ''}
                </Badge>
              </Group>
            )}

            {/* Shift info */}
            {(status as any)?.shift && (
              <Group justify="center" mb="md">
                <Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>
                  Ca hôm nay: {(status as any).shift.name} ({(status as any).shift.startTime}–{(status as any).shift.endTime})
                </Text>
              </Group>
            )}

            {/* Penalty info */}
            {(status as any)?.penalty && (status as any).penalty.amount > 0 && (
              <Group justify="center" mb="md">
                <Badge color="red" variant="light" radius="xl">
                  {(status as any).penalty.lateMinutes > 0 && `Đi muộn ${(status as any).penalty.lateMinutes}p`}
                  {(status as any).penalty.lateMinutes > 0 && (status as any).penalty.earlyMinutes > 0 && ' — '}
                  {(status as any).penalty.earlyMinutes > 0 && `Về sớm ${(status as any).penalty.earlyMinutes}p`}
                  {' — '}{(status as any).penalty.amount.toLocaleString('vi-VN')}đ
                </Badge>
              </Group>
            )}

            {/* Action button */}
            <Group justify="center">
              {!isCompleted && (
                <Button
                  size="lg" radius={9999}
                  color={isCheckedIn ? 'red' : 'green'}
                  loading={busy}
                  onClick={punch}
                  leftSection={<IconClock size={20} />}
                >
                  {isCheckedIn ? 'CHECK-OUT' : 'CHECK-IN'}
                </Button>
              )}
              {isCompleted && (
                <Text size="sm" c="dimmed">Hôm nay đã hoàn thành ✅</Text>
              )}
            </Group>
          </>
        )}
      </Card>
      )}

      {/* Today's punches */}
      {canPunch && status?.punches && status.punches.length > 0 && (
        <Card radius="lg" p="md" style={{ border: '1px solid var(--cmc-border)' }}>
          <Text fw={600} size="sm" mb="xs" style={{ color: 'var(--cmc-text)' }}>Lịch sử hôm nay</Text>
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Thời gian</Table.Th>
                <Table.Th style={TH_STYLE}>Loại</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {status.punches.map((p: Punch, i: number) => (
                <Table.Tr key={p.id}>
                  <Table.Td>{dayjs(p.time).format('HH:mm:ss')}</Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={i === 0 ? 'blue' : i === status.punches.length - 1 ? 'red' : 'gray'} variant="light" radius="xl">
                      {i === 0 ? 'CHECK-IN' : i === status.punches.length - 1 ? 'CHECK-OUT' : `Lần ${i + 1}`}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {canApproveManual && pendingManual.length > 0 && (
        <Card radius="lg" p="md" style={{ border: '1px solid var(--cmc-border)' }}>
          <Text fw={600} size="sm" mb="xs" style={{ color: 'var(--cmc-text)' }}>Chờ duyệt ngoài WiFi</Text>
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Thời gian</Table.Th>
                <Table.Th style={TH_STYLE}>IP</Table.Th>
                <Table.Th style={TH_STYLE}>Ca</Table.Th>
                <Table.Th style={TH_STYLE}>Thao tác</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pendingManual.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>{dayjs(p.timestamp).format('DD/MM HH:mm')}</Table.Td>
                  <Table.Td style={{ fontFamily: 'monospace' }}>{p.ipAddress}</Table.Td>
                  <Table.Td>{p.shiftTemplate ? `${p.shiftTemplate.name} (${p.shiftTemplate.startTime}-${p.shiftTemplate.endTime})` : 'Chưa map ca'}</Table.Td>
                  <Table.Td>
                    <Button size="xs" variant="light" loading={approvingId === p.id} onClick={() => approveManual(p.id)}>
                      Duyệt
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}
