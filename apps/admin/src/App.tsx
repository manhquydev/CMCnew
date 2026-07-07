import '@mantine/dates/styles.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LoginGate,
  trpc,
  useSession,
  notifyError,
  notifySuccess,
  required,
  email,
  minLength,
  combine,
  toApiDate,
  parseApiDate,
} from '@cmc/ui';
import { assignableRoles, can, ROLE_LABEL } from '@cmc/auth/permissions';
import { NAV_GATES } from './nav-permissions.js';
import { useForm } from '@mantine/form';
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { IconCircleX, IconCircleCheck, IconPlus } from '@tabler/icons-react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { DesignShowcase } from './design-showcase';
import { CoursesPanel } from './courses-panel';
import { StudentManagementPanel } from './student-management-panel';
import { PayrollCheckinPanel } from './payroll-checkin-panel';
import { BizDirectorCockpitPanel } from './biz-director-cockpit-panel';
import { EduDirectorCockpitPanel } from './edu-director-cockpit-panel';

// Panels — admin-native
import { GuardiansPanel } from './guardians-panel';
import { OverviewPanel } from './overview-panel';
import { CompensationConfigPanel } from './compensation-panel';
import { PayrollPanel } from './payroll-panel';
import { KpiEvaluationPanel } from './kpi-evaluation-panel';
import { FamilyIntakePanel, FinancePanel } from './finance-panel';
import { TeacherLiteIntakePanel } from './teacher-lite-intake-panel';
import { EmailOutboxPanel } from './email-outbox-panel';
import { RevenueReportPanel } from './revenue-report';
import { AttendanceReportPanel } from './attendance-report-panel';
import { ReconcileWorklistPanel } from './reconcile-worklist';
import { CrmPanel } from './crm-panel';
import { CskhPanel } from './cskh-panel';
import { StudentsPanel } from './students-panel';
import { RewardsPanel } from './rewards-panel';
import { BadgePanel } from './badge-panel';
import { TermsPanel } from './terms-panel';
// Panels — ported from teaching
import { GradingPanel } from './grading';
import { AssessmentPanel } from './assessment-panel';
import { AttendancePanel } from './attendance-panel';
import { SchedulePanel } from './schedule-panel';
import { MeetingsPanel } from './meetings-panel';
import { LevelApprovalPanel } from './level-approval-panel';
import { CertificatePanel } from './certificate-panel';
import { MyPayslipsPanel } from './my-payslips-panel';
import { CheckInPanel } from './checkin-panel';
import { ShiftRegListPanel } from './shift-reg-list-panel';
import { ShiftRegDetailPanel } from './shift-reg-detail-panel';
import { FacilityNetworkPanel } from './facility-network-panel';
import { ShiftConfigPanel } from './shift-config-panel';
import { Workspace, type NavAction } from './class-workspace';

import { Shell, buildNavGroups, SECTION_TITLES, type SectionKey } from './shell';
import { moduleOf } from './nav-modules';
import { applyAdminMetadata, getAdminMetadata } from './link-preview-metadata';
import {
  currentAppSurface,
  isTeacherSurfaceRole,
  isTeacherSurfaceSection,
  SURFACE_COPY,
  type AppSurface,
} from './app-surface';
import { StaffProfilePanel } from './staff-profile';
import { ProfileSettingsPanel } from './profile-settings-panel';
import { ScheduleDetailPanel } from './schedule-detail';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type User = Awaited<ReturnType<typeof trpc.user.list.query>>[number];
type MySession = Awaited<ReturnType<typeof trpc.schedule.mySessions.query>>[number];
type Session = ReturnType<typeof useSession>['me'];

// ts is a monotonic timestamp so selecting the same record twice in a row still re-triggers —
// same trick as class-workspace.tsx's NavAction.
export interface SearchNavAction {
  id: string;
  ts: number;
}

// ─── Table header style ────────────────────────────────────────────────────────

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

// ─── Persona → default landing ─────────────────────────────────────────────────

