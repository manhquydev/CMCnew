// Staff record page (Odoo-style single surface) — plan R0/R1/R2.
// ONE page for a staff member: read by default, a header "Chỉnh sửa" unlocks only the fields the
// caller may write (super_admin for F0), with a single Lưu/Hủy that batches the underlying mutations
// (updateProfile + setRoles/setFacilities/setActive) so a partial save can't happen. The activity
// log is INLINE in a right column (stacks below on mobile), fed by the SECURE audit.staffTimeline
// endpoint (facility-scoped + permission-gated) — never the open Chatter path. Salary/employment
// tabs lazy-load behind their own permission gates so unprivileged roles never over-fetch them.

import { useEffect, useState } from 'react';
import { trpc, useSession, notifyError, notifySuccess, ActivityLog } from '@cmc/ui';
import { can, canReadSensitiveHr, maskSensitive } from '@cmc/auth/permissions';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Fieldset,
  Grid,
  Group,
  Modal,
  MultiSelect,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconArrowLeft, IconPencil } from '@tabler/icons-react';

type EmploymentProfile = Awaited<ReturnType<typeof trpc.payroll.profileList.query>>[number];
type SalaryRate = Awaited<ReturnType<typeof trpc.payroll.rateList.query>>[number];
type Payslip = Awaited<ReturnType<typeof trpc.payroll.listByStaff.query>>[number];
type TimelineEntry = Awaited<ReturnType<typeof trpc.audit.staffTimeline.query>>[number];
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
              <TextInput label="Ngày vào làm" value={form.startedAt} onChange={(e) => setForm({ ...form, startedAt: e.currentTarget.value })} placeholder="YYYY-MM-DD" />
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

// ─── Activity log (secure fetch + shared <ActivityLog> primitive) ────────────
// Field labels + value formatting for the staff entity; the generic rendering lives in @cmc/ui.
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

