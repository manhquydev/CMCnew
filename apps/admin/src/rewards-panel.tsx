import { useState, useEffect, useCallback } from 'react';
import { trpc, notifyError, notifySuccess, StatusBadge, InitialsAvatar, type StatusDef } from '@cmc/ui';
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

type GiftRow = Awaited<ReturnType<typeof trpc.rewards.giftListAdmin.query>>[number];
type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];

const GIFT_STATUS_MAP: Record<string, StatusDef> = {
  active: { label: 'Đang hoạt động', tone: 'active' },
  archived: { label: 'Đã lưu trữ', tone: 'inactive' },
};

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

// ─── Gift list / edit / archive / stock adjust ─────────────────────────────────

function GiftEditModal({
  gift,
  onClose,
  onSaved,
}: {
  gift: GiftRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      name: gift?.name ?? '',
      starsRequired: gift?.starsRequired ?? 1,
      program: gift?.program ?? '',
      imageUrl: gift?.imageUrl ?? '',
    },
    validate: {
      name: (v) => (!v.trim() ? 'Nhập tên quà' : null),
      starsRequired: (v) => (v <= 0 ? 'Số sao phải > 0' : null),
    },
  });

  useEffect(() => {
    form.setValues({
      name: gift?.name ?? '',
      starsRequired: gift?.starsRequired ?? 1,
      program: gift?.program ?? '',
      imageUrl: gift?.imageUrl ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gift?.id]);

  async function save(values: typeof form.values) {
    if (!gift) return;
    setBusy(true);
    try {
      await trpc.rewards.giftUpdate.mutate({
        id: gift.id,
        name: values.name.trim(),
        starsRequired: values.starsRequired,
        program: (values.program || undefined) as 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE' | undefined,
        imageUrl: values.imageUrl.trim() || undefined,
      });
      notifySuccess('Đã cập nhật quà');
      onSaved();
      onClose();
    } catch (e) {
      notifyError(e, 'Cập nhật quà thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={gift !== null} onClose={onClose} title="Sửa quà tặng" centered>
      <form onSubmit={form.onSubmit(save)}>
        <Stack>
          <TextInput label="Tên quà" withAsterisk {...form.getInputProps('name')} />
          <NumberInput label="Số sao cần đổi" withAsterisk min={1} {...form.getInputProps('starsRequired')} />
          <Select label="Chương trình (tùy chọn)" data={PROGRAMS} clearable {...form.getInputProps('program')} />
          <TextInput label="URL hình ảnh (tùy chọn)" placeholder="https://..." {...form.getInputProps('imageUrl')} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={busy}>
              Lưu
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function GiftListCard() {
  const [gifts, setGifts] = useState<GiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<GiftRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stockDrafts, setStockDrafts] = useState<Record<string, number | ''>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await trpc.rewards.giftListAdmin.query();
      setGifts(list);
    } catch (e) {
      notifyError(e, 'Không tải được danh sách quà');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function archive(gift: GiftRow) {
    setBusyId(gift.id);
    try {
      await trpc.rewards.giftArchive.mutate({ id: gift.id });
      notifySuccess(`Đã lưu trữ "${gift.name}"`);
      await load();
    } catch (e) {
      notifyError(e, 'Lưu trữ quà thất bại');
    } finally {
      setBusyId(null);
    }
  }

  async function adjustStock(gift: GiftRow) {
    const draft = stockDrafts[gift.id];
    if (draft === '' || draft === undefined) return;
    setBusyId(gift.id);
    try {
      await trpc.rewards.stockAdjust.mutate({ id: gift.id, stock: draft });
      notifySuccess(`Đã cập nhật tồn kho "${gift.name}"`);
      await load();
    } catch (e) {
      notifyError(e, 'Điều chỉnh tồn kho thất bại');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Title order={5}>Danh sách quà tặng</Title>
        <Button variant="subtle" size="xs" onClick={() => void load()} disabled={loading}>
          Tải lại
        </Button>
      </Group>

      {loading ? (
        <Group justify="center" py="lg">
          <Loader size="sm" />
        </Group>
      ) : gifts.length === 0 ? (
        <Text c="dimmed" py="md" ta="center">
          Chưa có quà tặng nào.
        </Text>
      ) : (
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tên quà</Table.Th>
              <Table.Th>Sao</Table.Th>
              <Table.Th>Trạng thái</Table.Th>
              <Table.Th>Tồn kho</Table.Th>
              <Table.Th ta="right">Hành động</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {gifts.map((g) => (
              <Table.Tr key={g.id}>
                <Table.Td>{g.name}</Table.Td>
                <Table.Td>
                  <Badge color="yellow" variant="light">
                    {g.starsRequired} ★
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={g.isActive ? 'active' : 'archived'} map={GIFT_STATUS_MAP} pill />
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <NumberInput
                      size="xs"
                      w={90}
                      placeholder={g.stock === -1 ? 'Vô hạn' : String(g.stock)}
                      value={stockDrafts[g.id] ?? ''}
                      onChange={(v) => setStockDrafts((prev) => ({ ...prev, [g.id]: v as number | '' }))}
                    />
                    <Button size="xs" variant="light" loading={busyId === g.id} onClick={() => void adjustStock(g)}>
                      Đặt
                    </Button>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button size="xs" variant="default" onClick={() => setEditTarget(g)}>
                      Sửa
                    </Button>
                    {g.isActive && (
                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        loading={busyId === g.id}
                        onClick={() => void archive(g)}
                      >
                        Lưu trữ
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <GiftEditModal gift={editTarget} onClose={() => setEditTarget(null)} onSaved={load} />
    </Card>
  );
}

// ─── Manual star adjustment ─────────────────────────────────────────────────────

function StarAdjustCard({ students }: { students: StudentT[] }) {
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { studentId: '', amount: 0, reason: '' },
    validate: {
      studentId: (v) => (!v ? 'Chọn học sinh' : null),
      amount: (v) => (v === 0 ? 'Số sao phải khác 0' : null),
      reason: (v) => (!v.trim() ? 'Nhập lý do' : null),
    },
  });

  async function adjust(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.rewards.starAdjust.mutate({
        studentId: values.studentId,
        amount: values.amount,
        reason: values.reason.trim(),
      });
      notifySuccess(`Đã điều chỉnh ${values.amount > 0 ? '+' : ''}${values.amount} sao`);
      form.reset();
    } catch (e) {
      notifyError(e, 'Điều chỉnh sao thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Điều chỉnh sao thủ công
      </Title>
      <form onSubmit={form.onSubmit(adjust)}>
        <Stack>
          <Select
            label="Học sinh"
            withAsterisk
            searchable
            data={students.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
            {...form.getInputProps('studentId')}
          />
          <NumberInput
            label="Số sao (+/-)"
            withAsterisk
            allowDecimal={false}
            {...form.getInputProps('amount')}
          />
          <Textarea label="Lý do" withAsterisk autosize minRows={2} {...form.getInputProps('reason')} />
          <Group mt="xs">
            <Button type="submit" loading={busy}>
              Điều chỉnh
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
  // Rewards approved this session, awaiting physical delivery. There is no staff-facing
  // "approved" list query, so this is built up client-side from approve() as it happens.
  const [awaitingDelivery, setAwaitingDelivery] = useState<PendingReward[]>([]);
  const [deliveringId, setDeliveringId] = useState<string | null>(null);

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
      setAwaitingDelivery((prev) => [...prev, r]);
      await load();
    } catch (e) {
      notifyError(e, 'Duyệt đổi quà thất bại');
      // A conflict usually means the row was already handled elsewhere — resync.
      await load();
    } finally {
      setActingId(null);
    }
  }

  async function markDelivered(r: PendingReward) {
    setDeliveringId(r.id);
    try {
      await trpc.rewards.markDelivered.mutate({ id: r.id });
      notifySuccess(`Đã đánh dấu "${r.giftName}" là đã giao`);
      setAwaitingDelivery((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      notifyError(e, 'Đánh dấu đã giao thất bại');
    } finally {
      setDeliveringId(null);
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
                  <Group gap={8} wrap="nowrap">
                    <InitialsAvatar name={r.studentName} size={22} />
                    <div>
                      <Text fw={500}>{r.studentName}</Text>
                      <Text size="xs" c="dimmed">
                        {r.studentCode}
                      </Text>
                    </div>
                  </Group>
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

      {awaitingDelivery.length > 0 && (
        <>
          <Title order={5} mt="lg" mb="xs">
            Đơn đã duyệt — chờ giao quà
          </Title>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Học sinh</Table.Th>
                <Table.Th>Quà</Table.Th>
                <Table.Th>Sao</Table.Th>
                <Table.Th ta="right">Hành động</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {awaitingDelivery.map((r) => (
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
                  <Table.Td ta="right">
                    <Button
                      size="xs"
                      color="teal"
                      variant="light"
                      loading={deliveringId === r.id}
                      onClick={() => void markDelivered(r)}
                    >
                      Đánh dấu đã giao
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Card>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function RewardsPanel() {
  const [facilities, setFacilities] = useState<{ id: number; code: string; name: string }[]>([]);
  const [students, setStudents] = useState<StudentT[]>([]);

  // Load facilities/students once on mount. Must be useEffect (a side effect), not useState's
  // lazy initializer — the initializer's return value is the state, and it double-fires under
  // StrictMode.
  useEffect(() => {
    trpc.facility.list
      .query()
      .then((fs) => setFacilities(fs.map((f) => ({ id: f.id, code: f.code, name: f.name }))))
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
    trpc.student.list
      .query()
      .then(setStudents)
      .catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));
  }, []);

  return (
    <Stack>
      <PendingReviewCard />
      <GiftListCard />
      <GiftCreateCard facilities={facilities} />
      <StarAdjustCard students={students} />
    </Stack>
  );
}