function defaultSection(me: Session, surface: AppSurface = 'erp'): SectionKey {
  if (surface === 'teacher') {
    if (me.roles.includes('giam_doc_dao_tao')) return 'edu-director-cockpit';
    if (me.roles.includes('giao_vien')) return 'schedule';
    if (me.roles.includes('giam_doc_kinh_doanh')) return 'family-intake';
    return 'profile';
  }
  if (me.isSuperAdmin) return 'overview';
  if (me.roles.includes('giao_vien')) return 'schedule';
  if (me.roles.includes('sale') || me.roles.includes('ctv_mkt')) return 'crm';
  if (me.roles.includes('ke_toan')) return 'finance';
  if (me.roles.includes('hr')) return 'hr';
  if (me.roles.includes('cskh')) return 'cskh';
  // Biz-director-only lands on the Executive Cockpit (replaces 'overview' for this persona —
  // mirrors the isBizDirectorOnly strict single-role check in shell.tsx/buildNavGroups()).
  if (me.roles.length === 1 && me.roles[0] === 'giam_doc_kinh_doanh') return 'biz-director-cockpit';
  // Edu-director-only lands on its own Executive Cockpit — mirrors the isEduDirectorOnly strict
  // single-role check in shell.tsx/buildNavGroups().
  if (me.roles.length === 1 && me.roles[0] === 'giam_doc_dao_tao') return 'edu-director-cockpit';
  // Exec roles can see the dashboard (dashboard.summary); land them there. Any other role
  // falls back to an always-open section so the landing never 403s.
  if (me.roles.includes('giam_doc_kinh_doanh') || me.roles.includes('giam_doc_dao_tao'))
    return 'overview';
  return 'schedule';
}

// ─── Facilities ───────────────────────────────────────────────────────────────

