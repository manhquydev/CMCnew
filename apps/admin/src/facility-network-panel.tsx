import { useEffect, useState } from 'react';
import { trpc, useSession, notifyError, notifySuccess } from '@cmc/ui';
import { ActionIcon, Badge, Button, Card, Group, Loader, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Network = Awaited<ReturnType<typeof trpc.facilityNetwork.list.query>>[number];

const TH_STYLE: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)', fontWeight: 600,
};

export function FacilityNetworkPanel() {
  const { me } = useSession();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [activeFacilityId, setActiveFacilityId] = useState<number | null>(null);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [loading, setLoading] = useState(true);
  const [ipAddress, setIpAddress] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    trpc.facility.list.query()
      .then(setFacilities)
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  }, []);

  useEffect(() => {
    const fid = activeFacilityId ?? me.facilityIds[0];
    if (!fid) return;
    setLoading(true);
    trpc.facilityNetwork.list.query({ facilityId: fid })
      .then(setNetworks)
      .catch((e) => notifyError(e, 'Không tải được danh sách IP'))
      .finally(() => setLoading(false));
  }, [activeFacilityId, me.facilityIds]);

  const fid = activeFacilityId ?? me.facilityIds[0];

  async function addIP() {
    if (!fid || !ipAddress.trim()) return;
    setSaving(true);
    try {
      await trpc.facilityNetwork.create.mutate({ facilityId: fid, ipAddress: ipAddress.trim(), label: label.trim() || undefined });
      notifySuccess('Đã thêm IP');
      setIpAddress(''); setLabel('');
      trpc.facilityNetwork.list.query({ facilityId: fid }).then(setNetworks);
    } catch (e) { notifyError(e, 'Thêm IP thất bại'); }
    finally { setSaving(false); }
  }

  async function deleteIP(id: string) {
    if (!fid) return;
    try {
      await trpc.facilityNetwork.delete.mutate({ id });
      notifySuccess('Đã xóa IP');
      trpc.facilityNetwork.list.query({ facilityId: fid }).then(setNetworks);
    } catch (e) { notifyError(e, 'Xóa IP thất bại'); }
  }

  if (!me.isSuperAdmin && !me.roles.includes('giam_doc_kinh_doanh')) {
    return <Text c="dimmed">Bạn không có quyền cấu hình IP</Text>;
  }

  return (
    <Stack maw={640}>
      <Group gap="xs">
        {facilities.map((f) => (
          <Button
            key={f.id}
            size="xs"
            variant={(activeFacilityId ?? me.facilityIds[0]) === f.id ? 'filled' : 'light'}
            onClick={() => setActiveFacilityId(f.id)}
          >{f.name}</Button>
        ))}
      </Group>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={700} size="sm" mb="md" style={{ color: 'var(--cmc-text)' }}>Thêm IP WiFi công ty</Text>
        <Group gap="sm" align="flex-end">
          <TextInput
            label="Địa chỉ IP / CIDR"
            placeholder="192.168.1.0/24"
            value={ipAddress}
            onChange={(e) => setIpAddress(e.target.value)}
            style={{ flex: 1 }}
          />
          <TextInput
            label="Ghi chú"
            placeholder="WiFi VP chính"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ flex: 1 }}
          />
          <Button leftSection={<IconPlus size={16} />} loading={saving} onClick={addIP}>
            Thêm
          </Button>
        </Group>
      </Card>

      {loading ? (
        <Group justify="center"><Loader /></Group>
      ) : networks.length === 0 ? (
        <Text c="dimmed" ta="center">Chưa có IP nào được cấu hình</Text>
      ) : (
        <Card radius="lg" p="md" style={{ border: '1px solid var(--cmc-border)' }}>
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>IP / CIDR</Table.Th>
                <Table.Th style={TH_STYLE}>Ghi chú</Table.Th>
                <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
                <Table.Th style={TH_STYLE}>Thao tác</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {networks.map((n) => (
                <Table.Tr key={n.id}>
                  <Table.Td style={{ fontFamily: 'monospace' }}>{n.ipAddress}</Table.Td>
                  <Table.Td>{n.label ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={n.isActive ? 'green' : 'gray'} variant="light" radius="xl">
                      {n.isActive ? 'Hoạt động' : 'Đã tắt'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon color="red" variant="light" size="sm" onClick={() => deleteIP(n.id)}>
                      <IconTrash size={14} />
                    </ActionIcon>
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
