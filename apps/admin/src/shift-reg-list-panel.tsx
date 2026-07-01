import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, useSession, notifyError, notifySuccess } from '@cmc/ui';
import { Badge, Button, Card, Group, Stack, Table, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)', fontWeight: 600,
};

type ShiftReg = Awaited<ReturnType<typeof trpc.shiftRegistration.list.query>>[number];

function statusColor(s: string): string {
  switch (s) {
    case 'draft': return 'gray';
    case 'submitted': return 'blue';
    case 'approved': return 'green';
    case 'cancelled': return 'orange';
    default: return 'gray';
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'draft': return 'Nháp';
    case 'submitted': return 'Chờ duyệt';
    case 'approved': return 'Đã duyệt';
    case 'cancelled': return 'Đã hủy';
    default: return s;
  }
}

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
    ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'].includes(r));
  const canCreate = me.isSuperAdmin || me.roles.some((r) =>
    ['giao_vien', 'sale', 'cskh'].includes(r));

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
          <Button variant="filled" radius={9999} leftSection={<IconPlus size={16} />} onClick={() => onSelect('new')}>
            Tạo phiếu
          </Button>
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
                <Table.Th style={TH_STYLE}>Từ ngày</Table.Th>
                <Table.Th style={TH_STYLE}>Đến ngày</Table.Th>
                <Table.Th style={TH_STYLE}>Nhóm ca</Table.Th>
                <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
                <Table.Th style={TH_STYLE}>Thao tác</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {regs.map((r) => (
                <Table.Tr key={r.id} style={{ cursor: 'pointer' }}>
                  <Table.Td onClick={() => onSelect(r.id)}>
                    <Text size="sm" fw={500}>{r.code ?? 'Nháp'}</Text>
                  </Table.Td>
                  <Table.Td onClick={() => onSelect(r.id)}>
                    {dayjs(r.fromDate).format('DD/MM/YY')}
                  </Table.Td>
                  <Table.Td onClick={() => onSelect(r.id)}>
                    {dayjs(r.toDate).format('DD/MM/YY')}
                  </Table.Td>
                  <Table.Td onClick={() => onSelect(r.id)}>
                    {(r).shiftGroup?.name ?? '—'}
                  </Table.Td>
                  <Table.Td onClick={() => onSelect(r.id)}>
                    <Badge size="sm" color={statusColor(r.status)} variant="light" radius="xl">
                      {statusLabel(r.status)}
                    </Badge>
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
