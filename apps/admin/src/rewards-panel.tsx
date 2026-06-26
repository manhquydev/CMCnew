import { useState } from 'react';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';

// ─── Gap notice ───────────────────────────────────────────────────────────────
// Backend gap: no `rewards.pendingList` (or equivalent staff-accessible query)
// to enumerate pending redemptions. `rewards.gifts` uses lmsProcedure and is
// not callable from the admin session. Until a `rewards.pendingList` procedure
// is added to the API, operators must obtain the redemption ID from DB tooling.
// Tracked as backend gap; see report.

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

// ─── Reward review ────────────────────────────────────────────────────────────
// Requires manual redemption ID until `rewards.pendingList` is implemented.

function RewardReviewCard() {
  const [id, setId] = useState('');
  const [decision, setDecision] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!id.trim() || !decision) return;
    setBusy(true);
    try {
      await trpc.rewards.review.mutate({
        id: id.trim(),
        decision: decision as 'approved' | 'rejected',
        reason: reason.trim() || undefined,
      });
      notifySuccess(decision === 'approved' ? 'Đã duyệt đổi quà' : 'Đã từ chối đổi quà (hoàn sao)');
      setId('');
      setDecision(null);
      setReason('');
    } catch (e) {
      notifyError(e, 'Xử lý đổi quà thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="xs">
        Duyệt đổi quà
      </Title>
      {/* Gap notice shown inline so operators are aware */}
      <Alert color="yellow" mb="md" title="Chú ý: thiếu danh sách pending">
        Backend chưa có `rewards.pendingList`. Nhập ID đơn đổi quà thủ công (lấy từ DB/log) cho đến
        khi thủ tục được bổ sung.
      </Alert>
      <Stack>
        <TextInput
          label="ID đơn đổi quà (UUID)"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={id}
          onChange={(e) => setId(e.currentTarget.value)}
        />
        <Select
          label="Quyết định"
          data={[
            { value: 'approved', label: 'Duyệt' },
            { value: 'rejected', label: 'Từ chối (hoàn sao)' },
          ]}
          value={decision}
          onChange={setDecision}
        />
        {decision === 'rejected' && (
          <Textarea
            label="Lý do từ chối"
            autosize
            minRows={2}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
        )}
        <Group>
          <Button
            disabled={!id.trim() || !decision}
            loading={busy}
            color={decision === 'rejected' ? 'red' : 'teal'}
            onClick={() => void submit()}
          >
            Xác nhận
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function RewardsPanel() {
  const [facilities, setFacilities] = useState<{ id: number; code: string; name: string }[]>([]);

  // Load facilities once on mount
  useState(() => {
    trpc.facility.list
      .query()
      .then((fs) => setFacilities(fs.map((f) => ({ id: f.id, code: f.code, name: f.name }))))
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  });

  return (
    <Stack>
      <Text size="xs" c="dimmed">
        Backend gap: cần bổ sung thủ tục <code>rewards.pendingList</code> để liệt kê đơn đổi quà
        đang chờ xử lý.
      </Text>
      <GiftCreateCard facilities={facilities} />
      <RewardReviewCard />
    </Stack>
  );
}
