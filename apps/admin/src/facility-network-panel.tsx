import { useEffect, useState } from 'react';
import { trpc, useSession, notifyError, notifySuccess, required, StatusBadge, type StatusDef } from '@cmc/ui';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { ActionIcon, Button, Card, Group, Loader, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Network = Awaited<ReturnType<typeof trpc.facilityNetwork.list.query>>[number];

const TH_STYLE: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)', fontWeight: 600,
};

const NETWORK_STATUS_MAP: Record<string, StatusDef> = {
  active: { label: 'Hoạt động', tone: 'active' },
  inactive: { label: 'Đã tắt', tone: 'inactive' },
};

export function FacilityNetworkPanel() {
  const { me } = useSession();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [activeFacilityId, setActiveFacilityId] = useState<number | null>(null);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [loading, setLoading] = useState(true);
  const [opened, { open, close }] = useDisclosure(false);
  const [saving, setSaving] = useState(false);
  const form = useForm({
    initialValues: { ipAddress: '', label: '' },
    validate: {
      ipAddress: required('Nhập địa chỉ IP / CIDR'),
    },
  });

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

  async function addIP(values: typeof form.values) {
    if (!fid) return;
    setSaving(true);
    try {
      await trpc.facilityNetwork.create.mutate({ facilityId: fid, ipAddress: values.ipAddress.trim(), label: values.label.trim() || undefined });
      notifySuccess('Đã thêm IP');
      close();
      form.reset();
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
      <Group justify="space-between" align="center">
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
        <Button leftSection={<IconPlus size={16} />} onClick={open}>
          Thêm IP WiFi công ty
        </Button>
      </Group>

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
                    <StatusBadge
                      status={n.isActive ? 'active' : 'inactive'}
                      map={NETWORK_STATUS_MAP}
                      size="xs"
                      pill
                    />
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

      <Modal opened={opened} onClose={close} title="Thêm IP WiFi công ty" radius="xl" centered>
        <form onSubmit={form.onSubmit(addIP)}>
          <Stack>
            <TextInput label="Địa chỉ IP / CIDR" placeholder="192.168.1.0/24" withAsterisk {...form.getInputProps('ipAddress')} />
            <TextInput label="Ghi chú" placeholder="WiFi VP chính" {...form.getInputProps('label')} />
            <Group justify="flex-end" mt="xs">
              <Button variant="subtle" onClick={close}>Hủy</Button>
              <Button type="submit" variant="filled" radius={9999} loading={saving}>Thêm</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
