import { useCallback, useEffect, useState } from 'react';
import { trpc, API_URL, Chatter, notifyError, notifySuccess } from '@cmc/ui';
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
  const [cancelTarget, setCancelTarget] = useState<Receipt | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [detailTarget, setDetailTarget] = useState<Receipt | null>(null);

  const studentName = useCallback(
    (id: string) => students.find((s) => s.id === id)?.fullName ?? id.slice(0, 8),
    [students],
  );
  const courseName = useCallback(
    (id: string) => courses.find((c) => c.id === id)?.code ?? id.slice(0, 8),
    [courses],
  );

  const loadReceipts = useCallback(() => {
    trpc.finance.receiptList
      .query()
      .then(setReceipts)
      .catch((e) => notifyError(e, 'Không tải được danh sách phiếu thu'));
  }, []);
  useEffect(() => {
    trpc.student.list
      .query()
      .then(setStudents)
      .catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));
    trpc.course.list
      .query()
      .then(setCourses)
      .catch((e) => notifyError(e, 'Không tải được danh sách khóa học'));
    loadReceipts();
  }, [loadReceipts]);

  async function createDraft() {
    const student = students.find((s) => s.id === studentId);
    if (!student || !courseId) {
      notifyError('Vui lòng chọn học sinh và khóa học.', 'Thiếu thông tin');
      return;
    }
    setBusy(true);
    try {
      const r = await trpc.finance.receiptCreate.mutate({
        facilityId: student.facilityId,
        studentId: student.id,
        courseId,
        yearsPrepaid: Number(years),
        period: period.trim() || undefined,
        voucherCode: voucherCode.trim() || undefined,
      });
      notifySuccess(
        `Đã tạo phiếu nháp: gốc ${vnd(r.grossAmount)} → giảm ${r.effectiveDiscountPercent}% → còn ${vnd(r.netAmount)}.`,
        'Tạo phiếu thu thành công',
      );
      setStudentId(null);
      setCourseId(null);
      setYears('1');
      setVoucherCode('');
      setPeriod('');
      loadReceipts();
    } catch (e) {
      notifyError(e, 'Tạo phiếu thu thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    try {
      const r = await trpc.finance.receiptApprove.mutate({ id });
      notifySuccess(`Đã duyệt phiếu ${r.code}.`);
      loadReceipts();
    } catch (e) {
      notifyError(e, 'Duyệt phiếu thu thất bại');
    }
  }

  async function markSent(id: string) {
    try {
      await trpc.finance.receiptMarkSent.mutate({ id });
      notifySuccess('Đã đánh dấu gửi phiếu.');
      loadReceipts();
    } catch (e) {
      notifyError(e, 'Đánh dấu gửi phiếu thất bại');
    }
  }

  async function reconcile(id: string) {
    try {
      await trpc.finance.receiptReconcile.mutate({ id });
      notifySuccess('Đã đối soát phiếu.');
      loadReceipts();
    } catch (e) {
      notifyError(e, 'Đối soát phiếu thất bại');
    }
  }

  function printReceipt(id: string) {
    window.open(`${API_URL}/files/receipt/${id}`, '_blank', 'noopener');
  }

  async function doCancel() {
    if (!cancelTarget || !cancelReason.trim()) return;
    try {
      await trpc.finance.receiptCancel.mutate({ id: cancelTarget.id, reason: cancelReason.trim() });
      notifySuccess('Đã hủy phiếu thu.');
      setCancelTarget(null);
      setCancelReason('');
      loadReceipts();
    } catch (e) {
      notifyError(e, 'Hủy phiếu thu thất bại');
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
                        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setDetailTarget(r)}>
                          Nhật ký
                        </Button>
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

      <Modal
        opened={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title={`Phiếu thu ${detailTarget?.code ?? 'nháp'}`}
        size="lg"
      >
        {detailTarget && (
          <Chatter entityType="receipt" entityId={detailTarget.id} />
        )}
      </Modal>
    </Stack>
  );
}
