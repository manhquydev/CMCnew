import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, useSession, notifyError, notifySuccess } from '@cmc/ui';
import { Alert, Badge, Button, Card, Checkbox, Group, Radio, Stack, Table, Text } from '@mantine/core';
import { IconAlertCircle, IconArrowLeft } from '@tabler/icons-react';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)', fontWeight: 600,
};

type ShiftGroup = { id: string; code: string; name: string; selectionMode: string; templates: ShiftTemplate[] };
type ShiftTemplate = { id: string; code: string; name: string; startTime: string; endTime: string; hours: number };
type ShiftRegistrationRow = {
  id: string;
  code: string | null;
  userId: string;
  fromDate: string | Date;
  toDate: string | Date;
  status: string;
  entries?: { date: string | Date; shiftTemplateId: string }[];
};

/// Enumerate dates from fromDate to toDate.
function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = dayjs(from);
  const end = dayjs(to);
  while (cur.isBefore(end) || cur.isSame(end, 'day')) {
    dates.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }
  return dates;
}

export function ShiftRegDetailPanel({ regId, onBack }: { regId: string; onBack: () => void }) {
  const { me } = useSession();
  const [reg, setReg] = useState<ShiftRegistrationRow | null>(null);
  const [group, setGroup] = useState<ShiftGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Selected shifts per date: Map<dateString, Set<shiftTemplateId>>
  const [selected, setSelected] = useState<Map<string, Set<string>>>(new Map());

  const isNew = regId === 'new';
  const fid = me.facilityIds[0];

  const loadReg = useCallback(() => {
    if (isNew) { setLoading(false); return; }
    setLoading(true);
    trpc.shiftRegistration.get.query({ id: regId })
      .then((r) => {
        setReg(r);
        // Initialize selected from existing entries
        const map = new Map<string, Set<string>>();
        for (const e of r.entries ?? []) {
          const key = dayjs(e.date).format('YYYY-MM-DD');
          if (!map.has(key)) map.set(key, new Set());
          map.get(key)!.add(e.shiftTemplateId);
        }
        setSelected(map);
      })
      .catch((e: unknown) => notifyError(e, 'Không tải được phiếu'))
      .finally(() => setLoading(false));
  }, [regId, isNew]);

  const loadGroup = useCallback(() => {
    if (!fid) return;
    trpc.shiftConfig.list.query({ facilityId: fid })
      .then((groups: ShiftGroup[]) => {
        // Find group matching user's role
        const isSales = me.roles.some((r: string) => ['sale', 'cskh', 'ctv_mkt'].includes(r));
        const isTeacher = me.roles.some((r: string) => ['giao_vien'].includes(r));
        const targetCode = isSales ? 'KINH_DOANH' : isTeacher ? 'GIAO_VIEN' : 'KINH_DOANH';
        const g = groups.find((g: ShiftGroup) => g.code === targetCode) ?? groups[0];
        setGroup(g ?? null);
      })
      .catch((e: unknown) => notifyError(e, 'Không tải được danh mục ca'));
  }, [fid, me.roles]);

  useEffect(() => { loadReg(); loadGroup(); }, [loadReg, loadGroup]);

  // Toggle a shift for a date — auto-saves to backend with rollback on failure
  function toggle(date: string, tmplId: string) {
    if (!reg) return;
    if (busy) return; // guard against rapid clicks
    const prevSelected = new Map(selected);
    const current = selected.get(date) ?? new Set();
    const nextForDate = group?.selectionMode === 'SINGLE'
      ? current.has(tmplId) ? new Set<string>() : new Set([tmplId])
      : new Set(current);
    if (group?.selectionMode !== 'SINGLE') {
      if (nextForDate.has(tmplId)) nextForDate.delete(tmplId);
      else nextForDate.add(tmplId);
    }
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(date, nextForDate);
      return next;
    });
    const entries = [...nextForDate].map((id) => ({
      shiftTemplateId: id,
      type: 'work' as const,
    }));
    trpc.shiftRegistration.updateEntry.mutate({
      registrationId: reg.id,
      date,
      entries,
    }).catch((e) => {
      notifyError(e, 'Không lưu được — đã hoàn tác');
      setSelected(prevSelected); // rollback on failure
    });
  }

  // Submit registration
  async function handleSubmit() {
    if (!reg?.id) return;
    setBusy(true);
    try {
      const result = await trpc.shiftRegistration.submit.mutate({ id: reg.id });
      notifySuccess('Đã gửi phiếu duyệt');
      setReg(result); // update local state so button disappears
    } catch (e) {
      notifyError(e, 'Không gửi được');
    } finally { setBusy(false); }
  }

  async function handleWithdraw() {
    if (!reg?.id) return;
    setBusy(true);
    try {
      const result = await trpc.shiftRegistration.withdraw.mutate({ id: reg.id });
      notifySuccess('Đã rút phiếu về nháp');
      setReg(result);
    } catch (e) {
      notifyError(e, 'Không rút được phiếu');
    } finally { setBusy(false); }
  }

  // Create new registration
  async function handleCreate(fromDate: string, toDate: string) {
    if (!fid) return;
    setBusy(true);
    try {
      const r = await trpc.shiftRegistration.create.mutate({
        facilityId: fid,
        fromDate,
        toDate,
      });
      notifySuccess('Đã tạo phiếu nháp');
      setReg(r);
    } catch (e) {
      notifyError(e, 'Không tạo được phiếu');
    } finally { setBusy(false); }
  }

  if (loading) return <Text c="dimmed">Đang tải...</Text>;

  // New registration: show date picker form
  if (!reg && !isNew) return <Text c="dimmed">Không tìm thấy phiếu</Text>;

  if (!reg) {
    return <NewRegForm onCreate={handleCreate} onBack={onBack} />;
  }

  const dates = enumerateDates(
    dayjs(reg.fromDate).format('YYYY-MM-DD'),
    dayjs(reg.toDate).format('YYYY-MM-DD'),
  );
  const isDraft = reg.status === 'draft';
  const canWithdraw = me.isSuperAdmin || me.roles.some((r: string) => ['giao_vien', 'sale', 'cskh'].includes(r));
  const templates = group?.templates ?? [];

  // Calculate daily and total hours
  function dayHours(date: string): number {
    const ids = selected.get(date) ?? new Set();
    let total = 0;
    for (const id of ids) {
      const t = templates.find((t) => t.id === id);
      if (t) total += t.hours;
    }
    return total;
  }

  const totalHours = dates.reduce((sum, d) => sum + dayHours(d), 0);
  const daysWithShifts = dates.filter((d) => (selected.get(d)?.size ?? 0) > 0).length;

  return (
    <Stack>
      <Group mb="xs">
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack}>Quay lại</Button>
      </Group>

      {/* Alert banner */}
      <Alert icon={<IconAlertCircle size={16} />} color="blue" radius="md">
        <Text size="sm">
          <b>Lưu ý:</b> Hệ thống chỉ có "đăng ký ca" và "đăng ký đổi ca". Khi bạn muốn bổ sung ca hãy nhập lại toàn bộ lịch làm việc cũ. Khi lịch mới được duyệt, hệ thống sẽ hủy bỏ lịch cũ. Bạn sẽ không thể đăng ký ca làm việc vào ngày nghỉ phép, và ngược lại.
        </Text>
      </Alert>

      {/* Header info */}
      <Card radius="lg" p="md" style={{ border: '1px solid var(--cmc-border)' }}>
        <Group gap="xl">
          <div>
            <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }}>Phiếu</Text>
            <Text fw={600}>{reg.code ?? 'Nháp'}</Text>
          </div>
          <div>
            <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }}>Từ ngày</Text>
            <Text fw={600}>{dayjs(reg.fromDate).format('DD/MM/YYYY')}</Text>
          </div>
          <div>
            <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }}>Đến ngày</Text>
            <Text fw={600}>{dayjs(reg.toDate).format('DD/MM/YYYY')}</Text>
          </div>
          <div>
            <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }}>Nhóm</Text>
            <Text fw={600}>{group?.name ?? '—'}</Text>
          </div>
          <div>
            <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }}>Trạng thái</Text>
            <Badge size="sm" color={reg.status === 'draft' ? 'gray' : reg.status === 'submitted' ? 'blue' : 'green'} variant="light" radius="xl">
              {reg.status === 'draft' ? 'Nháp' : reg.status === 'submitted' ? 'Chờ duyệt' : 'Đã duyệt'}
            </Badge>
          </div>
        </Group>
      </Card>

      {/* Stats */}
      <Group gap="md">
        <Badge color="blue" variant="light" radius="xl" size="lg">
          {daysWithShifts} ngày đăng ký
        </Badge>
        <Badge color="green" variant="light" radius="xl" size="lg">
          {totalHours}h tổng
        </Badge>
      </Group>

      {/* Shift Grid */}
      <Card radius="lg" p="md" style={{ border: '1px solid var(--cmc-border)', overflowX: 'auto' }}>
        <Table striped withTableBorder={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ ...TH_STYLE, minWidth: 120 }}>Ngày</Table.Th>
              {templates.map((t) => (
                <Table.Th key={t.id} style={{ ...TH_STYLE, textAlign: 'center' }}>
                  <Text size="xs" fw={600}>{t.name}</Text>
                  <Text size="xs" style={{ fontSize: 10, color: 'var(--cmc-text-faint)' }}>{t.startTime}–{t.endTime} ({t.hours}h)</Text>
                </Table.Th>
              ))}
              <Table.Th style={{ ...TH_STYLE, textAlign: 'center', width: 80 }}>Tổng giờ</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {dates.map((date) => {
              const cur = selected.get(date) ?? new Set();
              return (
                <Table.Tr key={date}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{dayjs(date).format('DD/MM/YY')}</Text>
                    <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }}>{dayjs(date).format('dddd')}</Text>
                  </Table.Td>
                  {templates.map((t) => (
                    <Table.Td key={t.id} align="center">
                      {group?.selectionMode === 'SINGLE' ? (
                        <Radio
                          checked={cur.has(t.id)}
                          onChange={() => isDraft && toggle(date, t.id)}
                          disabled={!isDraft}
                          styles={{ radio: { cursor: isDraft ? 'pointer' : 'default' } }}
                        />
                      ) : (
                        <Checkbox
                          checked={cur.has(t.id)}
                          onChange={() => isDraft && toggle(date, t.id)}
                          disabled={!isDraft}
                          styles={{ input: { cursor: isDraft ? 'pointer' : 'default' } }}
                        />
                      )}
                    </Table.Td>
                  ))}
                  <Table.Td align="center">
                    <Text size="sm" fw={600}>{dayHours(date) || '—'}{dayHours(date) > 0 ? 'h' : ''}</Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td><Text size="sm" fw={700}>TỔNG</Text></Table.Td>
              {templates.map((t) => (
                <Table.Td key={t.id} align="center">
                  <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }}>
                    {dates.filter((d) => selected.get(d)?.has(t.id)).length} ngày
                  </Text>
                </Table.Td>
              ))}
              <Table.Td align="center">
                <Text size="sm" fw={700}>{totalHours}h</Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Card>

      {/* Action buttons */}
      {isDraft && (
        <Group justify="flex-end">
          <Button variant="filled" radius={9999} loading={busy} onClick={handleSubmit}>
            Gửi duyệt
          </Button>
        </Group>
      )}
      {reg.status === 'submitted' && canWithdraw && (
        <Group justify="flex-end">
          <Button variant="light" color="orange" radius={9999} loading={busy} onClick={() => void handleWithdraw()}>
            Rút phiếu
          </Button>
        </Group>
      )}
    </Stack>
  );
}

