// Staff Profile — read-only unified detail page for one staff member (plan U1).
// Reuses the student-detail.tsx pattern (multi-tab + back button). Tabs lazy-load from EXISTING
// permission-gated tRPC procedures, so a viewer without payroll permission never receives salary
// data over the wire (the salary tab is hidden AND its query never fires). No new write power here;
// editing still happens through the existing UserEditModal. Activity-log tab is a U3 placeholder —
// it must NOT reuse the open Chatter path (audit NOTE_TARGETS deliberately excludes `user`).

import { useEffect, useState } from 'react';
import { trpc, useSession, notifyError } from '@cmc/ui';
import { can } from '@cmc/auth/permissions';
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';

type EmploymentProfile = Awaited<ReturnType<typeof trpc.payroll.profileList.query>>[number];
type SalaryRate = Awaited<ReturnType<typeof trpc.payroll.rateList.query>>[number];
type Payslip = Awaited<ReturnType<typeof trpc.payroll.listByStaff.query>>[number];

/** Structural subset of the admin `User` row (user.list) needed to render a profile. */
export interface StaffProfileUser {
  id: string;
  email: string;
  displayName: string;
  roles: readonly string[];
  primaryRole: string;
  isActive: boolean;
  facilities: readonly { facilityId: number }[];
}

const TH: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

const money = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

/** Two-column read-only field row. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" style={{ textAlign: 'right' }}>{value ?? '—'}</Text>
    </Group>
  );
}

// ─── Hồ sơ (identity + employment) ───────────────────────────────────────────
function ProfileTab({ user }: { user: StaffProfileUser }) {
  const { me } = useSession();
  // Employment lives in EmploymentProfile (gated payroll.profileList). super_admin bypasses can().
  const canEmployment = me.isSuperAdmin || can(me.roles as string[], me.isSuperAdmin, 'payroll', 'profileList');
  const firstFacility = user.facilities[0]?.facilityId ?? null;

  const [profile, setProfile] = useState<EmploymentProfile | null>(null);
  const [loading, setLoading] = useState(canEmployment && firstFacility != null);

  useEffect(() => {
    if (!canEmployment || firstFacility == null) return;
    setLoading(true);
    trpc.payroll.profileList
      .query({ facilityId: firstFacility })
      .then((rows) => setProfile(rows.find((r) => r.userId === user.id) ?? null))
      .catch((e) => notifyError(e, 'Không tải được hồ sơ nhân sự'))
      .finally(() => setLoading(false));
  }, [canEmployment, firstFacility, user.id]);

  return (
    <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
      <Stack gap="xs">
        <Text fw={600}>Định danh</Text>
        <Field label="Họ tên" value={user.displayName} />
        <Field label="Email (đăng nhập SSO)" value={user.email} />
        <Field label="Vai trò chính" value={user.primaryRole} />
        <Field label="Trạng thái" value={user.isActive ? 'Đang hoạt động' : 'Ngừng'} />

        {canEmployment && (
          <>
            <Text fw={600} mt="md">Hồ sơ nhân sự</Text>
            {loading ? (
              <Skeleton height={12} radius="xl" />
            ) : profile ? (
              <>
                <Field label="Vị trí" value={profile.position} />
                <Field label="Bậc lương" value={profile.grade} />
                <Field label="Người phụ thuộc" value={profile.dependents} />
                <Field label="Số máy nhánh (Callio)" value={profile.callioExt} />
                <Field
                  label="Ngày vào làm"
                  value={profile.startedAt ? new Date(profile.startedAt).toLocaleDateString('vi-VN') : '—'}
                />
              </>
            ) : (
              <Text size="sm" c="dimmed">Chưa có hồ sơ nhân sự cho người dùng này.</Text>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}

// ─── Phân quyền (read-only display) ──────────────────────────────────────────
function AccessTab({ user, facilityLabels }: { user: StaffProfileUser; facilityLabels: Record<number, string> }) {
  return (
    <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
      <Stack gap="sm">
        <div>
          <Text size="sm" c="dimmed" mb={4}>Vai trò</Text>
          <Group gap="xs">
            {user.roles.map((r) => (
              <Badge key={r} variant="light" radius="xl">{r}{r === user.primaryRole ? ' ★' : ''}</Badge>
            ))}
          </Group>
        </div>
        <div>
          <Text size="sm" c="dimmed" mb={4}>Cơ sở được truy cập</Text>
          <Group gap="xs">
            {user.facilities.length === 0 ? (
              <Text size="sm" c="dimmed">—</Text>
            ) : (
              user.facilities.map((f) => (
                <Badge key={f.facilityId} variant="outline" radius="xl">
                  {facilityLabels[f.facilityId] ?? `#${f.facilityId}`}
                </Badge>
              ))
            )}
          </Group>
        </div>
        <Text size="xs" c="dimmed">
          Sửa vai trò / cơ sở / trạng thái ở nút “Sửa” trong danh sách người dùng (chỉ super admin).
        </Text>
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
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH}>Hiệu lực từ</Table.Th>
                <Table.Th style={TH}>Lương cơ bản</Table.Th>
                <Table.Th style={TH}>Phụ cấp ăn</Table.Th>
                <Table.Th style={TH}>Phụ cấp khác</Table.Th>
              </Table.Tr>
            </Table.Thead>
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
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH}>Kỳ</Table.Th>
                <Table.Th style={TH}>Trạng thái</Table.Th>
                <Table.Th style={TH}>Xếp hạng KPI</Table.Th>
                <Table.Th style={TH}>Thực nhận</Table.Th>
              </Table.Tr>
            </Table.Thead>
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

// ─── Main export ─────────────────────────────────────────────────────────────
export function StaffProfilePanel({
  user,
  facilityLabels,
  onBack,
}: {
  user: StaffProfileUser;
  facilityLabels: Record<number, string>;
  onBack: () => void;
}) {
  const { me } = useSession();
  // Salary tab is hidden AND never queried unless the viewer is allowed to read payslips.
  const canPayroll = me.isSuperAdmin || can(me.roles as string[], me.isSuperAdmin, 'payroll', 'listByStaff');

  return (
    <Stack>
      <Group>
        <ActionIcon variant="subtle" onClick={onBack} title="Quay lại danh sách">
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Title order={5}>{user.displayName}</Title>
        {!user.isActive && <Badge color="gray" variant="light" radius="xl" size="xs">Ngừng</Badge>}
      </Group>

      <Tabs defaultValue="profile" variant="outline">
        <Tabs.List>
          <Tabs.Tab value="profile">Hồ sơ</Tabs.Tab>
          <Tabs.Tab value="access">Phân quyền</Tabs.Tab>
          {canPayroll && <Tabs.Tab value="payroll">Lương &amp; phụ cấp</Tabs.Tab>}
          <Tabs.Tab value="history">Nhật ký</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="profile" pt="md">
          <ProfileTab user={user} />
        </Tabs.Panel>

        <Tabs.Panel value="access" pt="md">
          <AccessTab user={user} facilityLabels={facilityLabels} />
        </Tabs.Panel>

        {canPayroll && (
          <Tabs.Panel value="payroll" pt="md">
            <PayrollTab user={user} />
          </Tabs.Panel>
        )}

        <Tabs.Panel value="history" pt="md">
          {/* U3: secure facility-scoped staff activity log. NOT the open Chatter path — audit
              NOTE_TARGETS deliberately excludes `user` for RLS reasons. Placeholder until U3. */}
          <Text size="sm" c="dimmed">Nhật ký hoạt động nhân sự sẽ có ở bước U3 (kênh bảo mật riêng).</Text>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