// Edit existing facility metadata (code/name/address/isActive) via the existing
// super-admin-only facility.update endpoint (plan U2). Create stays in Facilities below.
function FacilityEditModal({
  facility,
  close,
  reload,
}: {
  facility: Facility | null;
  close: () => void;
  reload: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!facility) return;
    setCode(facility.code);
    setName(facility.name);
    setAddress(facility.address ?? '');
    setIsActive(facility.isActive);
  }, [facility]);

  if (!facility) return null;

  async function save() {
    if (!facility) return;
    setBusy(true);
    try {
      await trpc.facility.update.mutate({ id: facility.id, code, name, address, isActive });
      notifySuccess('Đã cập nhật cơ sở');
      close();
      reload();
    } catch (e) {
      notifyError(e, 'Cập nhật cơ sở thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={!!facility} onClose={close} title={`Sửa cơ sở: ${facility.code}`} radius="xl" centered>
      <Stack>
        <TextInput label="Mã" value={code} onChange={(e) => setCode(e.currentTarget.value)} />
        <TextInput label="Tên" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label="Địa chỉ" value={address} onChange={(e) => setAddress(e.currentTarget.value)} />
        <Switch label="Đang hoạt động" checked={isActive} onChange={(e) => setIsActive(e.currentTarget.checked)} />
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={close}>Hủy</Button>
          <Button variant="filled" radius={9999} loading={busy} onClick={save} disabled={!code || !name}>Lưu</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Facilities({ facilities, reload }: { facilities: Facility[]; reload: () => void }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<Facility | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { code: '', name: '', address: '' },
    validate: {
      code: combine(required('Nhập mã cơ sở'), minLength(2, 'Mã cần tối thiểu 2 ký tự')),
      name: required('Nhập tên cơ sở'),
    },
  });

  async function create(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.facility.create.mutate({
        code: values.code,
        name: values.name,
        address: values.address || undefined,
      });
      notifySuccess(`Đã tạo cơ sở "${values.name}"`);
      close();
      form.reset();
      reload();
    } catch (e) {
      notifyError(e, 'Tạo cơ sở thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Group justify="space-between" mb="md">
        <Text fw={600} style={{ color: 'var(--cmc-text)' }}>Cơ sở ({facilities.length})</Text>
        <Button variant="filled" radius={9999} size="xs" leftSection={<IconPlus size={14} />} onClick={open}>
          Tạo cơ sở
        </Button>
      </Group>
      <Table striped highlightOnHover withTableBorder={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={TH_STYLE}>#</Table.Th>
            <Table.Th style={TH_STYLE}>Mã</Table.Th>
            <Table.Th style={TH_STYLE}>Tên</Table.Th>
            <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
            <Table.Th style={{ ...TH_STYLE, width: 60 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {facilities.map((f) => (
            <Table.Tr key={f.id}>
              <Table.Td style={{ color: 'var(--cmc-text-muted)', fontSize: 13 }}>#{f.id}</Table.Td>
              <Table.Td><Text fw={500} size="sm">{f.code}</Text></Table.Td>
              <Table.Td>{f.name}</Table.Td>
              <Table.Td>
                {f.isActive ? (
                  <Group gap={4}>
                    <IconCircleCheck size={12} color="var(--cmc-status-active)" />
                    <Badge color="green" variant="light" radius="xl" size="sm">Hoạt động</Badge>
                  </Group>
                ) : (
                  <Group gap={4}>
                    <IconCircleX size={12} color="var(--cmc-status-inactive)" />
                    <Badge color="gray" variant="light" radius="xl" size="sm">Ngừng</Badge>
                  </Group>
                )}
              </Table.Td>
              <Table.Td>
                <Button variant="subtle" size="compact-xs" onClick={() => setEditing(f)}>Sửa</Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <FacilityEditModal facility={editing} close={() => setEditing(null)} reload={reload} />

      <Modal opened={opened} onClose={close} title="Tạo cơ sở" radius="xl" centered>
        <form onSubmit={form.onSubmit(create)}>
          <Stack>
            <TextInput label="Mã" placeholder="VD: CS3" withAsterisk {...form.getInputProps('code')} />
            <TextInput label="Tên" withAsterisk {...form.getInputProps('name')} />
            <TextInput label="Địa chỉ" {...form.getInputProps('address')} />
            <Group justify="flex-end" mt="xs">
              <Button variant="subtle" onClick={close}>Hủy</Button>
              <Button type="submit" variant="filled" radius={9999} loading={busy}>Tạo</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Card>
  );
}

// ─── User modals ──────────────────────────────────────────────────────────────

function UserCreateModal({
  opened,
  close,
  facilities,
  reload,
  roleOptions,
}: {
  opened: boolean;
  close: () => void;
  facilities: Facility[];
  reload: () => void;
  roleOptions: { value: string; label: string }[];
}) {
  const [roles, setRoles] = useState<string[]>([]);
  const [primaryRole, setPrimaryRole] = useState<string | null>(null);
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      email: '', displayName: '', phone: '', personalEmail: '',
      nationalId: '', startedAt: '', position: '',
    },
    validate: {
      email: email('Email không hợp lệ'),
      displayName: required('Nhập tên hiển thị'),
      phone: required('Nhập số điện thoại'),
      personalEmail: combine(required('Nhập email cá nhân'), email('Email cá nhân không hợp lệ')),
      nationalId: required('Nhập số CCCD/CMND'),
      startedAt: required('Chọn ngày vào làm'),
      position: required('Nhập vị trí công việc'),
    },
  });

  const facilityData = facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }));

  async function create(values: typeof form.values) {
    if (roles.length === 0) {
      notifyError(new Error('Chọn ít nhất một vai trò'), 'Tạo người dùng thất bại');
      return;
    }
    if (!primaryRole) {
      notifyError(new Error('Chọn vai trò chính'), 'Tạo người dùng thất bại');
      return;
    }
    if (facilityIds.length === 0) {
      notifyError(new Error('Chọn ít nhất một cơ sở được truy cập'), 'Tạo người dùng thất bại');
      return;
    }
    setBusy(true);
    try {
      await trpc.user.create.mutate({
        email: values.email,
        displayName: values.displayName,
        phone: values.phone,
        personalEmail: values.personalEmail,
        roles: roles as User['roles'],
        primaryRole: primaryRole as User['primaryRole'],
        facilityIds: facilityIds.map(Number),
        nationalId: values.nationalId,
        startedAt: values.startedAt,
        position: values.position,
      });
      notifySuccess(`Đã tạo người dùng "${values.displayName}"`);
      close();
      form.reset();
      setRoles([]);
      setPrimaryRole(null);
      setFacilityIds([]);
      reload();
    } catch (e) {
      notifyError(e, 'Tạo người dùng thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={close} title="Tạo người dùng" radius="xl" centered>
      <form onSubmit={form.onSubmit(create)}>
        <Stack>
          <Text size="xs" c="dimmed">
            Nhân sự đăng nhập bằng tài khoản CMC EDU (SSO Microsoft) — không cần đặt mật khẩu.
            Hệ thống gửi thông tin tài khoản tới email cá nhân bên dưới (nhân sự mới có thể chưa
            truy cập được hộp thư công ty ngay).
          </Text>
          <TextInput
            label="Email" withAsterisk
            description="Email công ty (CMC EDU) — dùng để đăng nhập SSO"
            {...form.getInputProps('email')}
          />
          <TextInput label="Tên hiển thị" withAsterisk {...form.getInputProps('displayName')} />
          <TextInput label="Số điện thoại" withAsterisk {...form.getInputProps('phone')} />
          <TextInput
            label="Email cá nhân" withAsterisk
            description="Nơi nhận thông tin tài khoản khi tạo mới — không phải email CMC EDU"
            {...form.getInputProps('personalEmail')}
          />
          <Text size="xs" c="dimmed" mt="xs">
            Hồ sơ nhân sự tối thiểu — bắt buộc, không thể bỏ qua (điền thêm chi tiết khác sau ở
            trang Hồ sơ nhân sự).
          </Text>
          <TextInput label="Vị trí công việc" withAsterisk {...form.getInputProps('position')} />
          <TextInput label="Số CCCD/CMND" withAsterisk {...form.getInputProps('nationalId')} />
          <DateInput
            label="Ngày vào làm" withAsterisk
            valueFormat="DD/MM/YYYY"
            value={parseApiDate(form.values.startedAt)}
            onChange={(d) => form.setFieldValue('startedAt', toApiDate(d) ?? '')}
            error={form.errors.startedAt}
          />
          <MultiSelect
            label="Vai trò" withAsterisk data={roleOptions}
            value={roles}
            onChange={(v) => { setRoles(v); if (primaryRole && !v.includes(primaryRole)) setPrimaryRole(null); }}
          />
          <Select
            label="Vai trò chính" withAsterisk data={roles} value={primaryRole} onChange={setPrimaryRole}
            disabled={roles.length === 0} placeholder={roles.length ? 'Chọn' : 'Chọn vai trò trước'}
          />
          <MultiSelect
            label="Cơ sở được truy cập" withAsterisk
            data={facilityData} value={facilityIds} onChange={setFacilityIds}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={close}>Hủy</Button>
            <Button type="submit" variant="filled" radius={9999} loading={busy}>Tạo</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ─── Users ────────────────────────────────────────────────────────────────────

function Users({
  users,
  facilities,
  reload,
  onView,
}: {
  users: User[];
  facilities: Facility[];
  reload: () => void;
  onView: (u: User) => void;
}) {
  const { me } = useSession();
  const [createOpen, { open, close }] = useDisclosure(false);

  // Role choices come from the registry-driven assignableRoles(session): super_admin sees every role
  // (incl. the two director roles); a director sees only their grant set. Keeps the dropdown in sync
  // with what user.create will actually accept — no hardcoded role list to drift.
  const roleOptions = useMemo(
    () =>
      [...assignableRoles({ isSuperAdmin: me.isSuperAdmin, roles: me.roles as string[] })]
        .sort()
        .map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r })),
    [me.isSuperAdmin, me.roles],
  );

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Group justify="space-between" mb="md">
        <Text fw={600} style={{ color: 'var(--cmc-text)' }}>Người dùng ({users.length})</Text>
        <Button variant="filled" radius={9999} size="xs" leftSection={<IconPlus size={14} />} onClick={open}>
          Tạo người dùng
        </Button>
      </Group>
      <Table striped highlightOnHover withTableBorder={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={TH_STYLE}>Tên</Table.Th>
            <Table.Th style={TH_STYLE}>Email</Table.Th>
            <Table.Th style={TH_STYLE}>Vai trò</Table.Th>
            <Table.Th style={TH_STYLE}>Cơ sở</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {/* Row click opens the staff record page (view + inline edit). No separate view/edit split. */}
          {users.map((u) => (
            <Table.Tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => onView(u)}>
              <Table.Td>
                <Group gap="xs">
                  <Text size="sm">{u.displayName}</Text>
                  {!u.isActive && <Badge color="gray" variant="light" radius="xl" size="xs">Ngừng</Badge>}
                </Group>
              </Table.Td>
              <Table.Td><Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>{u.email}</Text></Table.Td>
              <Table.Td><Text size="sm">{u.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}</Text></Table.Td>
              <Table.Td><Text size="sm">{u.facilities.length}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <UserCreateModal opened={createOpen} close={close} facilities={facilities} reload={reload} roleOptions={roleOptions} />
    </Card>
  );
}

// ─── Org (Cơ sở & Users) ─────────────────────────────────────────────────────

function OrgPanel({ initialStaffNav }: { initialStaffNav?: SearchNavAction | null }) {
  const { me } = useSession();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  // When a user is selected, the org section shows their staff record page (view + inline edit)
  // instead of the lists. Back returns to the lists.
  const [viewing, setViewing] = useState<User | null>(null);

  // Global-search deep link: pre-select a staff record once `users` has loaded. Retries on every
  // `users` change until the id is found (or the nav is superseded by a new ts), which tolerates
  // the async loadUsers() below still being in flight when this component mounts.
  const appliedStaffNavTs = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!initialStaffNav || initialStaffNav.ts === appliedStaffNavTs.current) return;
    const found = users.find((u) => u.id === initialStaffNav.id);
    if (!found) return;
    appliedStaffNavTs.current = initialStaffNav.ts;
    setViewing(found);
  }, [initialStaffNav, users]);

  const loadFacilities = () =>
    trpc.facility.list.query().then(setFacilities).catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  const loadUsers = () =>
    trpc.user.list.query().then(setUsers).catch((e) => notifyError(e, 'Không tải được danh sách người dùng'));

  useEffect(() => { loadFacilities(); loadUsers(); }, []);

  const roleOptions = useMemo(
    () =>
      [...assignableRoles({ isSuperAdmin: me.isSuperAdmin, roles: me.roles as string[] })]
        .sort()
        .map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r })),
    [me.isSuperAdmin, me.roles],
  );

  if (viewing) {
    return (
      <StaffProfilePanel
        user={viewing}
        facilities={facilities}
        roleOptions={roleOptions}
        onBack={() => setViewing(null)}
        reload={loadUsers}
      />
    );
  }

  return (
    <Stack>
      <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Cơ sở &amp; Người dùng</Text>
      <Facilities facilities={facilities} reload={loadFacilities} />
      <Users users={users} facilities={facilities} reload={loadUsers} onView={setViewing} />
    </Stack>
  );
}

