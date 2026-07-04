import { useCallback, useEffect, useState } from 'react';
import { trpc, useSession, notifyError, notifySuccess, required } from '@cmc/ui';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import {
  ActionIcon, Badge, Button, Card, Group, Loader, Modal, Select, Stack, Table, Text, TextInput, NumberInput,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type ShiftGroup = Awaited<ReturnType<typeof trpc.shiftConfig.list.query>>[number];

const TH_STYLE: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)', fontWeight: 600,
};

export function ShiftConfigPanel() {
  const { me } = useSession();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [activeFacilityId, setActiveFacilityId] = useState<number | null>(null);
  const [groups, setGroups] = useState<ShiftGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const [grpOpened, { open: openGrp, close: closeGrp }] = useDisclosure(false);
  const [savingGrp, setSavingGrp] = useState(false);
  const grpForm = useForm({
    initialValues: { code: '', name: '', selectionMode: 'SINGLE' as 'SINGLE' | 'MULTIPLE' },
    validate: {
      code: required('Nhập mã nhóm ca'),
      name: required('Nhập tên nhóm ca'),
    },
  });

  const [tmplOpened, { open: openTmpl, close: closeTmpl }] = useDisclosure(false);
  const [savingTmpl, setSavingTmpl] = useState(false);
  const tmplForm = useForm({
    initialValues: {
      groupId: '' as string | null,
      code: '',
      name: '',
      start: '',
      end: '',
      hours: '' as number | '',
    },
    validate: {
      groupId: required('Chọn nhóm ca'),
      code: required('Nhập mã ca'),
      name: required('Nhập tên ca'),
      start: required('Nhập giờ bắt đầu'),
      end: required('Nhập giờ kết thúc'),
      hours: (v) => (v === '' || v === null ? 'Nhập số giờ' : null),
    },
  });

  const loadGroups = useCallback((fid: number) => {
    setLoading(true);
    trpc.shiftConfig.list.query({ facilityId: fid })
      .then(setGroups)
      .catch((e) => notifyError(e, 'Không tải được danh mục ca'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { trpc.facility.list.query().then(setFacilities).catch((e) => notifyError(e)); }, []);

  useEffect(() => {
    const fid = activeFacilityId ?? me.facilityIds[0];
    if (fid) loadGroups(fid);
  }, [activeFacilityId, me.facilityIds, loadGroups]);

    const fid = activeFacilityId ?? me.facilityIds[0];

  async function createGroup(values: typeof grpForm.values) {
    if (!fid) return;
    setSavingGrp(true);
    try {
      await trpc.shiftConfig.create.mutate({ facilityId: fid, code: values.code.trim(), name: values.name.trim(), selectionMode: values.selectionMode });
      notifySuccess('Đã tạo nhóm ca');
      closeGrp();
      grpForm.reset();
      loadGroups(fid);
    } catch (e) { notifyError(e, 'Tạo nhóm ca thất bại'); }
    finally { setSavingGrp(false); }
  }

  async function createTemplate(values: typeof tmplForm.values) {
    if (!fid || !values.groupId || values.hours === '') return;
    setSavingTmpl(true);
    try {
      await trpc.shiftConfig.createTemplate.mutate({
        facilityId: fid, shiftGroupId: values.groupId, code: values.code.trim(), name: values.name.trim(),
        startTime: values.start, endTime: values.end, hours: Number(values.hours),
      });
      notifySuccess('Đã tạo mẫu ca');
      closeTmpl();
      tmplForm.reset();
      loadGroups(fid);
    } catch (e) { notifyError(e, 'Tạo mẫu ca thất bại'); }
    finally { setSavingTmpl(false); }
  }

  async function archiveGroup(id: string) {
    if (!fid) return;
    try { await trpc.shiftConfig.archive.mutate({ id }); notifySuccess('Đã lưu trữ'); loadGroups(fid); }
    catch (e) { notifyError(e, 'Lưu trữ thất bại'); }
  }

  if (!me.isSuperAdmin) return <Text c="dimmed">Chỉ super_admin mới được cấu hình danh mục ca</Text>;

  return (
    <Stack maw={720}>
      <Group gap="xs">
        {facilities.map((f) => (
          <Button key={f.id} size="xs" variant={(activeFacilityId ?? me.facilityIds[0]) === f.id ? 'filled' : 'light'} onClick={() => setActiveFacilityId(f.id)}>{f.name}</Button>
        ))}
      </Group>

      <Group gap="sm">
        <Button leftSection={<IconPlus size={16} />} onClick={openGrp}>Tạo nhóm ca</Button>
        <Button leftSection={<IconPlus size={16} />} variant="light" onClick={openTmpl}>Tạo mẫu ca</Button>
      </Group>

      {loading ? (
        <Group justify="center"><Loader /></Group>
      ) : groups.length === 0 ? (
        <Text c="dimmed" ta="center">Chưa có nhóm ca nào</Text>
      ) : (
        groups.map((g) => (
          <Card key={g.id} radius="lg" p="md" style={{ border: '1px solid var(--cmc-border)' }}>
            <Group justify="space-between" mb="sm">
              <Group gap="xs">
                <Text fw={700} size="sm" style={{ color: 'var(--cmc-text)' }}>{g.name}</Text>
                <Badge size="xs" variant="light" radius="xl">{g.code}</Badge>
                <Badge size="xs" color="blue" variant="light" radius="xl">{g.selectionMode === 'SINGLE' ? '1 ca/ngày' : 'Nhiều ca'}</Badge>
              </Group>
              <ActionIcon color="red" variant="light" size="sm" onClick={() => archiveGroup(g.id)}><IconTrash size={14} /></ActionIcon>
            </Group>
            {g.templates.length > 0 && (
              <Table striped highlightOnHover withTableBorder={false}>
                <Table.Thead><Table.Tr>
                  <Table.Th style={TH_STYLE}>Ca</Table.Th><Table.Th style={TH_STYLE}>Giờ</Table.Th><Table.Th style={TH_STYLE}>Số giờ</Table.Th>
                </Table.Tr></Table.Thead>
                <Table.Tbody>
                  {g.templates.map((t) => (
                    <Table.Tr key={t.id}>
                      <Table.Td>{t.name} <Badge size="xs" variant="light">{t.code}</Badge></Table.Td>
                      <Table.Td style={{ fontFamily: 'monospace' }}>{t.startTime} – {t.endTime}</Table.Td>
                      <Table.Td>{t.hours}h</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        ))
      )}

      <Modal opened={grpOpened} onClose={closeGrp} title="Tạo nhóm ca" radius="xl" centered>
        <form onSubmit={grpForm.onSubmit(createGroup)}>
          <Stack>
            <TextInput label="Mã" placeholder="KINH_DOANH" withAsterisk {...grpForm.getInputProps('code')} />
            <TextInput label="Tên" placeholder="Kinh doanh" withAsterisk {...grpForm.getInputProps('name')} />
            <Select
              label="Chế độ"
              data={[{ value: 'SINGLE', label: '1 ca/ngày' }, { value: 'MULTIPLE', label: 'Nhiều ca' }]}
              {...grpForm.getInputProps('selectionMode')}
            />
            <Group justify="flex-end" mt="xs">
              <Button variant="subtle" onClick={closeGrp}>Hủy</Button>
              <Button type="submit" variant="filled" radius={9999} loading={savingGrp}>Thêm</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={tmplOpened} onClose={closeTmpl} title="Tạo mẫu ca" radius="xl" centered>
        <form onSubmit={tmplForm.onSubmit(createTemplate)}>
          <Stack>
            <Select
              label="Nhóm ca"
              withAsterisk
              data={groups.map((g) => ({ value: g.id, label: g.name }))}
              {...tmplForm.getInputProps('groupId')}
            />
            <Group grow>
              <TextInput label="Mã" placeholder="CA1" withAsterisk {...tmplForm.getInputProps('code')} />
              <TextInput label="Tên" placeholder="Ca sáng" withAsterisk {...tmplForm.getInputProps('name')} />
            </Group>
            <Group grow>
              <TextInput label="Bắt đầu" placeholder="08:00" withAsterisk {...tmplForm.getInputProps('start')} />
              <TextInput label="Kết thúc" placeholder="12:00" withAsterisk {...tmplForm.getInputProps('end')} />
              <NumberInput label="Giờ" placeholder="4" withAsterisk {...tmplForm.getInputProps('hours')} />
            </Group>
            <Group justify="flex-end" mt="xs">
              <Button variant="subtle" onClick={closeTmpl}>Hủy</Button>
              <Button type="submit" variant="filled" radius={9999} loading={savingTmpl}>Thêm</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
