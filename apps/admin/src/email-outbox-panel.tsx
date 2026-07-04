import { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess, required, StatusBadge, type StatusDef } from '@cmc/ui';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import {
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
  Title,
  Tooltip,
} from '@mantine/core';
import { IconRefresh, IconSend } from '@tabler/icons-react';

type OutboxRow = Awaited<ReturnType<typeof trpc.email.outboxList.query>>[number];

const STATUS_OPTIONS = [
  { value: 'queued', label: 'Đang chờ' },
  { value: 'sending', label: 'Đang gửi' },
  { value: 'sent', label: 'Đã gửi' },
  { value: 'failed', label: 'Thất bại' },
  { value: 'skipped', label: 'Bỏ qua' },
];

// Preserves original color semantics 1:1: gray→draft, blue→info, green→active, red→rejected,
// yellow→pending.
const OUTBOX_STATUS_MAP: Record<string, StatusDef> = {
  queued: { label: 'Đang chờ', tone: 'draft' },
  sending: { label: 'Đang gửi', tone: 'info' },
  sent: { label: 'Đã gửi', tone: 'active' },
  failed: { label: 'Thất bại', tone: 'rejected' },
  skipped: { label: 'Bỏ qua', tone: 'pending' },
};

// ─── Send receipt by email ──────────────────────────────────────────────────────
// Keyed by receiptId — deliberately kept out of finance-panel.tsx (owned by another phase) so
// this panel can add the send action without touching that file.

function SendReceiptEmailCard() {
  const [opened, { open, close }] = useDisclosure(false);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { receiptId: '', to: '' },
    validate: {
      receiptId: required('Nhập mã phiếu thu'),
    },
  });

  async function send(values: typeof form.values) {
    setBusy(true);
    try {
      const r = await trpc.finance.sendReceiptEmail.mutate({
        receiptId: values.receiptId.trim(),
        to: values.to.trim() || undefined,
      });
      notifySuccess(`Đã xếp hàng gửi phiếu thu tới ${r.to}`);
      close();
      form.reset();
    } catch (e) {
      notifyError(e, 'Gửi phiếu thu qua email thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Group justify="flex-end">
        <Button leftSection={<IconSend size={14} />} onClick={open}>
          Gửi phiếu thu qua email
        </Button>
      </Group>

      <Modal opened={opened} onClose={close} title="Gửi phiếu thu qua email" radius="xl" centered>
        <form onSubmit={form.onSubmit(send)}>
          <Stack>
            <TextInput
              label="Mã phiếu thu (ID)"
              placeholder="UUID phiếu thu"
              withAsterisk
              {...form.getInputProps('receiptId')}
            />
            <TextInput
              label="Email người nhận (tùy chọn — mặc định lấy theo phiếu)"
              placeholder="phuhuynh@example.com"
              {...form.getInputProps('to')}
            />
            <Text size="xs" c="dimmed">
              Bỏ trống email để hệ thống tự lấy theo phiếu thu (email học sinh mới hoặc email phụ huynh
              liên kết). Nhập email khác để gửi lại tới địa chỉ đã sửa — không bị chặn bởi lượt gửi trước.
            </Text>
            <Group justify="flex-end" mt="xs">
              <Button variant="subtle" onClick={close}>Hủy</Button>
              <Button type="submit" variant="filled" radius={9999} loading={busy}>Gửi</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

// ─── Outbox table ────────────────────────────────────────────────────────────────

function OutboxTable() {
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [status, setStatus] = useState<string | null>('failed');
  const [load, setLoad] = useState<'loading' | 'error' | 'ok'>('loading');

  const loadRows = useCallback(() => {
    setLoad('loading');
    trpc.email.outboxList
      .query(status ? { status: status as OutboxRow['status'] } : undefined)
      .then((r) => {
        setRows(r);
        setLoad('ok');
      })
      .catch((e: unknown) => {
        notifyError(e, 'Không tải được hộp thư gửi đi');
        setLoad('error');
      });
  }, [status]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  async function retry(id: string) {
    try {
      await trpc.email.outboxRetry.mutate({ id });
      notifySuccess('Đã xếp hàng gửi lại');
      loadRows();
    } catch (e) {
      notifyError(e, 'Gửi lại thất bại');
    }
  }

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={6}>Hộp thư gửi đi</Title>
        <Group gap="sm">
          <Select
            placeholder="Tất cả trạng thái"
            data={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
            clearable
            w={180}
            size="xs"
          />
          <Button variant="subtle" size="xs" leftSection={<IconRefresh size={13} />} onClick={loadRows}>
            Làm mới
          </Button>
        </Group>
      </Group>

      {load === 'loading' && (
        <Text c="dimmed" ta="center" py="xl">
          Đang tải...
        </Text>
      )}
      {load === 'ok' && rows.length === 0 && (
        <Text c="dimmed" size="sm">
          Không có email nào.
        </Text>
      )}
      {load === 'ok' && rows.length > 0 && (
        <Table fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Người nhận</Table.Th>
              <Table.Th>Loại</Table.Th>
              <Table.Th>Trạng thái</Table.Th>
              <Table.Th>Số lần thử</Table.Th>
              <Table.Th>Lỗi gần nhất</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{r.toAddress}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Text size="sm">{r.templateKind}</Text>
                    {r.isSecret && (
                      <Badge size="xs" color="orange" variant="light">
                        bí mật
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={r.status} map={OUTBOX_STATUS_MAP} pill />
                </Table.Td>
                <Table.Td>{r.attempts}</Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed" lineClamp={2} maw={280}>
                    {r.lastError ?? '—'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {r.status === 'failed' && (
                    <Tooltip
                      label={
                        r.isSecret
                          ? 'Email chứa bí mật — dùng "Cấp lại" ở màn hồ sơ để phát hành lại'
                          : 'Gửi lại email này'
                      }
                    >
                      <Button
                        size="compact-xs"
                        variant="light"
                        disabled={r.isSecret}
                        onClick={() => retry(r.id)}
                      >
                        Gửi lại
                      </Button>
                    </Tooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function EmailOutboxPanel() {
  return (
    <Stack>
      <SendReceiptEmailCard />
      <OutboxTable />
    </Stack>
  );
}
