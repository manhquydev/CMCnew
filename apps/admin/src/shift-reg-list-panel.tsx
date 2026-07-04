import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, useSession, notifyError, notifySuccess, StatusBadge, type StatusDef } from '@cmc/ui';
import { Button, Card, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)', fontWeight: 600,
};

const CLICK_CELL: React.CSSProperties = { cursor: 'pointer' };

type ShiftReg = Awaited<ReturnType<typeof trpc.shiftRegistration.list.query>>[number];

const STATUS_MAP: Record<string, StatusDef> = {
  draft: { label: 'Nháp', tone: 'draft' },
  submitted: { label: 'Chờ duyệt', tone: 'pending' },
  approved: { label: 'Đã duyệt', tone: 'active' },
  cancelled: { label: 'Đã hủy', tone: 'inactive' },
};

export function ShiftRegListPanel({ onSelect }: { onSelect: (id: string) => void }) {
  const { me } = useSession();
  const [regs, setRegs] = useState<ShiftReg[]>([]);
  const [loading, setLoading] = useState(false);
  const fid = me.facilityIds[0];

  const load = useCallback(() => {
    if (!fid) return;
    setLoading(true);
    (trpc.shiftRegistration).list.query({ facilityId: fid })
      .then(setRegs)
      .catch((e) => notifyError(e, 'Không tải được danh sách'))
      .finally(() => setLoading(false));
  }, [fid]);

  useEffect(() => { load(); }, [load]);

  const canApprove = me.isSuperAdmin || me.roles.some((r) =>
    ['giao_vien', 'sale', 'cskh', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'].includes(r));
  const canCreate = me.isSuperAdmin || me.roles.some((r) =>
    ['giao_vien', 'sale', 'cskh'].includes(r));
  const hasOpen = regs.some((r) => r.userId === me.userId && ['draft', 'submitted'].includes(r.status));
  const showStaff = regs.some((r) => r.userId !== me.userId);

  async function doApprove(id: string) {
    try {
      await trpc.shiftRegistration.approve.mutate({ id });
      notifySuccess('Đã duyệt phiếu');
      load();
    } catch (e) { notifyError(e, 'Duyệt thất bại'); }
  }

  async function doReject(id: string) {
    const reason = window.prompt('Lý do từ chối (tối thiểu 10 ký tự)?');
    if (!reason || reason.length < 10) { if (reason !== null) notifyError(new Error('Lý do quá ngắn'), 'Từ chối thất bại'); return; }
    try {
      await trpc.shiftRegistration.reject.mutate({ id, reason });
      notifySuccess('Đã từ chối phiếu');
      load();
    } catch (e) { notifyError(e, 'Từ chối thất bại'); }
  }

  return (
    <Stack>
      <Group justify="space-between" mb="xs">
        <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }}>Đăng ký công ca</Text>
        {canCreate && (
          <Tooltip label="Bạn đang có phiếu chưa hoàn tất — mở phiếu Nháp/Chờ duyệt để sửa." disabled={!hasOpen}>
            <Button variant="filled" radius={9999} leftSection={<IconPlus size={16} />}
              disabled={hasOpen} onClick={() => onSelect('new')}>
              Tạo phiếu
            </Button>
          </Tooltip>
        )}
      </Group>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        {loading && <Text c="dimmed" size="sm">Đang tải...</Text>}
        {!loading && regs.length === 0 && <Text c="dimmed" size="sm">Chưa có phiếu đăng ký nào.</Text>}
        {!loading && regs.length > 0 && (
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Mã phiếu</Table.Th>
                {showStaff && <Table.Th style={TH_STYLE}>Nhân sự</Table.Th>}
                <Table.Th style={TH_STYLE}>Từ ngày</Table.Th>
                <Table.Th style={TH_STYLE}>Đến ngày</Table.Th>
                <Table.Th style={TH_STYLE}>Nhóm ca</Table.Th>
                <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
                <Table.Th style={TH_STYLE}>Thao tác</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {regs.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td onClick={() => onSelect(r.id)} style={CLICK_CELL}>
                    <Text size="sm" fw={500}>{r.code ?? 'Nháp'}</Text>
                  </Table.Td>
                  {showStaff && (
                    <Table.Td onClick={() => onSelect(r.id)} style={CLICK_CELL}>
                      {r.user ? (
                        <>
                          <Text size="sm" fw={500}>
                            {r.user.employeeCode ? `${r.user.employeeCode} · ${r.user.displayName}` : r.user.displayName}
                          </Text>
                          <Text size="xs" c="dimmed">{r.user.email}</Text>
                        </>
                      ) : (
                        <Text size="sm" c="dimmed">—</Text>
                      )}
                    </Table.Td>
                  )}
                  <Table.Td onClick={() => onSelect(r.id)} style={CLICK_CELL}>
                    {dayjs(r.fromDate).format('DD/MM/YY')}
                  </Table.Td>
                  <Table.Td onClick={() => onSelect(r.id)} style={CLICK_CELL}>
                    {dayjs(r.toDate).format('DD/MM/YY')}
                  </Table.Td>
                  <Table.Td onClick={() => onSelect(r.id)} style={CLICK_CELL}>
                    {(r).shiftGroup?.name ?? '—'}
                  </Table.Td>
                  <Table.Td onClick={() => onSelect(r.id)} style={CLICK_CELL}>
                    <StatusBadge status={r.status} map={STATUS_MAP} pill />
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button variant="subtle" size="compact-xs" onClick={() => onSelect(r.id)}>
                        {r.status === 'draft' ? 'Sửa' : 'Xem'}
                      </Button>
                      {r.status === 'submitted' && canApprove && (
                        <>
                          <Button variant="filled" color="green" size="compact-xs"
                            onClick={() => doApprove(r.id)}>
                            Duyệt
                          </Button>
                          <Button variant="light" color="red" size="compact-xs"
                            onClick={() => doReject(r.id)}>
                            Từ chối
                          </Button>
                        </>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