// ─── HR / Payroll tab ─────────────────────────────────────────────────────────

function HrPayrollSection() {
  const { me } = useSession();
  const [facilityId, setFacilityId] = useState<string | null>(
    me.facilityIds.length > 0 ? String(me.facilityIds[0]) : null,
  );
  const facilityOptions = me.facilityIds.map((id) => ({ value: String(id), label: `Cơ sở #${id}` }));

  if (me.facilityIds.length === 0) {
    return <Text c="dimmed">Tài khoản chưa được gán cơ sở.</Text>;
  }

  return (
    <Stack>
      <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Nhân sự &amp; Lương</Text>
      {me.facilityIds.length > 1 && (
        <Select label="Cơ sở" data={facilityOptions} value={facilityId} onChange={setFacilityId} w={200} />
      )}
      {facilityId && <PayrollPanel facilityId={Number(facilityId)} />}
    </Stack>
  );
}

// ─── All valid section keys ────────────────────────────────────────────────────

const ALL_SECTION_KEYS = new Set<string>([
  'overview', 'courses', 'students', 'org', 'guardians',
  'hr', 'kpi', 'compensation', 'finance', 'family-intake', 'email-outbox', 'revenue-report', 'reconcile-worklist', 'crm', 'cskh', 'rewards', 'badges',
  'schedule', 'attendance', 'attendance-report', 'grading', 'assessment',
  // 'certificate' intentionally omitted: the feature is hidden from nav (shell.tsx visible:false),
  // so #certificate is not a reachable hash route either. Re-add when the feature is re-enabled.
  'classes', 'meetings', 'levelup', 'my-payslips',
  'checkin', 'shift-registration', 'facility-network', 'shift-config',
  'student-mgmt', 'payroll-checkin',
  'biz-director-cockpit', 'edu-director-cockpit',
  'profile',
]);

