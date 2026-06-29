import { useState, useEffect, useCallback } from 'react';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';

const PROGRAMS = [
  { value: 'UCREA', label: 'UCREA' },
  { value: 'BRIGHT_IG', label: 'Bright I.G' },
  { value: 'BLACK_HOLE', label: 'Black Hole' },
];

// ─── Gift create ──────────────────────────────────────────────────────────────

function GiftCreateCard({ facilities }: { facilities: { id: number; code: string; name: string }[] }) {
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      facilityId: '',
      name: '',
      starsRequired: 10,
      stock: '' as number | '',
      program: '' as string,
      imageUrl: '',
    },
    validate: {
      facilityId: (v) => (!v ? 'Chọn cơ sở' : null),
      name: (v) => (!v.trim() ? 'Nhập tên quà' : null),
      starsRequired: (v) => (v <= 0 ? 'Số sao phải > 0' : null),
    },
  });

  async function create(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.rewards.giftCreate.mutate({
        facilityId: Number(values.facilityId),
        name: values.name.trim(),
        starsRequired: values.starsRequired,
        stock: values.stock !== '' ? Number(values.stock) : undefined,
        program: (values.program || undefined) as 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE' | undefined,
        imageUrl: values.imageUrl.trim() || undefined,
      });
      notifySuccess(`Đã tạo quà "${values.name}"`);
      form.reset();
    } catch (e) {
      notifyError(e, 'Tạo quà thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Tạo quà tặng
      </Title>
      <form onSubmit={form.onSubmit(create)}>
        <Stack>
          <Group grow align="flex-end">
            <Select
              label="Cơ sở"
              withAsterisk
              data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
              {...form.getInputProps('facilityId')}
            />
            <TextInput label="Tên quà" withAsterisk {...form.getInputProps('name')} />
          </Group>
          <Group grow align="flex-end">
            <NumberInput
              label="Số sao cần đổi"
              withAsterisk
              min={1}
              {...form.getInputProps('starsRequired')}
            />
            <NumberInput
              label="Tồn kho (để trống = không giới hạn)"
              min={0}
              {...form.getInputProps('stock')}
            />
          </Group>
          <Group grow align="flex-end">
            <Select
              label="Chương trình (tùy chọn)"
              data={PROGRAMS}
              clearable
              {...form.getInputProps('program')}
            />
            <TextInput
              label="URL hình ảnh (tùy chọn)"
              placeholder="https://..."
              {...form.getInputProps('imageUrl')}
            />
          </Group>
          <Group mt="xs">
            <Button type="submit" loading={busy}>
              Tạo quà
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

// ─── Pending redemptions review ────────────────────────────────────────────────

type PendingReward = {
  id: string;
  giftName: string;
  studentName: string;
  studentCode: string;
  starsSpent: number;
  createdAt: string | Date;
};

function PendingReviewCard() {
  const [rows, setRows] = useState<PendingReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingReward | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await trpc.rewards.pendingList.query();
      setRows(list);
    } catch (e) {
      notifyError(e, 'Không tải được danh sách đơn đổi quà');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(r: PendingReward) {
    setActingId(r.id);
    try {
      await trpc.rewards.review.mutate({ id: r.id, decision: 'approved' });
      notifySuccess(`Đã duyệt đổi quà "${r.giftName}"`);
      await load();
    } catch (e) {
      notifyError(e, 'Duyệt đổi quà thất bại');
      // A conflict usually means the row was already handled elsewhere — resync.
      await load();
    } finally {
      setActingId(null);
    }
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    setActingId(rejectTarget.id);
    try {
      await trpc.rewards.review.mutate({
        id: rejectTarget.id,
        decision: 'rejected',
        reason: reason.trim() || undefined,
      });
      notifySuccess('Đã từ chối đổi quà (hoàn sao)');
      setRejectTarget(null);
      setReason('');
      await load();
    } catch (e) {
      notifyError(e, 'Từ chối đổi quà thất bại');
      // A conflict usually means the row was already handled elsewhere — resync.
      await load();
    } finally {
      setActingId(null);
    }
  }

  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Title order={5}>Đơn đổi quà chờ duyệt</Title>
        <Button variant="subtle" size="xs" onClick={() => void load()} disabled={loading}>
          Tải lại
        </Button>
      </Group>

      {loading ? (
        <Group justify="center" py="lg">
          <Loader size="sm" />
        </Group>
      ) : rows.length === 0 ? (
        <Text c="dimmed" py="md" ta="center">
          Không có đơn đổi quà nào đang chờ duyệt.
        </Text>
      ) : (
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Học sinh</Table.Th>
              <Table.Th>Quà</Table.Th>
              <Table.Th>Sao</Table.Th>
              <Table.Th>Ngày đổi</Table.Th>
              <Table.Th ta="right">Hành động</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <Text fw={500}>{r.studentName}</Text>
                  <Text size="xs" c="dimmed">
                    {r.studentCode}
                  </Text>
                </Table.Td>
                <Table.Td>{r.giftName}</Table.Td>
                <Table.Td>
                  <Badge color="yellow" variant="light">
                    {r.starsSpent} ★
                  </Badge>
                </Table.Td>
                <Table.Td>{new Date(r.createdAt).toLocaleDateString('vi-VN')}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button
                      size="xs"
                      color="teal"
                      loading={actingId === r.id}
                      onClick={() => void approve(r)}
                    >
                      Duyệt
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      disabled={actingId === r.id}
                      onClick={() => {
                        setReason('');
                        setRejectTarget(r);
                      }}
                    >
                      Từ chối
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        opened={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        title="Từ chối đổi quà (hoàn sao)"
        centered
      >
        {rejectTarget && (
          <Stack>
            <Text size="sm">
              Từ chối đơn của <b>{rejectTarget.studentName}</b> — quà{' '}
              <b>{rejectTarget.giftName}</b>. {rejectTarget.starsSpent} sao sẽ được hoàn lại.
            </Text>
            <Textarea
              label="Lý do từ chối (tùy chọn)"
              autosize
              minRows={2}
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setRejectTarget(null)}>
                Huỷ
              </Button>
              <Button color="red" loading={actingId === rejectTarget.id} onClick={() => void confirmReject()}>
                Xác nhận từ chối
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Card>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function RewardsPanel() {
  const [facilities, setFacilities] = useState<{ id: number; code: string; name: string }[]>([]);

  // Load facilities once on mount. Must be useEffect (a side effect), not useState's lazy
  // initializer — the initializer's return value is the state, and it double-fires under StrictMode.
  useEffect(() => {
    trpc.facility.list
      .query()
      .then((fs) => setFacilities(fs.map((f) => ({ id: f.id, code: f.code, name: f.name }))))
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  }, []);

  return (
    <Stack>
      <PendingReviewCard />
      <GiftCreateCard facilities={facilities} />
    </Stack>
  );
}
