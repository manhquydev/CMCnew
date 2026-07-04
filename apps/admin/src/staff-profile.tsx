// Staff record page (Odoo-style single surface) — plan R0/R1/R2, migrated onto @cmc/ui's
// RecordDetailPanel primitive (P5 of the ERP UI rebuild — first real consumer of P2's primitive,
// decision 0032). ONE page for a staff member: read by default, a header "Chỉnh sửa" unlocks only
// the fields the caller may write (super_admin for F0), with a single Lưu/Hủy that batches the
// underlying mutations (updateProfile + setRoles/setFacilities/setActive) so a partial save can't
// happen. The activity log is INLINE in a right column (stacks below on mobile), fed by the SECURE
// audit.staffTimeline endpoint (facility-scoped + permission-gated) — never the open Chatter path.
// Salary/employment tabs lazy-load behind their own permission gates so unprivileged roles never
// over-fetch them.
//
// Header chrome (back button, title, badge, edit/save/cancel, reset-password modal) stays
// caller-owned per P2's FIX #4 scope boundary — RecordDetailPanel owns only the sheet+tabs+
// activity-rail region. Save is triggered via the imperative `RecordDetailHandle` ref (decision
// 0032); `onStateChange` keeps the header's Save button reactive (loading/disabled) since ref
// mutation alone doesn't trigger a re-render.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  trpc, useSession, notifyError, notifySuccess,
  RecordDetailPanel, type RecordDetailConfig, type RecordDetailHandle,
  InitialsAvatar, StatusBadge, toApiDate, parseApiDate,
} from '@cmc/ui';
import { can, canReadSensitiveHr, maskSensitive, ROLE_LABEL } from '@cmc/auth/permissions';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Fieldset,
  Group,
  Modal,
  Skeleton,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconArrowLeft, IconPencil } from '@tabler/icons-react';

type EmploymentProfile = Awaited<ReturnType<typeof trpc.payroll.profileList.query>>[number];
type SalaryRate = Awaited<ReturnType<typeof trpc.payroll.rateList.query>>[number];
type Payslip = Awaited<ReturnType<typeof trpc.payroll.listByStaff.query>>[number];
// Role union/array shapes, derived from the mutation input so casts stay in sync with the API.
type RoleArr = Parameters<typeof trpc.user.setRoles.mutate>[0]['roles'];

export interface StaffProfileUser {
  id: string;
  email: string;
  phone?: string | null;
  displayName: string;
  roles: readonly string[];
  primaryRole: string;
  isActive: boolean;
  facilities: readonly { facilityId: number }[];
}

export interface FacilityOption {
  id: number;
  code: string;
  name: string;
}

const money = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const sortedNums = (a: number[]) => [...a].sort((x, y) => x - y).join(',');

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" style={{ textAlign: 'right' }}>{value ?? '—'}</Text>
    </Group>
  );
}

