import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '@mantine/hooks';
import { normalizeContactPhone } from '@cmc/auth/phone';
import {
  trpc,
  API_URL,
  Chatter,
  notifyError,
  notifySuccess,
  FacilityPicker,
  StatusBadge,
  InitialsAvatar,
  toApiDate,
  parseApiDate,
  type StatusDef,
} from '@cmc/ui';
import {
  Alert,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Pagination,
  Radio,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconRefresh } from '@tabler/icons-react';
import { DISCOUNT_CAP_PERCENT } from '@cmc/domain-finance';

type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type CourseT = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Receipt = Awaited<ReturnType<typeof trpc.finance.receiptList.query>>[number];
type CoursePrice = Awaited<ReturnType<typeof trpc.finance.priceList.query>>[number];
type Voucher = Awaited<ReturnType<typeof trpc.finance.voucherList.query>>[number];
type DiscountTierListResult = Awaited<ReturnType<typeof trpc.finance.discountTierList.query>>;
type DiscountTier = DiscountTierListResult['tiers'][number];

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
const YEARS = [
  { value: '1', label: '1 năm (−15%)' },
  { value: '2', label: '2 năm (−20%)' },
  { value: '3', label: '3 năm (−30%)' },
];
const STATUS: Record<string, StatusDef> = {
  draft: { label: 'Nháp', tone: 'draft' },
  approved: { label: 'Đã duyệt', tone: 'active' },
  sent: { label: 'Đã gửi', tone: 'info' },
  reconciled: { label: 'Đã đối soát', tone: 'active' },
  cancelled: { label: 'Đã hủy', tone: 'rejected' },
};

const RECEIPT_PAGE_SIZE = 20;

// ─── Course Price Card ────────────────────────────────────────────────────────

