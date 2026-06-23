import { useCallback, useEffect, useState } from 'react';
import { trpc, API_URL } from '@cmc/ui';
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

type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type CourseT = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type Receipt = Awaited<ReturnType<typeof trpc.finance.receiptList.query>>[number];

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
const YEARS = [
  { value: '1', label: '1 năm (−15%)' },
  { value: '2', label: '2 năm (−20%)' },
  { value: '3', label: '3 năm (−30%)' },
];
const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Nháp', color: 'gray' },
  approved: { label: 'Đã duyệt', color: 'teal' },
  sent: { label: 'Đã gửi', color: 'blue' },
  reconciled: { label: 'Đã đối soát', color: 'green' },
  cancelled: { label: 'Đã hủy', color: 'red' },
};

export function FinancePanel() {
  const [students, setStudents] = useState<StudentT[]>([]);
  const [courses, setCourses] = useState<CourseT[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [years, setYears] = useState<string>('1');
  const [voucherCode, setVoucherCode] = useState('');
  const [period, setPeriod] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Receipt | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const studentName = useCallback(
    (id: string) => students.find((s) => s.id === id)?.fullName ?? id.slice(0, 8),
    [students],
  );
  const courseName = useCallback(
    (id: string) => courses.find((c) => c.id === id)?.code ?? id.slice(0, 8),
    [courses],
  );

  const loadReceipts = useCallback(() => {
    trpc.finance.receiptList.query().then(setReceipts).catch(() => setReceipts([]));
  }, []);
  useEffect(() => {
    trpc.student.list.query().then(setStudents).catch(() => setStudents([]));
    trpc.course.list.query().then(setCourses).catch(() => setCourses([]));
    loadReceipts();
  }, [loadReceipts]);

  async function createDraft() {
    const student = students.find((s) => s.id === studentId);
    if (!student || !courseId) {
      setMsg({ kind: 'err', text: 'Chọn học sinh và khóa học.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await trpc.finance.receiptCreate.mutate({
        facilityId: student.facilityId,
        studentId: student.id,
        courseId,
        yearsPrepaid: Number(years),
        period: period.trim() || undefined,
        voucherCode: voucherCode.trim() || undefined,
      });
      setMsg({
        kind: 'ok',
        text: `Đã tạo phiếu nháp: gốc ${vnd(r.grossAmount)} → giảm ${r.effectiveDiscountPercent}% → còn ${vnd(r.netAmount)}.`,
      });
      setVoucherCode('');
      setPeriod('');
      loadReceipts();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setMsg(null);
    try {
      const r = await trpc.finance.receiptApprove.mutate({ id });
      setMsg({ kind: 'ok', text: `Đã duyệt phiếu ${r.code}.` });
      loadReceipts();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    }
  }

  async function markSent(id: string) {
    setMsg(null);
    try {
      await trpc.finance.receiptMarkSent.mutate({ id });
      setMsg({ kind: 'ok', text: 'Đã đánh dấu gửi phiếu.' });
      loadReceipts();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    }
  }
  async function reconcile(id: string) {
    setMsg(null);
    try {
      await trpc.finance.receiptReconcile.mutate({ id });
      setMsg({ kind: 'ok', text: 'Đã đối soát phiếu.' });
      loadReceipts();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    }
  }
  function printReceipt(id: string) {
    window.open(`${API_URL}/files/receipt/${id}`, '_blank', 'noopener');
  }

  async function doCancel() {
    if (!cancelTarget || !cancelReason.trim()) return;
    try {
      await trpc.finance.receiptCancel.mutate({ id: cancelTarget.id, reason: cancelReason.trim() });
      setMsg({ kind: 'ok', text: 'Đã hủy phiếu thu.' });
      setCancelTarget(null);
      setCancelReason('');
      loadReceipts();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    }
  }

  return (
    <Stack>
      <Card withBorder>
        <Title order={5} mb="sm">
          Lập phiếu thu
        </Title>
        <Group grow align="flex-end">
          <Select
            label="Học sinh"
            searchable
            placeholder={students.length ? 'Chọn học sinh' : 'Chưa có học sinh'}
            data={students.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
            value={studentId}
            onChange={setStudentId}
          />
          <Select
            label="Khóa học"
            searchable
            placeholder={courses.length ? 'Chọn khóa' : 'Chưa có khóa'}
            data={courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
            value={courseId}
            onChange={setCourseId}
          />
        </Group>
        <Group grow align="flex-end" mt="sm">
          <Select
            label="Đóng trước"
            data={YEARS}
            value={years}
            onChange={(v) => v && setYears(v)}
            allowDeselect={false}
          />
          <TextInput
            label="Mã voucher (tùy chọn)"
            placeholder="vd SAVE20"
            value={voucherCode}
            onChange={(e) => setVoucherCode(e.currentTarget.value)}
          />
          <TextInput
            label="Kỳ (tùy chọn)"
            placeholder="vd 2026-HK1"
            value={period}
            onChange={(e) => setPeriod(e.currentTarget.value)}
          />
        </Group>
        <Text size="xs" c="dimmed" mt={6}>
          Giảm theo số năm cộng voucher, tổng tối đa 35%. Giá lấy theo bảng giá hiệu lực ngày lập phiếu.
        </Text>
        <Group mt="md">
          <Button onClick={createDraft} loading={busy}>
            Tạo phiếu nháp
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
          Phiếu thu gần đây
        </Title>
        {receipts.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có phiếu thu.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Mã</Table.Th>
                <Table.Th>Học sinh</Table.Th>
                <Table.Th>Khóa</Table.Th>
                <Table.Th>Giảm</Table.Th>
                <Table.Th>Thành tiền</Table.Th>
                <Table.Th>Trạng thái</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {receipts.map((r) => {
                const st = STATUS[r.status] ?? { label: r.status, color: 'gray' };
                return (
                  <Table.Tr key={r.id}>
                    <Table.Td>{r.code ?? '—'}</Table.Td>
                    <Table.Td>{studentName(r.studentId)}</Table.Td>
                    <Table.Td>{courseName(r.courseId)}</Table.Td>
                    <Table.Td>{r.effectiveDiscountPercent}%</Table.Td>
                    <Table.Td>{vnd(r.netAmount)}</Table.Td>
                    <Table.Td>
                      <Badge color={st.color}>{st.label}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end">
                        {r.status === 'draft' && (
                          <Button size="compact-xs" onClick={() => approve(r.id)}>
                            Duyệt
                          </Button>
                        )}
                        {r.status === 'approved' && (
                          <Button size="compact-xs" variant="light" onClick={() => markSent(r.id)}>
                            Gửi
                          </Button>
                        )}
                        {(r.status === 'approved' || r.status === 'sent') && (
                          <Button size="compact-xs" variant="light" color="green" onClick={() => reconcile(r.id)}>
                            Đối soát
                          </Button>
                        )}
                        {r.code && (
                          <Button size="compact-xs" variant="subtle" onClick={() => printReceipt(r.id)}>
                            In
                          </Button>
                        )}
                        {(r.status === 'draft' || r.status === 'approved') && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="red"
                            onClick={() => setCancelTarget(r)}
                          >
                            Hủy
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

      <Modal opened={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Hủy phiếu thu">
        <Stack>
          <Text size="sm">
            Hủy phiếu {cancelTarget?.code ?? 'nháp'} ({cancelTarget ? vnd(cancelTarget.netAmount) : ''})? Voucher
            (nếu có) sẽ được hoàn lượt.
          </Text>
          <Textarea
            label="Lý do hủy"
            autosize
            minRows={2}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCancelTarget(null)}>
              Đóng
            </Button>
            <Button color="red" disabled={!cancelReason.trim()} onClick={doCancel}>
              Xác nhận hủy
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
