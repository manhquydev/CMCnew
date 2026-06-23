import { useCallback, useEffect, useState } from 'react';
import { trpc } from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Opp = Awaited<ReturnType<typeof trpc.crm.opportunityList.query>>[number];

const STAGES = [
  { value: 'O1_LEAD', label: 'O1 · Lead' },
  { value: 'O2_CONTACTED', label: 'O2 · Đã liên hệ' },
  { value: 'O3_TEST_SCHEDULED', label: 'O3 · Đặt lịch test' },
  { value: 'O4_TESTED', label: 'O4 · Đã test' },
  { value: 'O5_ENROLLED', label: 'O5 · Nhập học' },
];
const PROGRAMS = [
  { value: 'UCREA', label: 'UCREA' },
  { value: 'BRIGHT_IG', label: 'Bright I.G' },
  { value: 'BLACK_HOLE', label: 'Black Hole' },
];

function statusOf(o: Opp): { label: string; color: string } {
  if (o.lostReason) return { label: 'Mất', color: 'red' };
  if (o.stage === 'O5_ENROLLED' && o.closedAt) return { label: 'Thành công', color: 'teal' };
  return { label: 'Đang mở', color: 'blue' };
}

export function CrmPanel() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [studentName, setStudentName] = useState('');
  const [program, setProgram] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [lostTarget, setLostTarget] = useState<Opp | null>(null);
  const [lostReason, setLostReason] = useState('');

  useEffect(() => {
    trpc.facility.list.query().then((fs) => {
      setFacilities(fs);
      setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
    });
  }, []);

  const load = useCallback(() => {
    if (!facilityId) return;
    trpc.crm.opportunityList.query({ facilityId }).then(setOpps).catch(() => setOpps([]));
  }, [facilityId]);
  useEffect(load, [load]);

  async function createLead() {
    if (!facilityId || !fullName.trim() || !phone.trim()) {
      setMsg({ kind: 'err', text: 'Nhập tên liên hệ và số điện thoại.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const contact = await trpc.crm.contactCreate.mutate({
        facilityId,
        fullName: fullName.trim(),
        phone: phone.trim(),
      });
      await trpc.crm.opportunityCreate.mutate({
        contactId: contact.id,
        studentName: studentName.trim() || undefined,
        program: (program as 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE') || undefined,
      });
      setMsg({ kind: 'ok', text: `Đã tạo cơ hội cho ${contact.fullName}.` });
      setFullName('');
      setPhone('');
      setStudentName('');
      setProgram(null);
      load();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    } finally {
      setBusy(false);
    }
  }

  async function transition(o: Opp, stage: string) {
    try {
      await trpc.crm.opportunityTransition.mutate({ id: o.id, stage: stage as Opp['stage'] });
      load();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    }
  }
  async function reopen(o: Opp) {
    try {
      await trpc.crm.opportunityReopen.mutate({ id: o.id });
      load();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    }
  }
  async function doMarkLost() {
    if (!lostTarget || !lostReason.trim()) return;
    try {
      await trpc.crm.opportunityMarkLost.mutate({ id: lostTarget.id, reason: lostReason.trim() });
      setLostTarget(null);
      setLostReason('');
      load();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    }
  }

  return (
    <Stack>
      <Select
        label="Cơ sở"
        w={280}
        data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
        value={facilityId ? String(facilityId) : null}
        onChange={(v) => setFacilityId(v ? Number(v) : null)}
        allowDeselect={false}
      />

      <Card withBorder>
        <Title order={5} mb="sm">
          Tạo cơ hội mới
        </Title>
        <Group grow align="flex-end">
          <TextInput label="Tên liên hệ" value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
          <TextInput label="Số điện thoại" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
        </Group>
        <Group grow align="flex-end" mt="sm">
          <TextInput
            label="Tên học sinh (tùy chọn)"
            value={studentName}
            onChange={(e) => setStudentName(e.currentTarget.value)}
          />
          <Select label="Chương trình (tùy chọn)" data={PROGRAMS} value={program} onChange={setProgram} clearable />
        </Group>
        <Group mt="md">
          <Button onClick={createLead} loading={busy}>
            Tạo cơ hội (O1)
          </Button>
        </Group>
      </Card>

      {msg && (
        <Alert color={msg.kind === 'ok' ? 'green' : 'red'} withCloseButton onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      <Card withBorder>
        <Title order={6} mb="sm">
          Pipeline cơ hội
        </Title>
        {opps.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có cơ hội nào.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Học sinh / Liên hệ</Table.Th>
                <Table.Th>SĐT</Table.Th>
                <Table.Th w={210}>Bước</Table.Th>
                <Table.Th>Trạng thái</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {opps.map((o) => {
                const st = statusOf(o);
                const closed = !!o.lostReason;
                return (
                  <Table.Tr key={o.id}>
                    <Table.Td>{o.studentName || o.contact.fullName}</Table.Td>
                    <Table.Td>{o.contact.phone}</Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        data={STAGES}
                        value={o.stage}
                        disabled={closed}
                        onChange={(v) => v && transition(o, v)}
                        allowDeselect={false}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Badge color={st.color}>{st.label}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end">
                        {closed ? (
                          <Button size="compact-xs" variant="light" onClick={() => reopen(o)}>
                            Mở lại
                          </Button>
                        ) : (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="red"
                            onClick={() => setLostTarget(o)}
                          >
                            Mất
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Modal opened={!!lostTarget} onClose={() => setLostTarget(null)} title="Đánh dấu cơ hội mất">
        <Stack>
          <Textarea
            label="Lý do"
            autosize
            minRows={2}
            value={lostReason}
            onChange={(e) => setLostReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLostTarget(null)}>
              Đóng
            </Button>
            <Button color="red" disabled={!lostReason.trim()} onClick={doMarkLost}>
              Xác nhận
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