function CoursePriceCard({ courses, facilities }: { courses: CourseT[]; facilities: Facility[] }) {
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [prices, setPrices] = useState<CoursePrice[]>([]);
  const [priceLoad, setPriceLoad] = useState<'idle' | 'loading' | 'error'>('idle');
  const [priceError, setPriceError] = useState('');
  const [busy, setBusy] = useState(false);

  const priceForm = useForm({
    initialValues: {
      facilityId: '',
      courseId: '',
      amount: 0,
      effectiveFrom: '',
    },
    validate: {
      facilityId: (v) => (!v ? 'Chọn cơ sở' : null),
      courseId: (v) => (!v ? 'Chọn khóa học' : null),
      amount: (v) => (v <= 0 ? 'Giá phải > 0' : null),
      effectiveFrom: (v) =>
        !v.match(/^\d{4}-\d{2}-\d{2}$/) ? 'Nhập ngày hợp lệ (YYYY-MM-DD)' : null,
    },
  });

  const loadPrices = useCallback((courseId: string) => {
    setPriceLoad('loading');
    setPriceError('');
    trpc.finance.priceList
      .query({ courseId })
      .then((rows) => {
        setPrices(rows);
        setPriceLoad('idle');
      })
      .catch((e: unknown) => {
        setPriceError(e instanceof Error ? e.message : 'Lỗi tải bảng giá');
        setPriceLoad('error');
      });
  }, []);

  function handleCourseSelect(v: string | null) {
    setSelectedCourseId(v);
    setPrices([]);
    if (v) loadPrices(v);
  }

  async function createPrice(values: typeof priceForm.values) {
    setBusy(true);
    try {
      await trpc.finance.priceCreate.mutate({
        facilityId: Number(values.facilityId),
        courseId: values.courseId,
        amount: values.amount,
        effectiveFrom: values.effectiveFrom,
      });
      notifySuccess(`Đã tạo bảng giá ${vnd(values.amount)}/năm từ ${values.effectiveFrom}`);
      priceForm.reset();
      if (values.courseId) loadPrices(values.courseId);
    } catch (e) {
      notifyError(e, 'Tạo bảng giá thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Bảng giá khóa học
      </Title>

      {/* Create form */}
      <form onSubmit={priceForm.onSubmit(createPrice)}>
        <Stack gap="sm">
          <Group grow align="flex-end">
            <Select
              label="Cơ sở"
              withAsterisk
              data={facilities.map((f) => ({
                value: String(f.id),
                label: `${f.code} — ${f.name}`,
              }))}
              {...priceForm.getInputProps('facilityId')}
            />
            <Select
              label="Khóa học"
              withAsterisk
              searchable
              data={courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
              value={priceForm.values.courseId || null}
              onChange={(v) => {
                priceForm.setFieldValue('courseId', v ?? '');
              }}
              error={priceForm.errors.courseId}
            />
          </Group>
          <Group grow align="flex-end">
            <NumberInput
              label="Giá (VNĐ/năm)"
              withAsterisk
              min={0}
              step={100000}
              {...priceForm.getInputProps('amount')}
            />
            <DateInput
              label="Hiệu lực từ"
              withAsterisk
              valueFormat="DD/MM/YYYY"
              value={parseApiDate(priceForm.values.effectiveFrom)}
              onChange={(d) => priceForm.setFieldValue('effectiveFrom', toApiDate(d) ?? '')}
              error={priceForm.errors.effectiveFrom}
            />
          </Group>
          <Group>
            <Button type="submit" loading={busy}>
              Tạo giá mới
            </Button>
          </Group>
        </Stack>
      </form>

      {/* Price list for a selected course */}
      <Stack gap="xs" mt="md">
        <Group align="flex-end">
          <Select
            label="Xem lịch sử giá"
            placeholder="Chọn khóa học"
            data={courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
            value={selectedCourseId}
            onChange={handleCourseSelect}
            searchable
            clearable
            w={280}
          />
          {selectedCourseId && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconRefresh size={13} />}
              onClick={() => loadPrices(selectedCourseId)}
            >
              Làm mới
            </Button>
          )}
        </Group>
        {priceLoad === 'loading' && (
          <Text c="dimmed" size="sm">
            Đang tải...
          </Text>
        )}
        {priceLoad === 'error' && (
          <Alert color="red" title="Lỗi">
            {priceError}
          </Alert>
        )}
        {priceLoad === 'idle' && selectedCourseId && prices.length === 0 && (
          <Text c="dimmed" size="sm">
            Chưa có bảng giá cho khóa này.
          </Text>
        )}
        {prices.length > 0 && (
          <Table striped withTableBorder={false} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Hiệu lực từ</Table.Th>
                <Table.Th>Giá (VNĐ/năm)</Table.Th>
                <Table.Th>Cơ sở</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {prices.map((p) => {
                const fac = facilities.find((f) => f.id === p.facilityId);
                return (
                  <Table.Tr key={p.id}>
                    <Table.Td>{new Date(p.effectiveFrom).toLocaleDateString('vi-VN')}</Table.Td>
                    <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {vnd(p.amount)}
                    </Table.Td>
                    <Table.Td>{fac?.code ?? `#${p.facilityId}`}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}

// ─── Voucher Card ─────────────────────────────────────────────────────────────

function VoucherCard({ facilities }: { facilities: Facility[] }) {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [vLoad, setVLoad] = useState<'idle' | 'loading' | 'error'>('idle');
  const [vError, setVError] = useState('');
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: {
      facilityId: '',
      code: '',
      percent: 10,
      maxUses: 1,
      validFrom: '',
      validTo: '',
    },
    validate: {
      facilityId: (v) => (!v ? 'Chọn cơ sở' : null),
      code: (v) => (!v.trim() ? 'Nhập mã voucher' : null),
      percent: (v) => (v < 1 || v > 100 ? 'Phần trăm 1–100' : null),
      maxUses: (v) => (v < 1 ? 'Tối thiểu 1 lượt' : null),
    },
  });

  const loadVouchers = useCallback((fid: string) => {
    setVLoad('loading');
    setVError('');
    trpc.finance.voucherList
      .query({ facilityId: Number(fid) })
      .then((rows) => {
        setVouchers(rows);
        setVLoad('idle');
      })
      .catch((e: unknown) => {
        setVError(e instanceof Error ? e.message : 'Lỗi tải voucher');
        setVLoad('error');
      });
  }, []);

  function handleFacilitySelect(v: string | null) {
    setFacilityId(v);
    setVouchers([]);
    if (v) loadVouchers(v);
  }

  async function createVoucher(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.finance.voucherCreate.mutate({
        facilityId: Number(values.facilityId),
        code: values.code.trim().toUpperCase(),
        percent: values.percent,
        maxUses: values.maxUses,
        validFrom: values.validFrom || undefined,
        validTo: values.validTo || undefined,
      });
      notifySuccess(`Đã tạo voucher ${values.code.toUpperCase()} −${values.percent}%`);
      form.reset();
      if (facilityId) loadVouchers(facilityId);
    } catch (e) {
      notifyError(e, 'Tạo voucher thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Voucher giảm giá
      </Title>
      <form onSubmit={form.onSubmit(createVoucher)}>
        <Stack gap="sm">
          <Group grow align="flex-end">
            <Select
              label="Cơ sở"
              withAsterisk
              data={facilities.map((f) => ({
                value: String(f.id),
                label: `${f.code} — ${f.name}`,
              }))}
              {...form.getInputProps('facilityId')}
            />
            <TextInput
              label="Mã voucher"
              withAsterisk
              placeholder="VD: SAVE20"
              {...form.getInputProps('code')}
            />
          </Group>
          <Group grow align="flex-end">
            <NumberInput
              label="Giảm (%)"
              withAsterisk
              min={1}
              max={100}
              {...form.getInputProps('percent')}
            />
            <NumberInput
              label="Số lượt tối đa"
              withAsterisk
              min={1}
              {...form.getInputProps('maxUses')}
            />
          </Group>
          <Group grow align="flex-end">
            <DateInput
              label="Hiệu lực từ (tùy chọn)"
              valueFormat="DD/MM/YYYY"
              clearable
              value={parseApiDate(form.values.validFrom)}
              onChange={(d) => form.setFieldValue('validFrom', toApiDate(d) ?? '')}
              error={form.errors.validFrom}
            />
            <DateInput
              label="Hết hạn (tùy chọn)"
              valueFormat="DD/MM/YYYY"
              clearable
              value={parseApiDate(form.values.validTo)}
              onChange={(d) => form.setFieldValue('validTo', toApiDate(d) ?? '')}
              error={form.errors.validTo}
            />
          </Group>
          <Group>
            <Button type="submit" loading={busy}>
              Tạo voucher
            </Button>
          </Group>
        </Stack>
      </form>

      {/* Voucher list */}
      <Stack gap="xs" mt="md">
        <Group align="flex-end">
          <Select
            label="Xem voucher theo cơ sở"
            placeholder="Chọn cơ sở"
            data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
            value={facilityId}
            onChange={handleFacilitySelect}
            clearable
            w={280}
          />
          {facilityId && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconRefresh size={13} />}
              onClick={() => loadVouchers(facilityId)}
            >
              Làm mới
            </Button>
          )}
        </Group>
        {vLoad === 'loading' && (
          <Text c="dimmed" size="sm">
            Đang tải...
          </Text>
        )}
        {vLoad === 'error' && (
          <Alert color="red" title="Lỗi">
            {vError}
          </Alert>
        )}
        {vLoad === 'idle' && facilityId && vouchers.length === 0 && (
          <Text c="dimmed" size="sm">
            Chưa có voucher nào.
          </Text>
        )}
        {vouchers.length > 0 && (
          <Table striped withTableBorder={false} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Mã</Table.Th>
                <Table.Th>Giảm</Table.Th>
                <Table.Th>Đã dùng / Tối đa</Table.Th>
                <Table.Th>Hết hạn</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {vouchers.map((v) => (
                <Table.Tr key={v.id}>
                  <Table.Td>
                    <Text fw={500} size="sm">
                      {v.code}
                    </Text>
                  </Table.Td>
                  <Table.Td>−{v.percent}%</Table.Td>
                  <Table.Td>
                    {v.usedCount} / {v.maxUses}
                  </Table.Td>
                  <Table.Td>
                    {v.validTo ? new Date(v.validTo).toLocaleDateString('vi-VN') : '—'}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}

// ─── Discount Tier Card ───────────────────────────────────────────────────────

// Server re-validates on every write; this import is only the input's max for immediate feedback.
const DISCOUNT_TIER_PERCENT_CAP = DISCOUNT_CAP_PERCENT;

function DiscountTierCard({ facilities }: { facilities: Facility[] }) {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<DiscountTier[]>([]);
  const [usingDefaults, setUsingDefaults] = useState(false);
  const [tLoad, setTLoad] = useState<'idle' | 'loading' | 'error'>('idle');
  const [tError, setTError] = useState('');
  const [busy, setBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<DiscountTier | null>(null);

  const form = useForm({
    initialValues: { years: 1, percent: 15 },
    validate: {
      years: (v) => (v < 1 ? 'Số năm tối thiểu 1' : null),
      percent: (v) =>
        v <= 0 || v > DISCOUNT_TIER_PERCENT_CAP
          ? `Phần trăm 1–${DISCOUNT_TIER_PERCENT_CAP}`
          : null,
    },
  });

  const loadTiers = useCallback((fid: string) => {
    setTLoad('loading');
    setTError('');
    trpc.finance.discountTierList
      .query({ facilityId: Number(fid) })
      .then((res) => {
        setTiers(res.tiers);
        setUsingDefaults(res.usingDefaults);
        setTLoad('idle');
      })
      .catch((e: unknown) => {
        setTError(e instanceof Error ? e.message : 'Lỗi tải bậc giảm giá');
        setTLoad('error');
      });
  }, []);

  function handleFacilitySelect(v: string | null) {
    setFacilityId(v);
    setTiers([]);
    setUsingDefaults(false);
    form.reset();
    if (v) loadTiers(v);
  }

  async function upsertTier(values: typeof form.values) {
    if (!facilityId) return;
    setBusy(true);
    try {
      await trpc.finance.discountTierUpsert.mutate({
        facilityId: Number(facilityId),
        years: values.years,
        percent: values.percent,
      });
      notifySuccess(`Đã lưu bậc giảm giá ${values.years} năm → −${values.percent}%`);
      form.reset();
      loadTiers(facilityId);
    } catch (e) {
      notifyError(e, 'Lưu bậc giảm giá thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function archiveTier() {
    if (!archiveTarget || !facilityId) return;
    try {
      await trpc.finance.discountTierArchive.mutate({ id: archiveTarget.id });
      notifySuccess(`Đã lưu trữ bậc ${archiveTarget.years} năm`);
      setArchiveTarget(null);
      loadTiers(facilityId);
    } catch (e) {
      notifyError(e, 'Lưu trữ bậc giảm giá thất bại');
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Bậc giảm giá theo năm đóng trước
      </Title>

      <FacilityPicker
        facilities={facilities}
        placeholder="Chọn cơ sở để cấu hình"
        value={facilityId ? Number(facilityId) : null}
        onChange={(v) => handleFacilitySelect(v ? String(v) : null)}
        w={280}
        mb="sm"
      />

      {facilityId && (
        <Stack gap="sm">
          {tLoad === 'idle' && usingDefaults && (
            <Alert color="yellow" title="Đang dùng mặc định">
              Cơ sở này chưa cấu hình bậc giảm giá riêng — đang áp dụng mặc định 1 năm −15%, 2 năm
              −20%, 3 năm −30%. Thêm một bậc bên dưới để chuyển sang cấu hình riêng.
            </Alert>
          )}

          <form onSubmit={form.onSubmit(upsertTier)}>
            <Group grow align="flex-end">
              <NumberInput
                label="Số năm đóng trước"
                withAsterisk
                min={1}
                {...form.getInputProps('years')}
              />
              <NumberInput
                label="Giảm (%)"
                withAsterisk
                min={1}
                max={DISCOUNT_TIER_PERCENT_CAP}
                {...form.getInputProps('percent')}
              />
              <Button type="submit" loading={busy}>
                Lưu bậc
              </Button>
            </Group>
          </form>

          {tLoad === 'loading' && (
            <Text c="dimmed" size="sm">
              Đang tải...
            </Text>
          )}
          {tLoad === 'error' && (
            <Alert color="red" title="Lỗi">
              {tError}
            </Alert>
          )}
          {tiers.length > 0 && (
            <Table striped withTableBorder={false} fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Số năm</Table.Th>
                  <Table.Th>Giảm</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tiers.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td>{t.years}</Table.Td>
                    <Table.Td>−{t.percent}%</Table.Td>
                    <Table.Td>
                      <Group justify="flex-end">
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="red"
                          onClick={() => setArchiveTarget(t)}
                        >
                          Lưu trữ
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      )}

      <Modal
        opened={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        title="Lưu trữ bậc giảm giá"
      >
        <Stack>
          <Text size="sm">
            Lưu trữ bậc {archiveTarget?.years} năm (−{archiveTarget?.percent}%)? Phiếu thu đã tạo
            trước đó không đổi (giá lưu tại thời điểm lập phiếu); chỉ ảnh hưởng phiếu mới lập sau
            khi lưu trữ.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setArchiveTarget(null)}>
              Đóng
            </Button>
            <Button color="red" onClick={archiveTier}>
              Xác nhận lưu trữ
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

// ─── Receipts Card ────────────────────────────────────────────────────────────

function ReceiptsCard({
  students,
  courses,
  facilities,
  onStudentsChanged,
}: {
  students: StudentT[];
  courses: CourseT[];
  facilities: Facility[];
  onStudentsChanged: () => void;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [rLoad, setRLoad] = useState<'loading' | 'error' | 'ok'>('loading');
  const [rError, setRError] = useState('');
  const [filterFacilityId, setFilterFacilityId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [cancelTarget, setCancelTarget] = useState<Receipt | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelRefundAmount, setCancelRefundAmount] = useState<number>(0);
  const [detailTarget, setDetailTarget] = useState<Receipt | null>(null);
  // LMS credential surfaced once when approving a NEW-student receipt, so staff can relay it to the
  // parent (backend returns it plaintext exactly once; it is also emailed). Shown in a dismissible modal.
  const [cred, setCred] = useState<{ loginCode: string; tempPassword: string; familyPhone?: string } | null>(null);
  // Standalone "Ghi hoàn tiền" on an already-cancelled row (also reached right after a cancel that
  // included a refund amount fails to record — cancel already committed, refund is addable here).
  const [refundTarget, setRefundTarget] = useState<Receipt | null>(null);
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [refundReason, setRefundReason] = useState('');
  // Refund total per receipt id — fetched lazily for cancelled rows on the current page.
  const [refundTotals, setRefundTotals] = useState<Record<string, number>>({});
  // Approve-time parent-email prompt — only shown for new-student receipts with no email captured
  // yet (intake didn't collect it), so LMS parent access (OTP) stays reachable. Optional/skippable.
  const [approveEmailTarget, setApproveEmailTarget] = useState<Receipt | null>(null);
  const [approveEmailValue, setApproveEmailValue] = useState('');

  const studentName = (id: string | null) =>
    id ? (students.find((s) => s.id === id)?.fullName ?? id.slice(0, 8)) : '—';
  const courseName = (id: string) => courses.find((c) => c.id === id)?.code ?? id.slice(0, 8);

  const loadReceipts = useCallback(() => {
    setRLoad('loading');
    setRError('');
    trpc.finance.receiptList
      .query()
      .then((rows) => {
        setReceipts(rows);
        setRLoad('ok');
      })
      .catch((e: unknown) => {
        setRError(e instanceof Error ? e.message : 'Lỗi tải danh sách phiếu thu');
        setRLoad('error');
      });
  }, []);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  // Filter by receipt.facilityId directly. New-student drafts have studentId=null until approve
  // and must remain visible when filtering by their facility.
  const filtered = filterFacilityId
    ? receipts.filter((r) => String(r.facilityId) === filterFacilityId)
    : receipts;

  const totalPages = Math.max(1, Math.ceil(filtered.length / RECEIPT_PAGE_SIZE));
  const paged = filtered.slice((page - 1) * RECEIPT_PAGE_SIZE, page * RECEIPT_PAGE_SIZE);

  async function approve(id: string, parentEmail?: string) {
    try {
      const r = await trpc.finance.receiptApprove.mutate({ id, parentEmail: parentEmail || undefined });
      notifySuccess(
        r.overCapacity ? `Đã duyệt phiếu ${r.code} — ⚠ lớp đã vượt sĩ số` : `Đã duyệt phiếu ${r.code}`,
      );
      if (r.lmsAccount) setCred(r.lmsAccount);
      loadReceipts();
      // Approve can auto-provision a new student (new-student receipt) — refresh the students
      // list so the receipts table's name column doesn't show a truncated id for that row.
      onStudentsChanged();
    } catch (e) {
      notifyError(e, 'Duyệt phiếu thu thất bại');
    }
  }

  // New-student receipts with no email captured at intake get one more chance to collect it here —
  // enables LMS parent OTP login once provisioned. Existing-student/renewal receipts (studentId
  // already set) and receipts that already have an email skip straight to approve, unchanged.
  function onApproveClick(r: Receipt) {
    if (!r.studentId && !r.parentEmail) {
      setApproveEmailTarget(r);
      setApproveEmailValue('');
    } else {
      approve(r.id);
    }
  }

  function confirmApproveWithEmail() {
    if (!approveEmailTarget) return;
    approve(approveEmailTarget.id, approveEmailValue.trim());
    setApproveEmailTarget(null);
  }

  function skipApproveEmail() {
    if (!approveEmailTarget) return;
    approve(approveEmailTarget.id);
    setApproveEmailTarget(null);
  }

  async function markSent(id: string) {
    try {
      await trpc.finance.receiptMarkSent.mutate({ id });
      notifySuccess('Đã đánh dấu gửi phiếu');
      loadReceipts();
    } catch (e) {
      notifyError(e, 'Đánh dấu gửi phiếu thất bại');
    }
  }

  async function reconcile(id: string) {
    try {
      await trpc.finance.receiptReconcile.mutate({ id });
      notifySuccess('Đã đối soát phiếu');
      loadReceipts();
    } catch (e) {
      notifyError(e, 'Đối soát phiếu thất bại');
    }
  }

  async function doCancel() {
    if (!cancelTarget || !cancelReason.trim()) return;
    try {
      await trpc.finance.receiptCancel.mutate({ id: cancelTarget.id, reason: cancelReason.trim() });
      notifySuccess('Đã hủy phiếu thu');
      // Refund is a separate call after cancel commits — a refund failure must not look like the
      // cancel itself failed. The refund can be added later via "Ghi hoàn tiền" on the cancelled row.
      if (cancelRefundAmount > 0) {
        try {
          await trpc.finance.refundCreate.mutate({
            receiptId: cancelTarget.id,
            amount: cancelRefundAmount,
            reason: cancelReason.trim(),
          });
          notifySuccess(`Đã ghi hoàn tiền ${vnd(cancelRefundAmount)}`);
        } catch (e) {
          notifyError(
            e,
            'Đã hủy phiếu nhưng ghi hoàn tiền thất bại — dùng "Ghi hoàn tiền" trên dòng phiếu để thử lại',
          );
        }
      }
      setCancelTarget(null);
      setCancelReason('');
      setCancelRefundAmount(0);
      loadReceipts();
    } catch (e) {
      notifyError(e, 'Hủy phiếu thu thất bại');
    }
  }

  async function doRefund() {
    if (!refundTarget || refundAmount <= 0 || !refundReason.trim()) return;
    try {
      await trpc.finance.refundCreate.mutate({
        receiptId: refundTarget.id,
        amount: refundAmount,
        reason: refundReason.trim(),
      });
      notifySuccess(`Đã ghi hoàn tiền ${vnd(refundAmount)}`);
      setRefundTotals((prev) => ({
        ...prev,
        [refundTarget.id]: (prev[refundTarget.id] ?? 0) + refundAmount,
      }));
      setRefundTarget(null);
      setRefundAmount(0);
      setRefundReason('');
    } catch (e) {
      notifyError(e, 'Ghi hoàn tiền thất bại');
    }
  }

  // Lazily fetch the refund total for cancelled rows visible on the current page.
  useEffect(() => {
    const missing = paged
      .filter((r) => r.status === 'cancelled' && !(r.id in refundTotals))
      .map((r) => r.id);
    if (missing.length === 0) return;
    missing.forEach((id) => {
      trpc.finance.refundList
        .query({ receiptId: id })
        .then((rows) => {
          const sum = rows.reduce((s, x) => s + x.amount, 0);
          setRefundTotals((prev) => ({ ...prev, [id]: sum }));
        })
        .catch(() => {});
    });
  }, [paged, refundTotals]);

  return (
    <Card withBorder>
      <Title order={6} mb="sm">
        Phiếu thu
      </Title>

      <Modal opened={!!cred} onClose={() => setCred(null)} title="Tài khoản LMS học sinh" centered>
        {cred && (
          <Stack gap="xs">
            <Text size="sm">
              Đã tạo tài khoản LMS cho học sinh. Gửi thông tin này cho phụ huynh:
            </Text>
            {cred.familyPhone ? (
              <>
                <Text>
                  SĐT đăng nhập (chính): <b>{cred.familyPhone.replace(/^84/, '0')}</b>
                </Text>
                <Text>
                  Mật khẩu: <b>{cred.tempPassword}</b>
                </Text>
                <Text size="xs" c="dimmed">
                  Mã học sinh dự phòng: <span data-testid="lms-login-code">{cred.loginCode}</span>
                  {' '}(dùng khi không đăng nhập được bằng SĐT)
                </Text>
              </>
            ) : (
              <>
                <Text size="xs" c="orange">
                  SĐT phụ huynh không hợp lệ — học sinh chỉ có thể dùng mã dự phòng.
                </Text>
                <Text>
                  Mã học sinh (dự phòng): <b data-testid="lms-login-code">{cred.loginCode}</b>
                </Text>
                <Text>
                  Mật khẩu: <b>{cred.tempPassword}</b>
                </Text>
              </>
            )}
            <Text size="xs" c="dimmed">
              Mật khẩu chỉ hiển thị một lần; phụ huynh đổi sau khi đăng nhập.
            </Text>
            <Button onClick={() => setCred(null)} mt="sm">
              Đã ghi nhận
            </Button>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={!!approveEmailTarget}
        onClose={() => setApproveEmailTarget(null)}
        title="Duyệt phiếu thu — email phụ huynh"
        centered
      >
        {approveEmailTarget && (
          <Stack gap="sm">
            <Text size="sm">
              Học sinh mới, chưa có email phụ huynh. Nhập email để phụ huynh đăng nhập LMS bằng OTP
              (có thể bỏ qua, thêm sau).
            </Text>
            <TextInput
              label="Email phụ huynh (tùy chọn)"
              type="email"
              placeholder="parent@example.com"
              value={approveEmailValue}
              onChange={(e) => setApproveEmailValue(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={skipApproveEmail}>
                Bỏ qua, duyệt luôn
              </Button>
              <Button onClick={confirmApproveWithEmail} disabled={!approveEmailValue.trim()}>
                Duyệt
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Group align="flex-end" mb="sm">
        <Select
          label="Lọc theo cơ sở"
          placeholder="Tất cả"
          data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
          value={filterFacilityId}
          onChange={(v) => {
            setFilterFacilityId(v);
            setPage(1);
          }}
          clearable
          w={220}
        />
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconRefresh size={13} />}
          onClick={loadReceipts}
        >
          Làm mới
        </Button>
        <Text size="xs" c="dimmed" style={{ alignSelf: 'flex-end', paddingBottom: 4 }}>
          {filtered.length} phiếu
        </Text>
      </Group>

      {rLoad === 'loading' && (
        <Text c="dimmed" ta="center" py="xl">
          Đang tải...
        </Text>
      )}
      {rLoad === 'error' && (
        <Alert color="red" title="Lỗi tải phiếu thu">
          {rError}
          <Button size="xs" variant="subtle" mt="sm" onClick={loadReceipts}>
            Thử lại
          </Button>
        </Alert>
      )}
      {rLoad === 'ok' && filtered.length === 0 && (
        <Text c="dimmed" size="sm">
          Chưa có phiếu thu.
        </Text>
      )}
      {rLoad === 'ok' && filtered.length > 0 && (
        <>
          <Table fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Mã</Table.Th>
                <Table.Th>Học sinh</Table.Th>
                <Table.Th>Khóa</Table.Th>
                <Table.Th>Giảm</Table.Th>
                <Table.Th>Thành tiền</Table.Th>
                <Table.Th>Trạng thái</Table.Th>
                <Table.Th>Đã hoàn</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {paged.map((r) => {
                const st: StatusDef = STATUS[r.status] ?? { label: r.status, tone: 'inactive' };
                const sName = studentName(r.studentId);
                return (
                  <Table.Tr key={r.id}>
                    <Table.Td>{r.code ?? '—'}</Table.Td>
                    <Table.Td>
                      {sName === '—' ? (
                        sName
                      ) : (
                        <Group gap={6} wrap="nowrap">
                          <InitialsAvatar name={sName} size={22} />
                          <Text size="sm" lineClamp={1}>{sName}</Text>
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td>{courseName(r.courseId)}</Table.Td>
                    <Table.Td>{r.effectiveDiscountPercent}%</Table.Td>
                    <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {vnd(r.netAmount)}
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={r.status} label={st.label} tone={st.tone} pill />
                    </Table.Td>
                    <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.status === 'cancelled' ? vnd(refundTotals[r.id] ?? 0) : '—'}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end">
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          onClick={() => setDetailTarget(r)}
                        >
                          Nhật ký
                        </Button>
                        {r.status === 'draft' && (
                          <Button size="compact-xs" onClick={() => onApproveClick(r)}>
                            Duyệt
                          </Button>
                        )}
                        {r.status === 'approved' && (
                          <Button size="compact-xs" variant="light" onClick={() => markSent(r.id)}>
                            Gửi
                          </Button>
                        )}
                        {(r.status === 'approved' || r.status === 'sent') && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="green"
                            onClick={() => reconcile(r.id)}
                          >
                            Đối soát
                          </Button>
                        )}
                        {r.code && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() =>
                              window.open(`${API_URL}/files/receipt/${r.id}`, '_blank', 'noopener')
                            }
                          >
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
                        {/* approvedAt gate: a draft cancelled before ever being approved never took
                            money in, so it never gets a refund action (mirrors the server guard). */}
                        {r.status === 'cancelled' && r.approvedAt && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="orange"
                            onClick={() => setRefundTarget(r)}
                          >
                            Ghi hoàn tiền
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          {totalPages > 1 && (
            <Group justify="center" mt="md">
              <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
            </Group>
          )}
        </>
      )}

      <Modal
        opened={!!cancelTarget}
        onClose={() => {
          setCancelTarget(null);
          setCancelRefundAmount(0);
        }}
        title="Hủy phiếu thu"
      >
        <Stack>
          <Text size="sm">
            Hủy phiếu {cancelTarget?.code ?? 'nháp'} (
            {cancelTarget ? vnd(cancelTarget.netAmount) : ''})? Voucher (nếu có) sẽ được hoàn lượt.
          </Text>
          <Textarea
            label="Lý do hủy"
            autosize
            minRows={2}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.currentTarget.value)}
          />
          {/* Refund field only makes sense for a receipt that actually took money in — matches
              receiptCancel's own wasApproved check (approved/sent/reconciled), not just 'approved'.
              Manual amount — no auto pro-rata (D-P4a). Left blank = no refund recorded now; can be
              added later via "Ghi hoàn tiền" on the cancelled row. */}
          {cancelTarget && ['approved', 'sent', 'reconciled'].includes(cancelTarget.status) && (
            <NumberInput
              label="Hoàn tiền (tùy chọn, VNĐ)"
              placeholder="Để trống nếu không hoàn tiền ngay"
              min={0}
              step={100000}
              value={cancelRefundAmount}
              onChange={(v) => setCancelRefundAmount(Number(v) || 0)}
            />
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setCancelTarget(null);
                setCancelRefundAmount(0);
              }}
            >
              Đóng
            </Button>
            <Button color="red" disabled={!cancelReason.trim()} onClick={doCancel}>
              Xác nhận hủy
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={!!refundTarget}
        onClose={() => {
          setRefundTarget(null);
          setRefundAmount(0);
          setRefundReason('');
        }}
        title="Ghi hoàn tiền"
      >
        <Stack>
          <Text size="sm">
            Ghi hoàn tiền cho phiếu {refundTarget?.code ?? ''} (
            {refundTarget ? vnd(refundTarget.netAmount) : ''}, đã hoàn{' '}
            {refundTarget ? vnd(refundTotals[refundTarget.id] ?? 0) : ''}).
          </Text>
          <NumberInput
            label="Số tiền hoàn (VNĐ)"
            withAsterisk
            min={1}
            step={100000}
            value={refundAmount}
            onChange={(v) => setRefundAmount(Number(v) || 0)}
          />
          <Textarea
            label="Lý do hoàn tiền"
            withAsterisk
            autosize
            minRows={2}
            value={refundReason}
            onChange={(e) => setRefundReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setRefundTarget(null);
                setRefundAmount(0);
                setRefundReason('');
              }}
            >
              Đóng
            </Button>
            <Button
              color="orange"
              disabled={refundAmount <= 0 || !refundReason.trim()}
              onClick={doRefund}
            >
              Xác nhận hoàn tiền
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
        {detailTarget && <Chatter entityType="receipt" entityId={detailTarget.id} />}
      </Modal>
    </Card>
  );
}

// ─── Receipt Create Card ──────────────────────────────────────────────────────

type BatchT = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];

function ReceiptCreateCard({
  students,
  courses,
  facilities,
  onCreated,
  opportunityContext,
}: {
  students: StudentT[];
  courses: CourseT[];
  facilities: Facility[];
  onCreated: () => void;
  opportunityContext?: {
    opportunityId: string;
    studentName?: string | null;
    courseId?: string | null;
    facilityId?: number | null;
  };
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [batches, setBatches] = useState<BatchT[]>([]);

  // Existing-student fields
  const [studentId, setStudentId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);

  // New-student fields
  const [newFacilityId, setNewFacilityId] = useState<string | null>(null);
  const [newCourseId, setNewCourseId] = useState<string | null>(null);
  const [parentPhone, setParentPhone] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentDob, setStudentDob] = useState('');
  const [classBatchId, setClassBatchId] = useState<string | null>(null);

  // Opportunity phone-lookup (decision 0037): find + link an existing CRM opportunity instead of
  // retyping parent/student name by hand. Stashed values ride along silently in the receiptCreate
  // payload; never autofilled without staff confirming the match first.
  const [opportunityMatches, setOpportunityMatches] = useState<
    { id: string; studentName: string | null; stage: string; contact: { fullName: string } }[]
  >([]);
  const [pickedOpportunityId, setPickedOpportunityId] = useState<string | null>(null);
  const [pickedParentName, setPickedParentName] = useState<string | null>(null);
  const [debouncedPhone] = useDebouncedValue(parentPhone, 300);
  const singleOpportunityMatch = useMemo(
    () => (opportunityMatches.length === 1 ? opportunityMatches[0] : null),
    [opportunityMatches],
  );

  // Shared
  const [years, setYears] = useState('1');
  const [voucherCode, setVoucherCode] = useState('');
  const [period, setPeriod] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    trpc.classBatch.list
      .query()
      .then(setBatches)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!opportunityContext) return;
    setMode(opportunityContext.courseId ? 'existing' : 'new');
    setNewFacilityId(opportunityContext.facilityId ? String(opportunityContext.facilityId) : null);
    setNewCourseId(opportunityContext.courseId ?? null);
    setCourseId(opportunityContext.courseId ?? null);
    setStudentName(opportunityContext.studentName ?? '');
  }, [opportunityContext]);

  // Fire the lookup once the debounced phone normalizes to a full local number (9-10 digits) and a
  // facility is chosen. Resets on every phone/facility change so a stale opportunityId can never
  // ride along after the staff edits the phone.
  useEffect(() => {
    setPickedOpportunityId(null);
    setPickedParentName(null);
    setOpportunityMatches([]);
    if (mode !== 'new' || !newFacilityId) return;
    const digits = normalizeContactPhone(debouncedPhone).replace(/\D/g, '');
    if (digits.length < 10) return; // +84 + 9-10 local digits
    trpc.crm.opportunityLookupByPhone
      .query({ facilityId: Number(newFacilityId), phone: debouncedPhone })
      .then(setOpportunityMatches)
      .catch(() => setOpportunityMatches([])); // no permission / no match → silent, manual flow unaffected
  }, [debouncedPhone, newFacilityId, mode]);

  function confirmOpportunityMatch(opp: { id: string; studentName: string | null; contact: { fullName: string } }) {
    setPickedOpportunityId(opp.id);
    setPickedParentName(opp.contact.fullName);
    if (opp.studentName) setStudentName(opp.studentName);
    setOpportunityMatches([]);
  }

  const filteredBatches = newFacilityId
    ? batches.filter((b) => String(b.facilityId) === newFacilityId)
    : batches;

  // Decision 0037: receiptCreate returns a discriminated union. On a 'warning' result we stash the
  // exact payload that produced it, so "Vẫn lập phiếu" can retry with confirmDuplicate:true without
  // re-deriving the request. Cleared on close/cancel and on a successful create.
  const [duplicateWarning, setDuplicateWarning] = useState<{
    parentName: string;
    studentName: string | null;
    payload: Parameters<typeof trpc.finance.receiptCreate.mutate>[0];
  } | null>(null);

  function resetForm() {
    setStudentId(null);
    setCourseId(null);
    setNewFacilityId(null);
    setNewCourseId(null);
    setParentPhone('');
    setStudentName('');
    setStudentDob('');
    setClassBatchId(null);
    setYears('1');
    setVoucherCode('');
    setPeriod('');
    setPickedOpportunityId(null);
    setPickedParentName(null);
    setOpportunityMatches([]);
  }

  async function submitReceipt(payload: Parameters<typeof trpc.finance.receiptCreate.mutate>[0]) {
    const r = await trpc.finance.receiptCreate.mutate(payload);
    if (r.status === 'warning') {
      setDuplicateWarning({
        parentName: r.duplicateWarning.parentName,
        studentName: r.duplicateWarning.studentName,
        payload,
      });
      return;
    }
    notifySuccess(
      `Đã tạo phiếu nháp: gốc ${vnd(r.receipt.grossAmount)} → giảm ${r.receipt.effectiveDiscountPercent}% → còn ${vnd(r.receipt.netAmount)}`,
      'Tạo phiếu thu thành công',
    );
    resetForm();
    onCreated();
  }

  async function createDraft() {
    setBusy(true);
    try {
      if (mode === 'existing') {
        const student = students.find((s) => s.id === studentId);
        if (!student || !courseId) {
          notifyError('Vui lòng chọn học sinh và khóa học.', 'Thiếu thông tin');
          return;
        }
        await submitReceipt({
          facilityId: student.facilityId,
          studentId: student.id,
          courseId,
          yearsPrepaid: Number(years),
          period: period.trim() || undefined,
          voucherCode: voucherCode.trim() || undefined,
          opportunityId: opportunityContext?.opportunityId,
        });
      } else {
        if (!newFacilityId || !newCourseId || !parentPhone.trim() || !studentName.trim()) {
          notifyError(
            'Vui lòng điền: cơ sở, khóa học, SĐT phụ huynh và tên học sinh.',
            'Thiếu thông tin',
          );
          return;
        }
        await submitReceipt({
          facilityId: Number(newFacilityId),
          courseId: newCourseId,
          yearsPrepaid: Number(years),
          period: period.trim() || undefined,
          voucherCode: voucherCode.trim() || undefined,
          parentPhone: parentPhone.trim(),
          parentName: pickedParentName ?? undefined,
          studentName: studentName.trim(),
          studentDob: studentDob.trim() || undefined,
          classBatchId: classBatchId ?? undefined,
          opportunityId: opportunityContext?.opportunityId ?? pickedOpportunityId ?? undefined,
        });
      }
    } catch (e) {
      notifyError(e, 'Tạo phiếu thu thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function confirmCreateDespiteDuplicate() {
    if (!duplicateWarning) return;
    setBusy(true);
    try {
      await submitReceipt({ ...duplicateWarning.payload, confirmDuplicate: true });
      setDuplicateWarning(null);
    } catch (e) {
      notifyError(e, 'Tạo phiếu thu thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Lập phiếu thu
      </Title>

      {/* Mode toggle: existing student vs. new student */}
      <Group mb="sm">
        <Button
          size="xs"
          variant={mode === 'existing' ? 'filled' : 'subtle'}
          onClick={() => setMode('existing')}
        >
          Học sinh hiện có
        </Button>
        <Button
          size="xs"
          variant={mode === 'new' ? 'filled' : 'subtle'}
          onClick={() => setMode('new')}
        >
          Học sinh mới
        </Button>
      </Group>

      {mode === 'existing' ? (
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
      ) : (
        <Stack gap="sm">
          <Group grow align="flex-end">
            <FacilityPicker
              facilities={facilities}
              withAsterisk
              clearable={false}
              placeholder="Chọn cơ sở"
              value={newFacilityId ? Number(newFacilityId) : null}
              onChange={(v) => {
                setNewFacilityId(v ? String(v) : null);
                setClassBatchId(null);
              }}
            />
            <Select
              label="Khóa học"
              withAsterisk
              searchable
              placeholder={courses.length ? 'Chọn khóa' : 'Chưa có khóa'}
              data={courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
              value={newCourseId}
              onChange={setNewCourseId}
            />
          </Group>
          <Group grow align="flex-end">
            <TextInput
              label="SĐT phụ huynh"
              withAsterisk
              placeholder="vd 0901234567"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.currentTarget.value)}
            />
            <TextInput
              label="Tên học sinh"
              withAsterisk
              placeholder="Họ và tên đầy đủ"
              value={studentName}
              onChange={(e) => setStudentName(e.currentTarget.value)}
            />
          </Group>
          {pickedOpportunityId ? (
            <Alert color="green" variant="light">
              Đã liên kết cơ hội CRM ({pickedParentName}) — tên học sinh đã điền theo cơ hội, có thể sửa lại nếu cần.
            </Alert>
          ) : opportunityMatches.length === 1 && singleOpportunityMatch ? (
            <Alert color="blue" variant="light">
              <Stack gap="xs">
                <Text size="sm">
                  Tìm thấy cơ hội CRM trùng SĐT: <strong>{singleOpportunityMatch.contact.fullName}</strong>
                  {singleOpportunityMatch.studentName ? ` — ${singleOpportunityMatch.studentName}` : ''} (
                  {singleOpportunityMatch.stage})
                </Text>
                <Group>
                  <Button size="xs" onClick={() => confirmOpportunityMatch(singleOpportunityMatch)}>
                    Dùng thông tin này
                  </Button>
                  <Button size="xs" variant="subtle" onClick={() => setOpportunityMatches([])}>
                    Bỏ qua
                  </Button>
                </Group>
              </Stack>
            </Alert>
          ) : opportunityMatches.length > 1 ? (
            <Alert color="blue" variant="light">
              <Stack gap="xs">
                <Text size="sm">Có {opportunityMatches.length} cơ hội CRM trùng SĐT (có thể là anh chị em) — chọn đúng học sinh:</Text>
                <Radio.Group onChange={(id) => {
                  const opp = opportunityMatches.find((o) => o.id === id);
                  if (opp) confirmOpportunityMatch(opp);
                }}>
                  <Stack gap={4}>
                    {opportunityMatches.map((opp) => (
                      <Radio
                        key={opp.id}
                        value={opp.id}
                        label={`${opp.contact.fullName}${opp.studentName ? ` — ${opp.studentName}` : ''} (${opp.stage})`}
                      />
                    ))}
                  </Stack>
                </Radio.Group>
              </Stack>
            </Alert>
          ) : null}
          <Group grow align="flex-end">
            <DateInput
              label="Ngày sinh (tùy chọn)"
              valueFormat="DD/MM/YYYY"
              clearable
              value={parseApiDate(studentDob)}
              onChange={(d) => setStudentDob(toApiDate(d) ?? '')}
            />
            <Select
              label="Lớp học (tùy chọn)"
              placeholder="Chọn lớp"
              searchable
              clearable
              data={filteredBatches.map((b) => ({ value: b.id, label: b.code }))}
              value={classBatchId}
              onChange={setClassBatchId}
            />
          </Group>
        </Stack>
      )}

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
        Giảm theo số năm cộng voucher, tổng tối đa 35%. Giá lấy theo bảng giá hiệu lực ngày lập
        phiếu.
      </Text>
      <Group mt="md">
        <Button onClick={createDraft} loading={busy}>
          Tạo phiếu nháp
        </Button>
      </Group>
      <Modal
        opened={!!duplicateWarning}
        onClose={() => setDuplicateWarning(null)}
        title="Có cơ hội CRM trùng SĐT"
      >
        <Stack>
          <Text size="sm">
            SĐT phụ huynh này trùng với 1 cơ hội CRM đang mở: <strong>{duplicateWarning?.parentName}</strong>
            {duplicateWarning?.studentName ? ` — ${duplicateWarning.studentName}` : ''}. Nếu đây là 2 con
            khác nhau dùng chung SĐT, cứ lập phiếu bình thường.
          </Text>
          <Group>
            <Button onClick={confirmCreateDespiteDuplicate} loading={busy}>
              Vẫn lập phiếu
            </Button>
            <Button variant="subtle" onClick={() => setDuplicateWarning(null)}>
              Hủy
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function FinancePanel() {
  const [students, setStudents] = useState<StudentT[]>([]);
  const [courses, setCourses] = useState<CourseT[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  // receipts are managed inside ReceiptsCard via a ref reload callback
  const [reloadKey, setReloadKey] = useState(0);

  const loadStudents = useCallback(() => {
    trpc.student.list
      .query()
      .then(setStudents)
      .catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));
  }, []);

  useEffect(() => {
    loadStudents();
    trpc.course.list
      .query()
      .then(setCourses)
      .catch((e) => notifyError(e, 'Không tải được danh sách khóa học'));
    trpc.facility.list
      .query()
      .then(setFacilities)
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  }, [loadStudents]);

  return (
    <Stack>
      <CoursePriceCard courses={courses} facilities={facilities} />
      <VoucherCard facilities={facilities} />
      <DiscountTierCard facilities={facilities} />
      <ReceiptCreateCard
        students={students}
        courses={courses}
        facilities={facilities}
        onCreated={() => setReloadKey((k) => k + 1)}
      />
      {/* key forces ReceiptsCard to re-mount and reload after a new receipt is created */}
      <ReceiptsCard
        key={reloadKey}
        students={students}
        courses={courses}
        facilities={facilities}
        onStudentsChanged={loadStudents}
      />
    </Stack>
  );
}