/// New registration creation form.
function NewRegForm({ onCreate, onBack }: { onCreate: (from: string, to: string) => Promise<void>; onBack: () => void }) {
  const today = dayjs().format('YYYY-MM-DD');
  const nextMonth = dayjs().add(1, 'month').format('YYYY-MM-DD');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(nextMonth);
  const [busy, setBusy] = useState(false);

  async function handle() {
    setBusy(true);
    try {
      await onCreate(fromDate, toDate);
    } finally { setBusy(false); }
  }

  return (
    <Stack maw={500}>
      <Group mb="xs">
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack}>Quay lại</Button>
      </Group>
      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="md" style={{ color: 'var(--cmc-text)' }}>Tạo phiếu đăng ký ca</Text>
        <Alert icon={<IconAlertCircle size={16} />} color="blue" radius="md" mb="md">
          <Text size="sm">Tạo phiếu ở trạng thái Nháp. Bạn có thể tích chọn ca và gửi duyệt sau.</Text>
        </Alert>
        <Group mb="md">
          <div>
            <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }} mb={4}>Từ ngày</Text>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--cmc-border)', fontSize: 14 }} />
          </div>
          <div>
            <Text size="xs" style={{ color: 'var(--cmc-text-muted)' }} mb={4}>Đến ngày</Text>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--cmc-border)', fontSize: 14 }} />
          </div>
        </Group>
        <Group justify="flex-end">
          <Button variant="filled" radius={9999} loading={busy} onClick={handle} disabled={!fromDate || !toDate || fromDate > toDate}>
            Tạo phiếu
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}