// ─── Employment (R0: look across ALL the user's facilities, not just [0]) ─────
function EmploymentTab({ user }: { user: StaffProfileUser }) {
  const { me } = useSession();
  const canEmployment = me.isSuperAdmin || can(me.roles as string[], me.isSuperAdmin, 'payroll', 'profileList');
  const canUpsert = me.isSuperAdmin || can(me.roles as string[], me.isSuperAdmin, 'payroll', 'profileUpsert');
  const canSensitive = canReadSensitiveHr({ isSuperAdmin: me.isSuperAdmin, roles: me.roles as string[] });
  const [profile, setProfile] = useState<EmploymentProfile | null>(null);
  const [loading, setLoading] = useState(canEmployment && user.facilities.length > 0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    position: '', grade: '', dependents: 0, startedAt: '', callioExt: '',
    managerId: '', address: '', nationalId: '', bankAccount: '', bankName: '',
  });

  useEffect(() => {
    if (!canEmployment || user.facilities.length === 0) return;
    setLoading(true);
    Promise.all(user.facilities.map((f) => trpc.payroll.profileList.query({ facilityId: f.facilityId })))
      .then((lists) => setProfile(lists.flat().find((r) => r.userId === user.id) ?? null))
      .catch((e) => notifyError(e, 'Không tải được hồ sơ nhân sự'))
      .finally(() => setLoading(false));
  }, [canEmployment, user.id, user.facilities]);

  function startEdit() {
    if (!profile) return;
    const dateStr = profile.startedAt ? new Date(profile.startedAt).toISOString().slice(0, 10) : '';
    setForm({
      position: profile.position, grade: profile.grade ?? '', dependents: profile.dependents,
      startedAt: dateStr, callioExt: profile.callioExt ?? '',
      managerId: profile.managerId ?? '', address: profile.address ?? '',
      nationalId: profile.nationalId ?? '', bankAccount: profile.bankAccount ?? '',
      bankName: profile.bankName ?? '',
    });
    setEditing(true);
  }

  async function save() {
    const facId = user.facilities[0]?.facilityId;
    if (!facId) return;
    setBusy(true);
    try {
      await trpc.payroll.profileUpsert.mutate({
        userId: user.id, facilityId: facId,
        position: form.position, grade: form.grade || undefined,
        dependents: form.dependents,
        startedAt: form.startedAt || undefined, callioExt: form.callioExt || undefined,
        managerId: form.managerId || null,
        address: form.address || undefined,
        nationalId: form.nationalId || undefined,
        bankAccount: form.bankAccount || undefined,
        bankName: form.bankName || undefined,
      });
      notifySuccess('Đã lưu hồ sơ nhân sự');
      setEditing(false);
      Promise.all(user.facilities.map((f) => trpc.payroll.profileList.query({ facilityId: f.facilityId })))
        .then((lists) => setProfile(lists.flat().find((r) => r.userId === user.id) ?? null))
        .catch(() => {});
    } catch (e) {
      notifyError(e, 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }
  if (!canEmployment) return <Text size="sm" c="dimmed">Bạn không có quyền xem hồ sơ nhân sự.</Text>;
  if (loading) return <Skeleton height={48} radius="md" />;
  if (!profile) return <Text size="sm" c="dimmed">Chưa có hồ sơ nhân sự cho người dùng này.</Text>;

  const natIdDisplay = canSensitive ? profile.nationalId : maskSensitive(profile.nationalId);
  const bankAcctDisplay = canSensitive ? profile.bankAccount : maskSensitive(profile.bankAccount);

  return (
    <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600} size="sm">Hồ sơ nhân sự</Text>
          {canUpsert && !editing && <Button size="xs" variant="light" onClick={startEdit}>Chỉnh sửa</Button>}
        </Group>
        {editing ? (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput label="Vị trí" value={form.position} onChange={(e) => setForm({ ...form, position: e.currentTarget.value })} />
              <TextInput label="Bậc lương" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.currentTarget.value })} />
              <TextInput label="Người phụ thuộc" type="number" value={form.dependents} onChange={(e) => setForm({ ...form, dependents: Number(e.currentTarget.value) })} />
              <DateInput
                label="Ngày vào làm"
                valueFormat="DD/MM/YYYY"
                clearable
                value={parseApiDate(form.startedAt)}
                onChange={(d) => setForm({ ...form, startedAt: toApiDate(d) ?? '' })}
              />
              <TextInput label="Số máy nhánh (Callio)" value={form.callioExt} onChange={(e) => setForm({ ...form, callioExt: e.currentTarget.value })} />
              <TextInput label="Mã quản lý (UUID)" value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.currentTarget.value })} placeholder="Để trống = tự động" />
            </SimpleGrid>
            <Fieldset legend="Thông tin nhạy cảm (CCCD / Ngân hàng)">
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput label="Địa chỉ" value={form.address} onChange={(e) => setForm({ ...form, address: e.currentTarget.value })} />
                <TextInput label="Số CCCD" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.currentTarget.value })} />
                <TextInput label="Số tài khoản" value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.currentTarget.value })} />
                <TextInput label="Tên ngân hàng" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.currentTarget.value })} />
              </SimpleGrid>
            </Fieldset>
            <Group justify="flex-end">
              <Button size="xs" variant="subtle" onClick={() => setEditing(false)}>Hủy</Button>
              <Button size="xs" variant="filled" onClick={save} loading={busy}>Lưu</Button>
            </Group>
          </>
        ) : (
          <Stack gap="xs">
            <Field label="Vị trí" value={profile.position} />
            <Field label="Bậc lương" value={profile.grade} />
            <Field label="Người phụ thuộc" value={profile.dependents} />
            <Field label="Số máy nhánh (Callio)" value={profile.callioExt} />
            <Field label="Ngày vào làm" value={profile.startedAt ? new Date(profile.startedAt).toLocaleDateString('vi-VN') : '—'} />
            <Field label="Quản lý trực tiếp" value={profile.managerId ? 'Đã thiết lập' : 'Tự động'} />
            <Field label="Địa chỉ" value={profile.address} />
            <Field label="Số CCCD" value={natIdDisplay} />
            <Field label="Số tài khoản" value={bankAcctDisplay} />
            <Field label="Tên ngân hàng" value={profile.bankName} />
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

// ─── Lương & phụ cấp (gated) ─────────────────────────────────────────────────
function PayrollTab({ user }: { user: StaffProfileUser }) {
  const [rates, setRates] = useState<SalaryRate[]>([]);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      trpc.payroll.rateList.query({ userId: user.id }),
      trpc.payroll.listByStaff.query({ staffId: user.id }),
    ])
      .then(([r, s]) => { setRates(r); setSlips(s); })
      .catch((e) => notifyError(e, 'Không tải được dữ liệu lương'))
      .finally(() => setLoading(false));
  }, [user.id]);

  if (loading) return <Skeleton height={48} radius="md" />;

  return (
    <Stack>
      <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="sm">Mức lương (mới nhất trước)</Text>
        {rates.length === 0 ? (
          <Text size="sm" c="dimmed">Chưa có mức lương.</Text>
        ) : (
          <Table striped>
            <Table.Thead><Table.Tr>
              <Table.Th>Hiệu lực từ</Table.Th><Table.Th>Lương cơ bản</Table.Th>
              <Table.Th>Phụ cấp ăn</Table.Th><Table.Th>Phụ cấp khác</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {rates.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>{new Date(r.effectiveFrom).toLocaleDateString('vi-VN')}</Table.Td>
                  <Table.Td>{money(r.baseSalary)}</Table.Td>
                  <Table.Td>{money(r.mealAllowance)}</Table.Td>
                  <Table.Td>{money(r.otherAllowance)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
      <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="sm">Phiếu lương gần đây</Text>
        {slips.length === 0 ? (
          <Text size="sm" c="dimmed">Chưa có phiếu lương.</Text>
        ) : (
          <Table striped>
            <Table.Thead><Table.Tr>
              <Table.Th>Kỳ</Table.Th><Table.Th>Trạng thái</Table.Th>
              <Table.Th>Xếp hạng KPI</Table.Th><Table.Th>Thực nhận</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {slips.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>{s.periodKey}</Table.Td>
                  <Table.Td>{s.status}</Table.Td>
                  <Table.Td>{s.kpiGrade ?? '—'}</Table.Td>
                  <Table.Td>{money(s.netIncome)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}

// ─── RecordDetailTab adapters — EmploymentTab/PayrollTab expect `{ user }`, the
// primitive's tab contract is `{ data: unknown }` (P5 red-team gap #6). Rebuild the
// StaffProfileUser shape from the primitive's live form data, memoized on only the
// fields each tab actually reads so their own fetch-effects don't re-fire on every
// unrelated keystroke while editing. ─────────────────────────────────────────────
function toStaffProfileUser(d: Record<string, unknown>): StaffProfileUser {
  return {
    id: d.id as string,
    email: d.email as string,
    phone: (d.phone as string) || null,
    displayName: d.displayName as string,
    roles: (d.roles as string[]) ?? [],
    primaryRole: d.primaryRole as string,
    isActive: !!d.isActive,
    facilities: ((d.facilityIds as string[]) ?? []).map((id) => ({ facilityId: Number(id) })),
  };
}

function EmploymentTabAdapter({ data }: { data: unknown }) {
  const d = data as Record<string, unknown>;
  const facilityIdsKey = ((d.facilityIds as string[]) ?? []).slice().sort().join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const user = useMemo(() => toStaffProfileUser(d), [d.id, facilityIdsKey]);
  return <EmploymentTab user={user} />;
}

function PayrollTabAdapter({ data }: { data: unknown }) {
  const d = data as Record<string, unknown>;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const user = useMemo(() => toStaffProfileUser(d), [d.id]);
  return <PayrollTab user={user} />;
}

// ─── Activity log field labels + value formatting — passed into the primitive's
// built-in activity rail (RecordDetailConfig.activityLog); the generic rendering
// lives in @cmc/ui's <ActivityLog>. ───────────────────────────────────────────
const STAFF_FIELD_LABELS: Record<string, string> = {
  displayName: 'Tên hiển thị',
  phone: 'Số điện thoại',
  roles: 'Vai trò',
  primaryRole: 'Vai trò chính',
  facilities: 'Cơ sở',
  isActive: 'Trạng thái',
};
function staffFormatValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(trống)';
  if (field === 'isActive') return v ? 'Đang hoạt động' : 'Ngừng';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

// ─── Main: single record page ────────────────────────────────────────────────
export function StaffProfilePanel({
  user,
  facilities,
  roleOptions,
  onBack,
  reload,
}: {
  user: StaffProfileUser;
  facilities: FacilityOption[];
  roleOptions: { value: string; label: string }[];
  onBack: () => void;
  reload: () => void;
}) {
  const { me } = useSession();
  const canEdit = me.isSuperAdmin; // identity + access mutations are super_admin-only (F0)
  const canPayroll = me.isSuperAdmin || can(me.roles as string[], me.isSuperAdmin, 'payroll', 'listByStaff');
  const canActivity = me.isSuperAdmin || can(me.roles as string[], me.isSuperAdmin, 'user', 'viewActivity');

  // Decision 0031: STAFF_PASSWORD_LOGIN runs permanently alongside SSO — super_admin can set a
  // staff account's password (mirrors student.resetLmsPassword's one-time-reveal pattern).
  const [pwBusy, setPwBusy] = useState(false);
  const [pwResult, setPwResult] = useState<{ email: string; tempPassword: string } | null>(null);
  async function resetPassword() {
    setPwBusy(true);
    try {
      const r = await trpc.user.setPassword.mutate({ id: user.id });
      setPwResult(r);
    } catch (e) {
      notifyError(e, 'Đặt lại mật khẩu thất bại');
    } finally {
      setPwBusy(false);
    }
  }

  const facilityLabels = Object.fromEntries(facilities.map((f) => [f.id, `${f.code} — ${f.name}`])) as Record<number, string>;
  const facilityData = facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }));

  // Local view state so a save reflects immediately without a single-user getter.
  const [view, setView] = useState<StaffProfileUser>(user);
  useEffect(() => setView(user), [user]);

  const [editing, setEditing] = useState(false);
  const [activityKey, setActivityKey] = useState(0);
  // Bumped on Hủy to force-remount RecordDetailPanel (via `key`) so its internal form
  // state resets to the committed `view` — the primitive only auto-resets on entityId
  // change, not on an edit→cancel transition (P5 red-team note: read-mode inside the
  // primitive renders from the same live form data as edit-mode, so a stale unsaved
  // draft would otherwise leak into the read view after Cancel).
  const [formResetToken, setFormResetToken] = useState(0);

  const recordRef = useRef<RecordDetailHandle>(null);
  const [recordState, setRecordState] = useState<Pick<RecordDetailHandle, 'busy' | 'isDirty' | 'validationError' | 'data'>>({
    busy: false, isDirty: false, validationError: null, data: {},
  });

  const config: RecordDetailConfig = {
    entityType: 'staff',
    entityId: view.id,
    data: {
      id: view.id,
      email: view.email,
      displayName: view.displayName,
      phone: view.phone ?? '',
      roles: [...view.roles],
      primaryRole: view.primaryRole,
      facilityIds: view.facilities.map((f) => String(f.facilityId)),
      isActive: view.isActive,
    },
    canEdit: (session) => session.isSuperAdmin,
    // Mirrors the pre-migration `roleEditInvalid` + displayName-required Save gate —
    // `view` closes over the last-committed record so "unchanged roles" never trips
    // the ≥1-role/primary-role check (only an in-progress edit can reach that state).
    validate: (data) => {
      if (!String(data.displayName ?? '').trim()) return 'Tên hiển thị không được để trống';
      const roles = (data.roles as string[]) ?? [];
      const primaryRole = (data.primaryRole as string | null) ?? null;
      const rolesChanged =
        roles.slice().sort().join(',') !== [...view.roles].sort().join(',') || primaryRole !== view.primaryRole;
      if (rolesChanged && (roles.length === 0 || !primaryRole)) {
        return roles.length === 0 ? 'Phải có ít nhất một vai trò.' : 'Chọn vai trò chính để lưu.';
      }
      return null;
    },
    sections: [
      {
        name: 'Định danh',
        fields: [
          { key: 'displayName', label: 'Tên hiển thị', type: 'text' },
          { key: 'email', label: 'Email (SSO — khóa)', type: 'email', readOnly: true },
          { key: 'phone', label: 'Số điện thoại', type: 'text' },
          {
            key: 'isActive', label: 'Trạng thái', type: 'switch', readOnly: true,
            render: (value) => (value ? 'Đang hoạt động' : 'Ngừng'),
          },
        ],
      },
      {
        name: 'Phân quyền',
        fields: [
          {
            key: 'roles', label: 'Vai trò', type: 'multiselect', options: roleOptions,
            onFieldChange: (data) => {
              const roles = (data.roles as string[]) ?? [];
              const primaryRole = data.primaryRole as string | null;
              if (primaryRole && !roles.includes(primaryRole)) return { primaryRole: null };
            },
            render: (value, data) => (
              <>
                {((value as string[]) ?? []).map((r, i) => (
                  <Badge key={r} variant="light" radius="xl" ml={i > 0 ? 4 : 0}>
                    {ROLE_LABEL[r] ?? r}{r === data.primaryRole ? ' ★' : ''}
                  </Badge>
                ))}
              </>
            ),
          },
          {
            key: 'primaryRole', label: 'Vai trò chính', type: 'select',
            options: (data) => ((data.roles as string[]) ?? []).map((r) => ({ value: r, label: r })),
          },
          {
            key: 'facilityIds', label: 'Cơ sở được truy cập', type: 'multiselect', options: facilityData,
            render: (value) => {
              const ids = (value as string[]) ?? [];
              return ids.length === 0 ? '—' : (
                <>
                  {ids.map((id, i) => (
                    <Badge key={id} variant="outline" radius="xl" ml={i > 0 ? 4 : 0}>
                      {facilityLabels[Number(id)] ?? `#${id}`}
                    </Badge>
                  ))}
                </>
              );
            },
          },
          { key: 'isActive', label: 'Đang hoạt động', type: 'switch' },
        ],
      },
    ],
    tabs: [
      { value: 'employment', label: 'Hồ sơ nhân sự', component: EmploymentTabAdapter },
      ...(canPayroll ? [{
        value: 'payroll', label: 'Lương & phụ cấp', component: PayrollTabAdapter,
      }] : []),
    ],
    ...(canActivity ? {
      activityLog: {
        fetchEndpoint: (entityId: string) => trpc.audit.staffTimeline.query({ userId: entityId }),
        fieldLabels: STAFF_FIELD_LABELS,
        formatValue: staffFormatValue,
      },
    } : {}),
    onSave: async (data) => {
      const displayName = String(data.displayName ?? '').trim();
      const phone = String(data.phone ?? '').trim();
      const roles = (data.roles as string[]) ?? [];
      const primaryRole = (data.primaryRole as string | null) ?? null;
      const facilityIds = ((data.facilityIds as string[]) ?? []).map(Number);
      const isActive = !!data.isActive;
      const rolesChanged =
        roles.slice().sort().join(',') !== [...view.roles].sort().join(',') || primaryRole !== view.primaryRole;

      // Batch only the mutations whose values actually changed — one logical save.
      if (displayName !== view.displayName || (phone || null) !== (view.phone ?? null)) {
        await trpc.user.updateProfile.mutate({ id: view.id, displayName, phone: phone || null });
      }
      if (rolesChanged && primaryRole) {
        await trpc.user.setRoles.mutate({ id: view.id, roles: roles as RoleArr, primaryRole: primaryRole as RoleArr[number] });
      }
      if (sortedNums(facilityIds) !== sortedNums(view.facilities.map((f) => f.facilityId))) {
        await trpc.user.setFacilities.mutate({ id: view.id, facilityIds });
      }
      if (isActive !== view.isActive) {
        await trpc.user.setActive.mutate({ id: view.id, isActive });
      }
      // Reflect locally + refresh the list behind + re-pull the activity log.
      setView({
        ...view,
        displayName,
        phone: phone || null,
        roles: [...roles],
        primaryRole: primaryRole ?? view.primaryRole,
        isActive,
        facilities: facilityIds.map((facilityId) => ({ facilityId })),
      });
      setActivityKey((k) => k + 1);
      reload();
      notifySuccess('Đã lưu thay đổi');
    },
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <ActionIcon variant="subtle" onClick={onBack} title="Quay lại danh sách" aria-label="Quay lại danh sách">
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Title order={5}>{view.displayName}</Title>
          {!view.isActive && <Badge color="gray" variant="light" radius="xl" size="xs">Ngừng</Badge>}
        </Group>
        {canEdit && (
          editing ? (
            <Group gap="xs">
              <Button
                variant="default" size="xs" disabled={recordState.busy}
                onClick={() => { setEditing(false); setFormResetToken((k) => k + 1); }}
              >
                Hủy
              </Button>
              <Button
                variant="filled" radius={9999} size="xs" loading={recordState.busy}
                onClick={() => recordRef.current?.save()}
                disabled={!!recordState.validationError}
              >
                Lưu
              </Button>
            </Group>
          ) : (
            <Group gap="xs">
              <Button variant="default" size="xs" loading={pwBusy} onClick={resetPassword}>Đặt lại mật khẩu</Button>
              <Button variant="light" size="xs" leftSection={<IconPencil size={14} />} onClick={() => setEditing(true)}>Chỉnh sửa</Button>
            </Group>
          )
        )}
      </Group>

      {editing && (
        <Stack gap={2}>
          <Text size="xs" c="dimmed">Đổi vai trò / cơ sở / trạng thái sẽ vô hiệu hóa các phiên đăng nhập hiện tại.</Text>
          {recordState.validationError && <Text size="xs" c="red">{recordState.validationError}</Text>}
        </Stack>
      )}

      <Modal opened={!!pwResult} onClose={() => setPwResult(null)} title="Mật khẩu mới" size="sm">
        <Stack>
          <Text size="sm">Chỉ hiện <strong>một lần</strong> — gửi cho {pwResult?.email} qua kênh an toàn (không lưu lại ở đâu khác).</Text>
          <Text ff="monospace" fw={700} size="lg" ta="center" style={{ userSelect: 'all' }}>{pwResult?.tempPassword}</Text>
          <Button onClick={() => setPwResult(null)}>Đã lưu, đóng</Button>
        </Stack>
      </Modal>

      <Card radius="sm" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
        <Group align="center" gap="lg" wrap="nowrap">
          <div style={{ position: 'relative', width: 128, height: 128, flexShrink: 0 }}>
            <InitialsAvatar name={view.displayName} size={128} />
            {view.isActive && (
              <span
                aria-hidden="true"
                title="Đang hoạt động"
                style={{
                  position: 'absolute',
                  bottom: 6,
                  right: 6,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: 'var(--cmc-status-active)',
                  border: '3px solid var(--cmc-surface)',
                }}
              />
            )}
          </div>
          <Stack gap="xs" style={{ minWidth: 0 }}>
            <Text fw={600} size="lg">{view.displayName}</Text>
            <Text size="sm" c="dimmed">{view.email}</Text>
            <Group gap="xs" wrap="wrap">
              {view.roles.map((r) => (
                <StatusBadge
                  key={r}
                  status={r}
                  tone="info"
                  pill
                  label={`${ROLE_LABEL[r] ?? r}${r === view.primaryRole ? ' ★' : ''}`}
                />
              ))}
            </Group>
          </Stack>
        </Group>
      </Card>

      <RecordDetailPanel
        key={`${view.id}-${formResetToken}`}
        ref={recordRef}
        config={config}
        refreshKey={activityKey}
        editing={editing}
        onEditingChange={setEditing}
        onStateChange={setRecordState}
      />
    </Stack>
  );
}
