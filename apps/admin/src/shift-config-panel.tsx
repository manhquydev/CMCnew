import { useCallback, useEffect, useState } from 'react';
import { trpc, useSession, notifyError, notifySuccess } from '@cmc/ui';
import {
  ActionIcon, Badge, Button, Card, Group, Loader, Select, Stack, Table, Text, TextInput, NumberInput,
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

  const [grpCode, setGrpCode] = useState('');
  const [grpName, setGrpName] = useState('');
  const [grpMode, setGrpMode] = useState<'SINGLE' | 'MULTIPLE'>('SINGLE');
  const [savingGrp, setSavingGrp] = useState(false);

  const [tmplGroupId, setTmplGroupId] = useState<string | null>(null);
  const [tmplCode, setTmplCode] = useState('');
  const [tmplName, setTmplName] = useState('');
  const [tmplStart, setTmplStart] = useState('');
  const [tmplEnd, setTmplEnd] = useState('');
  const [tmplHours, setTmplHours] = useState<number | ''>('');
  const [savingTmpl, setSavingTmpl] = useState(false);

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

  async function createGroup() {
    if (!fid || !grpCode.trim() || !grpName.trim()) return;
    setSavingGrp(true);
    try {
      await trpc.shiftConfig.create.mutate({ facilityId: fid, code: grpCode.trim(), name: grpName.trim(), selectionMode: grpMode });
      notifySuccess('Đã tạo nhóm ca'); setGrpCode(''); setGrpName('');
      loadGroups(fid);
    } catch (e) { notifyError(e, 'Tạo nhóm ca thất bại'); }
    finally { setSavingGrp(false); }
  }

  async function createTemplate() {
    if (!fid || !tmplGroupId || !tmplCode.trim() || !tmplName.trim() || !tmplStart || !tmplEnd || tmplHours === '') return;
    setSavingTmpl(true);
    try {
      await trpc.shiftConfig.createTemplate.mutate({
        facilityId: fid, shiftGroupId: tmplGroupId, code: tmplCode.trim(), name: tmplName.trim(),
        startTime: tmplStart, endTime: tmplEnd, hours: Number(tmplHours),
      });
      notifySuccess('Đã tạo mẫu ca');
      setTmplCode(''); setTmplName(''); setTmplStart(''); setTmplEnd(''); setTmplHours('');
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

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={700} size="sm" mb="md" style={{ color: 'var(--cmc-text)' }}>Thêm nhóm ca</Text>
        <Group gap="sm" align="flex-end">
          <TextInput label="Mã" placeholder="KINH_DOANH" value={grpCode} onChange={(e) => setGrpCode(e.target.value)} style={{ flex: 1 }} />
          <TextInput label="Tên" placeholder="Kinh doanh" value={grpName} onChange={(e) => setGrpName(e.target.value)} style={{ flex: 1 }} />
          <Select label="Chế độ" data={[{ value: 'SINGLE', label: '1 ca/ngày' }, { value: 'MULTIPLE', label: 'Nhiều ca' }]} value={grpMode} onChange={(_v) => setGrpMode((_v ?? 'SINGLE') as 'SINGLE' | 'MULTIPLE')} w={140} />
          <Button leftSection={<IconPlus size={16} />} loading={savingGrp} onClick={createGroup}>Thêm</Button>
        </Group>
      </Card>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={700} size="sm" mb="md" style={{ color: 'var(--cmc-text)' }}>Thêm mẫu ca</Text>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select label="Nhóm ca" data={groups.map((g) => ({ value: g.id, label: g.name }))} value={tmplGroupId} onChange={setTmplGroupId} w={150} />
          <TextInput label="Mã" placeholder="CA1" value={tmplCode} onChange={(e) => setTmplCode(e.target.value)} w={80} />
          <TextInput label="Tên" placeholder="Ca sáng" value={tmplName} onChange={(e) => setTmplName(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
          <TextInput label="Bắt đầu" placeholder="08:00" value={tmplStart} onChange={(e) => setTmplStart(e.target.value)} w={90} />
          <TextInput label="Kết thúc" placeholder="12:00" value={tmplEnd} onChange={(e) => setTmplEnd(e.target.value)} w={90} />
          <NumberInput label="Giờ" placeholder="4" value={tmplHours} onChange={(v) => setTmplHours(typeof v === 'number' ? v : '')} w={70} />
          <Button leftSection={<IconPlus size={16} />} loading={savingTmpl} onClick={createTemplate}>Thêm</Button>
        </Group>
      </Card>

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
    </Stack>
  );
}