// ─── Work Shift Section ──────────────────────────────────────────────────────

function ShiftRegSection() {
  const [selectedRegId, setSelectedRegId] = useState<string | null>(null);

  if (selectedRegId) {
    return <ShiftRegDetailPanel regId={selectedRegId} onBack={() => setSelectedRegId(null)} />;
  }
  return <ShiftRegListPanel onSelect={(id) => setSelectedRegId(id)} />;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { me } = useSession();
  const navigate = useNavigate();
  const surface = currentAppSurface();
  // section comes from /:section; oppId from the CRM record route /crm/opportunities/:oppId.
  const params = useParams<{ section?: string; oppId?: string }>();
  const [navAction, setNavAction] = useState<NavAction | null>(null);
  // Selected lesson for the connected Session Detail view inside the schedule section.
  const [selectedSession, setSelectedSession] = useState<MySession | null>(null);
  // Global-search deep-link targets for entity types with no per-record URL route (students,
  // staff): mirrors navAction's ts-timestamp re-trigger trick so selecting the same record twice
  // in a row still re-applies. classBatches search results reuse goToClass/navAction as-is.
  const [studentNav, setStudentNav] = useState<SearchNavAction | null>(null);
  const [staffNav, setStaffNav] = useState<SearchNavAction | null>(null);

  // Active section is derived from the URL (single source of truth). A CRM record route
  // forces the crm section; a bare/unknown path falls back to the persona default.
  const oppId = params.oppId ?? null;
  const rawSection = oppId ? 'crm' : params.section;
  // Single "is this a real section?" check, reused by the active-section pick and the redirect.
  // MUST also re-check the section's own NAV_GATES permission (bug #7): the sidebar already hides
  // links a role can't use, but a direct URL/bookmark/back-forward bypasses that — without this
  // check, e.g. a giao_vien typing /overview would still reach a panel whose only query 403s,
  // reproducing the "Không tải được tổng quan" error the nav hiding was meant to prevent entirely.
  const isReachableSection = (key: string): key is SectionKey => {
    if (!ALL_SECTION_KEYS.has(key)) return false;
    const section = key as SectionKey;
    if (surface === 'teacher') {
      if (!isTeacherSurfaceRole(me.roles, me.isSuperAdmin)) return section === 'profile';
      if (!isTeacherSurfaceSection(section)) return false;
    } else if (section === 'family-intake') {
      return false;
    }
    if (
      section === 'finance' &&
      me.roles.includes('giam_doc_dao_tao') &&
      can(me.roles, me.isSuperAdmin, 'finance', 'receiptCreate')
    ) {
      return true;
    }
    const gate = NAV_GATES[section];
    if (gate.kind === 'open') return true;
    if (gate.kind === 'superAdmin') return me.isSuperAdmin;
    return can(me.roles, me.isSuperAdmin, gate.module, gate.action);
  };
  const knownSection = !!(rawSection && isReachableSection(rawSection));
  const activeSection: SectionKey = knownSection ? (rawSection as SectionKey) : defaultSection(me, surface);
  const activeModuleKey = moduleOf(activeSection);

  // Normalise "/" or an unknown section to the canonical persona-default path so the URL bar
  // always reflects a real section.
  useEffect(() => {
    if (!oppId && !knownSection) {
      navigate('/' + defaultSection(me, surface), { replace: true });
    }
  }, [oppId, knownSection, me, navigate, surface]);

  // Keep the browser tab and share metadata aligned with the current product surface.
  useEffect(() => {
    applyAdminMetadata(getAdminMetadata(activeSection, Boolean(oppId), surface));
  }, [activeSection, oppId, surface]);

  // goToClass: navigate to the class workspace with a pre-selected batch + tab.
  // Teachers see the classes workspace nested inside the consolidated "Quản lý học sinh" screen
  // (student-mgmt), not the standalone /classes route which is hidden from their nav.
  const isTeacherOnly = me.roles.length === 1 && me.roles.includes('giao_vien');
  const goToClass = useCallback(
    (batchId: string | undefined, tab: string) => {
      setNavAction({ batchId, tab, ts: Date.now() });
      navigate(isTeacherOnly ? '/student-mgmt' : '/classes');
    },
    [navigate, isTeacherOnly],
  );

  function handleSectionChange(key: SectionKey) {
    setNavAction(null);
    setSelectedSession(null);
    setStudentNav(null);
    setStaffNav(null);
    navigate('/' + key);
  }

  // Global-search "deep link to a record" handler (shell.tsx GlobalSearchDropdown). classBatches
  // reuses the existing goToClass mechanism as-is; students/staff pre-select via component-local
  // state consumed by StudentsPanel/OrgPanel below.
  function handleSearchNavigate(entityKey: 'students' | 'staff' | 'classBatches', id: string) {
    if (entityKey === 'classBatches') {
      goToClass(id, 'sessions');
      return;
    }
    if (entityKey === 'students') {
      setStudentNav({ id, ts: Date.now() });
      navigate('/students');
      return;
    }
    setStaffNav({ id, ts: Date.now() });
    navigate('/org');
  }

  const navGroups = buildNavGroups({
    roles: me.roles as string[],
    isSuperAdmin: me.isSuperAdmin,
    surface,
  });

  const renderContent = () => {
    switch (activeSection) {
      // ── Admin / Settings ──────────────────────────────────────────────────
      case 'overview':
        return <OverviewPanel />;

      // Executive Cockpit (Phase 3): giam_doc_kinh_doanh-only landing — summary widget +
      // approval-inbox widget. KPI items route to the full 'kpi' panel (see
      // biz-director-cockpit-panel.tsx for why: the aggregate item lacks the composite
      // userId+periodKey key kpiEvalConfirm/kpiEvalApprove require).
      case 'biz-director-cockpit':
        return <BizDirectorCockpitPanel onNavigateToKpi={() => handleSectionChange('kpi')} />;

      // Executive Cockpit (Phase 4): giam_doc_dao_tao-only landing — summary widget +
      // approval-inbox widget. KPI items route to the full 'kpi' panel, same resolution as
      // biz-director-cockpit-panel.tsx (see edu-director-cockpit-panel.tsx for why).
      case 'edu-director-cockpit':
        return (
          <EduDirectorCockpitPanel
            onNavigateToKpi={() => handleSectionChange('kpi')}
            onNavigateToFinanceIntake={() => handleSectionChange(surface === 'teacher' ? 'family-intake' : 'finance')}
          />
        );

      case 'courses':
        return (
          <Stack>
            <CoursesPanel />
            {/* TermsPanel is a term-MANAGEMENT surface (create/edit/lock kỳ học). Only render it
                for roles that can actually manage terms (assessment.termCreate = GĐĐT) —
                teachers can read terms elsewhere but here would only see dead,
                FORBIDDEN-on-click buttons. */}
            {can(me.roles, me.isSuperAdmin, 'assessment', 'termCreate') &&
              (me.facilityIds[0] ?? (me.isSuperAdmin ? 1 : null)) != null && (
                <TermsPanel facilityId={me.facilityIds[0] ?? 1} />
              )}
          </Stack>
        );

      case 'org':
        return <OrgPanel initialStaffNav={staffNav} />;

      // ── Students ──────────────────────────────────────────────────────────
      case 'students':
        return <StudentsPanel initialDetailId={studentNav} />;

      case 'guardians':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Phụ huynh</Text>
            <GuardiansPanel />
          </Stack>
        );

      // ── Academic / Teaching ───────────────────────────────────────────────
      case 'schedule':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Lịch dạy</Text>
            {selectedSession ? (
              <ScheduleDetailPanel
                session={selectedSession}
                goToClass={goToClass}
                onBack={() => setSelectedSession(null)}
              />
            ) : (
              <SchedulePanel goToClass={goToClass} onOpenSession={setSelectedSession} />
            )}
          </Stack>
        );

      case 'attendance':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Điểm danh</Text>
            <AttendancePanel />
          </Stack>
        );

      case 'grading':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Chấm bài</Text>
            <GradingPanel />
          </Stack>
        );

      case 'assessment':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Học bạ</Text>
            <AssessmentPanel />
          </Stack>
        );

      // ── Class management ──────────────────────────────────────────────────
      case 'classes':
        return <Workspace navAction={navAction} />;

      // Teacher nav consolidation: Lớp học + Khóa học + Học bạ in one tabbed screen.
      case 'student-mgmt':
        return <StudentManagementPanel navAction={navAction} />;

      case 'meetings':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Họp phụ huynh</Text>
            <MeetingsPanel />
          </Stack>
        );

      case 'levelup':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Duyệt cấp độ</Text>
            <LevelApprovalPanel />
          </Stack>
        );

      case 'certificate':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Chứng chỉ</Text>
            <CertificatePanel />
          </Stack>
        );

      // ── Finance / CRM ─────────────────────────────────────────────────────
      case 'finance':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Tài chính</Text>
            <FinancePanel />
          </Stack>
        );

      case 'family-intake':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">
              Tạo học viên LMS
            </Text>
            {surface === 'teacher' ? <TeacherLiteIntakePanel /> : <FamilyIntakePanel />}
          </Stack>
        );

      case 'email-outbox':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Hộp thư gửi đi</Text>
            <EmailOutboxPanel />
          </Stack>
        );

      case 'revenue-report':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Báo cáo doanh thu</Text>
            <RevenueReportPanel />
          </Stack>
        );

      case 'attendance-report': {
        const reportFacilityId = me.facilityIds[0] ?? (me.isSuperAdmin ? 1 : null);
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Báo cáo điểm danh</Text>
            {reportFacilityId != null ? (
              <AttendanceReportPanel facilityId={reportFacilityId} />
            ) : (
              <Text c="dimmed" size="sm">Chưa có cơ sở được gán.</Text>
            )}
          </Stack>
        );
      }

      case 'reconcile-worklist':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Đối soát theo kỳ</Text>
            <ReconcileWorklistPanel />
          </Stack>
        );

      case 'crm':
        return <CrmPanel selectedOppId={oppId} />;

      case 'cskh':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Chăm sóc khách hàng</Text>
            <CskhPanel />
          </Stack>
        );

      case 'rewards':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Đổi quà</Text>
            <RewardsPanel />
          </Stack>
        );

      case 'badges':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Huy hiệu</Text>
            <BadgePanel />
          </Stack>
        );

      // ── HR / Payroll ──────────────────────────────────────────────────────
      case 'hr':
        return <HrPayrollSection />;

      case 'kpi':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Đánh giá KPI</Text>
            <KpiEvaluationPanel />
          </Stack>
        );

      case 'compensation':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Cơ cấu lương</Text>
            <CompensationConfigPanel />
          </Stack>
        );

      case 'my-payslips':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Phiếu lương của tôi</Text>
            <MyPayslipsPanel />
          </Stack>
        );

      // Teacher nav consolidation: Phiếu lương + Chấm công in one tabbed screen.
      case 'payroll-checkin':
        return <PayrollCheckinPanel />;

      // ── Work Shift & Attendance ──────────────────────────────────────────
      case 'checkin':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Chấm công</Text>
            <CheckInPanel />
          </Stack>
        );

      case 'shift-registration':
        return <ShiftRegSection />;

      case 'facility-network':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">IP WiFi chấm công</Text>
            <FacilityNetworkPanel />
          </Stack>
        );

      case 'shift-config':
        return (
          <Stack>
            <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">Danh mục ca</Text>
            <ShiftConfigPanel />
          </Stack>
        );

      // ── Profile/settings (reachable via the avatar menu, not the sidebar) ────
      case 'profile':
        return <ProfileSettingsPanel />;

      default:
        return null;
    }
  };

  return (
    <Shell
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
      onSearchNavigate={handleSearchNavigate}
      navGroups={navGroups}
      activeModuleKey={activeModuleKey}
      sectionTitle={SECTION_TITLES[activeSection]}
      surface={surface}
    >
      {renderContent()}
    </Shell>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

function Authenticated() {
  const surface = currentAppSurface();
  const copy = SURFACE_COPY[surface];
  return (
    <LoginGate
      appTitle={copy.loginTitle}
      brandWord={copy.loginBrandWord}
      loginDescription={copy.loginDescription}
      heroDescription={copy.loginHeroDescription}
    >
      <Dashboard />
    </LoginGate>
  );
}

export function App() {
  return (
    <Routes>
      {/* Dev-only design preview, reachable without login (was #design). */}
      <Route path="/design" element={<DesignShowcase />} />
      {/* CRM record deep link — shareable link to one opportunity. */}
      <Route path="/crm/opportunities/:oppId" element={<Authenticated />} />
      <Route path="/:section" element={<Authenticated />} />
      <Route path="/" element={<Authenticated />} />
      {/* Unknown path → Dashboard redirects to the persona default. */}
      <Route path="*" element={<Authenticated />} />
    </Routes>
  );
}
