import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, useSession, notifyError, notifySuccess } from '@cmc/ui';
import { Badge, Button, Card, Group, Modal, Stack, Table, Text, Textarea } from '@mantine/core';
import { IconClock, IconWifi, IconWifiOff } from '@tabler/icons-react';
import { attendanceApi } from './shallow-trpc';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)', fontWeight: 600,
};

type TodayStatus = Awaited<ReturnType<typeof trpc.checkInOut.todayStatus.query>>;
type PendingManualTicket = Awaited<ReturnType<typeof trpc.checkInOut.pendingManual.query>>[number];
type Punch = { id: string; time: string | Date; method: string };
type HistoryPunch = Awaited<ReturnType<typeof attendanceApi.history.query>>[number];
type PunchResult = Awaited<ReturnType<typeof trpc.checkInOut.punch.mutate>>;

export function CheckInPanel() {
  const { me } = useSession();
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [ipCheck, setIpCheck] = useState<{ allowed: boolean; ip: string }>({ allowed: false, ip: '...' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [pendingManual, setPendingManual] = useState<PendingManualTicket[]>([]);
  const [history, setHistory] = useState<HistoryPunch[]>([]);
  const [clock, setClock] = useState(dayjs().format('HH:mm:ss'));
  const [reasonModal, setReasonModal] = useState<{ resubmit: boolean } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [inCooldown, setInCooldown] = useState(false);

  // Matches server PUNCH_DEBOUNCE_MS (check-in-out.ts) — hides the button for the same
  // window the server would reject a repeat punch in, rather than showing a raw error.
  const PUNCH_COOLDOWN_MS = 5_000;
  function startCooldown() {
    setInCooldown(true);
    setTimeout(() => setInCooldown(false), PUNCH_COOLDOWN_MS);
  }

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
      canPunch ? attendanceApi.history.query({
        fromDate: dayjs().subtract(13, 'day').format('YYYY-MM-DD'),
        toDate: dayjs().format('YYYY-MM-DD'),
      }) : Promise.resolve([]),
      canApproveManual ? trpc.checkInOut.pendingManual.query({ facilityId: fid }) : Promise.resolve([]),
    ])
      .then(([ip, s, historyResult, pending]) => {
        if (ip.status === 'fulfilled' && ip.value) setIpCheck(ip.value);
        if (s.status === 'fulfilled') setStatus(s.value);
        if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
        if (pending.status === 'fulfilled') setPendingManual(pending.value);
        else notifyError(pending.reason, 'Không tải được danh sách chờ duyệt');
      })
      .finally(() => setLoading(false));
  }, [canApproveManual, canPunch, fid]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  function handlePunchResult(result: PunchResult) {
    if ('requiresReason' in result) {
      // Outside WiFi, no daily ticket yet (or it was rejected) — ask for a reason instead
      // of silently failing. No punch was created server-side for this response.
      setReasonModal({ resubmit: 'resubmit' in result && result.resubmit === true });
      return;
    }
    notifySuccess('Chấm công thành công!');
    startCooldown();
    loadStatus();
  }

  async function punch() {
    setBusy(true);
    try {
      const result = await trpc.checkInOut.punch.mutate();
      handlePunchResult(result);
    } catch (e) {
      notifyError(e, 'Chấm công thất bại');
    } finally { setBusy(false); }
  }

  async function submitReason() {
    setBusy(true);
    try {
      const result = await trpc.checkInOut.punch.mutate({ reason: reasonText.trim() });
      setReasonModal(null);
      setReasonText('');
      handlePunchResult(result);
    } catch (e) {
      notifyError(e, 'Chấm công thất bại');
    } finally { setBusy(false); }
  }

  async function approveManual(ticketId: string) {
    setActingId(ticketId);
    try {
      await trpc.checkInOut.approveManual.mutate({ ticketId });
      notifySuccess('Đã duyệt chấm công thủ công');
      loadStatus();
    } catch (e) {
      notifyError(e, 'Duyệt chấm công thất bại');
    } finally {
      setActingId(null);
    }
  }

  async function rejectManual(ticketId: string) {
    setActingId(ticketId);
    try {
      await trpc.checkInOut.rejectManual.mutate({ ticketId });
      notifySuccess('Đã từ chối chấm công thủ công');
      loadStatus();
    } catch (e) {
      notifyError(e, 'Từ chối thất bại');
    } finally {
      setActingId(null);
    }
  }

  const today = dayjs().format('DD/MM/YYYY (dddd)');
  const isCheckedIn = status?.status === 'checked_in' || status?.status === 'completed';
  const isCompleted = status?.status === 'completed';
  const activeStatus = status && status.status !== 'not_punched' ? status : null;

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
            {ipCheck.allowed ? 'Đang ở mạng công ty' : 'Ngoài mạng công ty — cần quản lý duyệt chấm công'}
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
            {isCompleted && status?.manualApproval === 'rejected' && (
              <Group justify="center" mb="md">
                <Badge color="red" variant="light" radius="xl" size="lg">
                  Bị từ chối — liên hệ quản lý ({status?.checkIn ? dayjs(status.checkIn.time).format('HH:mm') : ''} → {status?.checkOut ? dayjs(status.checkOut.time).format('HH:mm') : ''})
                </Badge>
              </Group>
            )}
            {isCompleted && status?.manualApproval === 'pending' && (
              <Group justify="center" mb="md">
                <Badge color="yellow" variant="light" radius="xl" size="lg">
                  Chờ duyệt — {status?.checkIn ? dayjs(status.checkIn.time).format('HH:mm') : ''} → {status?.checkOut ? dayjs(status.checkOut.time).format('HH:mm') : ''}
                </Badge>
              </Group>
            )}
            {isCompleted && status?.manualApproval !== 'rejected' && status?.manualApproval !== 'pending' && (
              <Group justify="center" mb="md">
                <Badge color="green" variant="light" radius="xl" size="lg">
                  Hoàn thành — {status?.checkIn ? dayjs(status.checkIn.time).format('HH:mm') : ''} → {status?.checkOut ? dayjs(status.checkOut.time).format('HH:mm') : ''}
                </Badge>
              </Group>
            )}

            {/* Shift info */}
            {activeStatus?.shift && (
              <Group justify="center" mb="md">
                <Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>
                  Ca hôm nay: {activeStatus.shift.name} ({activeStatus.shift.startTime}–{activeStatus.shift.endTime})
                </Text>
              </Group>
            )}

            {/* Penalty info */}
            {activeStatus?.penalty && activeStatus.penalty.amount > 0 && (
              <Group justify="center" mb="md">
                <Badge color="red" variant="light" radius="xl">
                  {activeStatus.penalty.lateMinutes > 0 && `Đi muộn ${activeStatus.penalty.lateMinutes}p`}
                  {activeStatus.penalty.lateMinutes > 0 && activeStatus.penalty.earlyMinutes > 0 && ' — '}
                  {activeStatus.penalty.earlyMinutes > 0 && `Về sớm ${activeStatus.penalty.earlyMinutes}p`}
                  {' — '}{activeStatus.penalty.amount.toLocaleString('vi-VN')}đ
                </Badge>
              </Group>
            )}

            {/* Action button — always available (even after checkout): each new punch
                updates the check-out time to the latest tap. Hidden for 5s after each
                punch (cooldownUntil) so the debounce window on the server has a visible
                UI counterpart instead of a silent 5s error. */}
            <Group justify="center">
              {!inCooldown && (
                <Button
                  size="lg" radius={9999}
                  color={isCheckedIn ? 'red' : 'green'}
                  loading={busy}
                  onClick={punch}
                  leftSection={<IconClock size={20} />}
                >
                  {isCheckedIn ? 'CHECK-OUT / Cập nhật giờ về' : 'CHECK-IN'}
                </Button>
              )}
              {inCooldown && (
                <Text size="sm" c="dimmed">Vừa chấm công — vui lòng đợi giây lát...</Text>
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

      {canPunch && history.length > 0 && (
        <Card radius="lg" p="md" style={{ border: '1px solid var(--cmc-border)' }}>
          <Text fw={600} size="sm" mb="xs" style={{ color: 'var(--cmc-text)' }}>Lịch sử 14 ngày</Text>
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Ngày</Table.Th>
                <Table.Th style={TH_STYLE}>Giờ</Table.Th>
                <Table.Th style={TH_STYLE}>Phương thức</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {history.slice(0, 20).map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>{dayjs(p.timestamp).format('DD/MM')}</Table.Td>
                  <Table.Td>{dayjs(p.timestamp).format('HH:mm:ss')}</Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={p.method === 'ip' ? 'green' : 'orange'} variant="light" radius="xl">
                      {p.method === 'ip' ? 'WiFi' : 'Thủ công'}
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
                <Table.Th style={TH_STYLE}>Ngày</Table.Th>
                <Table.Th style={TH_STYLE}>Lý do</Table.Th>
                <Table.Th style={TH_STYLE}>Số lần bấm</Table.Th>
                <Table.Th style={TH_STYLE}>Ca</Table.Th>
                <Table.Th style={TH_STYLE}>Thao tác</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pendingManual.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>{t.dateKey}</Table.Td>
                  <Table.Td>{t.reason}</Table.Td>
                  <Table.Td>{t.punchCount}</Table.Td>
                  <Table.Td>{t.shiftTemplate ? `${t.shiftTemplate.name} (${t.shiftTemplate.startTime}-${t.shiftTemplate.endTime})` : 'Chưa map ca'}</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button size="xs" variant="light" color="green" loading={actingId === t.id} onClick={() => approveManual(t.id)}>
                        Duyệt
                      </Button>
                      <Button size="xs" variant="light" color="red" loading={actingId === t.id} onClick={() => rejectManual(t.id)}>
                        Từ chối
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <Modal
        opened={reasonModal !== null}
        onClose={() => { setReasonModal(null); setReasonText(''); }}
        title={reasonModal?.resubmit ? 'Phiếu bị từ chối — nhập lý do mới' : 'Lý do chấm công ngoài WiFi'}
        centered
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {reasonModal?.resubmit
              ? 'Phiếu chấm công ngoài WiFi của bạn đã bị quản lý từ chối. Nhập lý do mới để nộp lại.'
              : 'Bạn đang chấm công ngoài mạng công ty. Vui lòng nhập lý do — chỉ cần nhập 1 lần cho cả ngày hôm nay.'}
          </Text>
          <Textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.currentTarget.value)}
            placeholder="Vd: Đi gặp khách hàng, làm việc tại chi nhánh..."
            minRows={3}
            autosize
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => { setReasonModal(null); setReasonText(''); }}>Hủy</Button>
            <Button loading={busy} disabled={reasonText.trim().length < 3} onClick={submitReason}>
              Xác nhận chấm công
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