function StaffActivityLog({ userId, refreshKey }: { userId: string; refreshKey: number }) {
  const [rows, setRows] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    trpc.audit.staffTimeline
      .query({ userId })
      .then(setRows)
      .catch((e) => notifyError(e, 'Không tải được nhật ký'))
      .finally(() => setLoading(false));
  }, [userId, refreshKey]);

  return (
    <div style={{ position: 'sticky', top: 12 }}>
      <ActivityLog entries={rows} loading={loading} fieldLabels={STAFF_FIELD_LABELS} formatValue={staffFormatValue} />
    </div>
  );
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
  roleOptions: string[];
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
  const [busy, setBusy] = useState(false);
  const [activityKey, setActivityKey] = useState(0);

  // Edit form state
  const [displayName, setDisplayName] = useState(view.displayName);
  const [phone, setPhone] = useState(view.phone ?? '');
  const [roles, setRoles] = useState<string[]>([...view.roles]);
  const [primaryRole, setPrimaryRole] = useState<string | null>(view.primaryRole);
  const [facilityIds, setFacilityIds] = useState<string[]>(view.facilities.map((f) => String(f.facilityId)));
  const [isActive, setIsActive] = useState(view.isActive);

  function beginEdit() {
    setDisplayName(view.displayName);
    setPhone(view.phone ?? '');
    setRoles([...view.roles]);
    setPrimaryRole(view.primaryRole);
    setFacilityIds(view.facilities.map((f) => String(f.facilityId)));
    setIsActive(view.isActive);
    setEditing(true);
  }

  const rolesChanged =
    roles.slice().sort().join(',') !== [...view.roles].sort().join(',')
    || primaryRole !== view.primaryRole;
  // A role edit is only valid with ≥1 role AND a primary role within them. Surfacing this (vs the
  // earlier silent skip) prevents a dropped setRoles call from showing a false "saved" state.
  const roleEditInvalid = rolesChanged && (roles.length === 0 || !primaryRole);

  async function save() {
    if (roleEditInvalid) {
      notifyError(
        new Error(roles.length === 0 ? 'Phải có ít nhất một vai trò' : 'Chọn vai trò chính'),
        'Lưu thất bại',
      );
      return;
    }
    setBusy(true);
    try {
      const fIds = facilityIds.map(Number);
      // Batch only the mutations whose values actually changed — one logical save.
      if (displayName.trim() !== view.displayName || (phone.trim() || null) !== (view.phone ?? null)) {
        await trpc.user.updateProfile.mutate({ id: view.id, displayName: displayName.trim(), phone: phone.trim() || null });
      }
      if (rolesChanged && primaryRole) {
        await trpc.user.setRoles.mutate({ id: view.id, roles: roles as RoleArr, primaryRole: primaryRole as RoleArr[number] });
      }
      if (sortedNums(fIds) !== sortedNums(view.facilities.map((f) => f.facilityId))) {
        await trpc.user.setFacilities.mutate({ id: view.id, facilityIds: fIds });
      }
      if (isActive !== view.isActive) {
        await trpc.user.setActive.mutate({ id: view.id, isActive });
      }
      // Reflect locally + refresh the list behind + re-pull the activity log.
      setView({
        ...view,
        displayName: displayName.trim(),
        phone: phone.trim() || null,
        roles: [...roles],
        primaryRole: primaryRole ?? view.primaryRole,
        isActive,
        facilities: fIds.map((facilityId) => ({ facilityId })),
      });
      setEditing(false);
      setActivityKey((k) => k + 1);
      reload();
      notifySuccess('Đã lưu thay đổi');
    } catch (e) {
      notifyError(e, 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }

  const sheet = (
    <Stack>
      <Fieldset legend="Định danh">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {editing ? (
            <TextInput label="Tên hiển thị" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
          ) : (
            <Field label="Tên hiển thị" value={view.displayName} />
          )}
          <Field label="Email (SSO — khóa)" value={view.email} />
          {editing ? (
            <TextInput label="Số điện thoại" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
          ) : (
            <Field label="Số điện thoại" value={view.phone || '—'} />
          )}
          <Field label="Trạng thái" value={view.isActive ? 'Đang hoạt động' : 'Ngừng'} />
        </SimpleGrid>
      </Fieldset>

      <Fieldset legend="Phân quyền">
        {editing && canEdit ? (
          <Stack gap="sm">
            <MultiSelect
              label="Vai trò" data={roleOptions} value={roles}
              onChange={(v) => { setRoles(v); if (primaryRole && !v.includes(primaryRole)) setPrimaryRole(null); }}
            />
            <Select label="Vai trò chính" data={roles} value={primaryRole} onChange={setPrimaryRole} disabled={roles.length === 0} />
            {roleEditInvalid && (
              <Text size="xs" c="red">
                {roles.length === 0 ? 'Phải có ít nhất một vai trò.' : 'Chọn vai trò chính để lưu.'}
              </Text>
            )}
            <MultiSelect label="Cơ sở được truy cập" data={facilityData} value={facilityIds} onChange={setFacilityIds} />
            <Switch label="Đang hoạt động" checked={isActive} onChange={(e) => setIsActive(e.currentTarget.checked)} />
            <Text size="xs" c="dimmed">Đổi vai trò / cơ sở / trạng thái sẽ vô hiệu hóa các phiên đăng nhập hiện tại.</Text>
          </Stack>
        ) : (
          <Stack gap="sm">
            <div>
              <Text size="sm" c="dimmed" mb={4}>Vai trò</Text>
              <Group gap="xs">
                {view.roles.map((r) => (
                  <Badge key={r} variant="light" radius="xl">{r}{r === view.primaryRole ? ' ★' : ''}</Badge>
                ))}
              </Group>
            </div>
            <div>
              <Text size="sm" c="dimmed" mb={4}>Cơ sở được truy cập</Text>
              <Group gap="xs">
                {view.facilities.length === 0 ? <Text size="sm" c="dimmed">—</Text> :
                  view.facilities.map((f) => (
                    <Badge key={f.facilityId} variant="outline" radius="xl">{facilityLabels[f.facilityId] ?? `#${f.facilityId}`}</Badge>
                  ))}
              </Group>
            </div>
          </Stack>
        )}
      </Fieldset>

      <Tabs defaultValue="employment" variant="outline">
        <Tabs.List>
          <Tabs.Tab value="employment">Hồ sơ nhân sự</Tabs.Tab>
          {canPayroll && <Tabs.Tab value="payroll">Lương &amp; phụ cấp</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="employment" pt="md"><EmploymentTab user={view} /></Tabs.Panel>
        {canPayroll && <Tabs.Panel value="payroll" pt="md"><PayrollTab user={view} /></Tabs.Panel>}
      </Tabs>
    </Stack>
  );

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
              <Button variant="default" size="xs" onClick={() => setEditing(false)} disabled={busy}>Hủy</Button>
              <Button variant="filled" radius={9999} size="xs" loading={busy} onClick={save} disabled={displayName.trim().length === 0 || roleEditInvalid}>Lưu</Button>
            </Group>
          ) : (
            <Group gap="xs">
              <Button variant="default" size="xs" loading={pwBusy} onClick={resetPassword}>Đặt lại mật khẩu</Button>
              <Button variant="light" size="xs" leftSection={<IconPencil size={14} />} onClick={beginEdit}>Chỉnh sửa</Button>
            </Group>
          )
        )}
      </Group>

      <Modal opened={!!pwResult} onClose={() => setPwResult(null)} title="Mật khẩu mới" size="sm">
        <Stack>
          <Text size="sm">Chỉ hiện <strong>một lần</strong> — gửi cho {pwResult?.email} qua kênh an toàn (không lưu lại ở đâu khác).</Text>
          <Text ff="monospace" fw={700} size="lg" ta="center" style={{ userSelect: 'all' }}>{pwResult?.tempPassword}</Text>
          <Button onClick={() => setPwResult(null)}>Đã lưu, đóng</Button>
        </Stack>
      </Modal>

      {canActivity ? (
        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 8 }}>{sheet}</Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}><StaffActivityLog userId={view.id} refreshKey={activityKey} /></Grid.Col>
        </Grid>
      ) : (
        sheet
      )}
    </Stack>
  );
}
