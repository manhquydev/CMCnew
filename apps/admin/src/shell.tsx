import { useState } from 'react';
import {
  AppShell, ActionIcon, Avatar, Badge, Box, Button, Group, NavLink,
  Popover, ScrollArea, Stack, Text, UnstyledButton,
} from '@mantine/core';
import { useSession, useStaffNotif } from '@cmc/ui';
import type { StaffNotifItem } from '@cmc/ui';
import { can } from '@cmc/auth/permissions';
import { NAV_GATES } from './nav-permissions.js';
import {
  IconArrowUp,
  IconBell,
  IconBook,
  IconBuilding,
  IconCalendar,
  IconCertificate,
    IconClipboardCheck,
  IconAdjustments,
  IconWifi,
  IconCurrencyDong,
  IconDoor,
  IconGift,
  IconAward,
  IconHeadset,
  IconId,
  IconLayoutDashboard,
  IconInbox,
  IconPencil,
  IconReceipt,
  IconReport,
  IconSchool,
  IconTargetArrow,
  IconTrendingUp,
  IconUsers,
  IconWallet,
} from '@tabler/icons-react';

// ─── Section keys ─────────────────────────────────────────────────────────────

export type SectionKey =
  // Admin/Settings
  | 'overview'
  | 'courses'
  | 'org'
  // Students
  | 'students'
  | 'guardians'
  // Academic / Teaching
  | 'schedule'
  | 'attendance'
  | 'grading'
  | 'assessment'
  // Class management
  | 'classes'
  | 'meetings'
  | 'levelup'
  | 'certificate'
  // Finance / CRM
  | 'finance'
  | 'email-outbox'
  | 'revenue-report'
  | 'reconcile-worklist'
  | 'crm'
  | 'cskh'
  | 'rewards'
  | 'badges'
  // HR / Payroll
  | 'hr'
  | 'kpi'
  | 'compensation'
  | 'my-payslips'
  | 'checkin'
  | 'shift-registration'
  | 'facility-network'
  | 'shift-config'
  // Teacher nav consolidation (Lịch 360) — giao_vien-only aggregate screens
  | 'student-mgmt'
  | 'payroll-checkin'
  // Executive Cockpit (Phase 3) — giam_doc_kinh_doanh-only aggregate screen
  | 'biz-director-cockpit'
  // Executive Cockpit (Phase 4) — giam_doc_dao_tao-only aggregate screen
  | 'edu-director-cockpit';

// ─── Nav types ────────────────────────────────────────────────────────────────

type NavItem = {
  key: SectionKey;
  label: string;
  icon: React.ReactNode;
  visible: boolean;
};

type NavGroup = {
  groupLabel: string;
  items: NavItem[];
};

// ─── Sidebar item ─────────────────────────────────────────────────────────────

function SidebarItem({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <NavLink
      label={item.label}
      leftSection={item.icon}
      active={active}
      onClick={onClick}
      styles={{
        root: {
          borderRadius: 10,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 12,
          paddingRight: 12,
          color: active ? 'var(--cmc-brand-hover)' : 'var(--cmc-text)',
          backgroundColor: active ? 'var(--cmc-brand-muted)' : 'transparent',
          fontWeight: active ? 500 : 400,
          transition: 'background-color 200ms',
          '&:hover': {
            backgroundColor: active ? 'var(--cmc-brand-muted)' : 'var(--cmc-surface-2)',
          },
        },
        label: { fontSize: 14 },
      }}
    />
  );
}

// ─── Section label ─────────────────────────────────────────────────────────────

function GroupLabel({ label }: { label: string }) {
  return (
    <Text
      size="xs"
      style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--cmc-text-faint)',
        fontWeight: 600,
        paddingLeft: 12,
        paddingTop: 16,
        paddingBottom: 4,
        userSelect: 'none',
      }}
    >
      {label}
    </Text>
  );
}

// ─── Staff notification dropdown ──────────────────────────────────────────────

function StaffNotifDropdown({
  items,
  onMarkAll,
  isMarkingAll,
}: {
  items: StaffNotifItem[];
  onMarkAll: () => void;
  isMarkingAll: boolean;
}) {
  return (
    <Stack gap={0} style={{ minWidth: 300 }}>
      <Group
        justify="space-between"
        px="sm"
        py="xs"
        style={{ borderBottom: '1px solid var(--cmc-border)' }}
      >
        <Text size="sm" fw={600}>Thông báo</Text>
        <Button variant="subtle" size="xs" onClick={onMarkAll} loading={isMarkingAll}>
          Đọc tất cả
        </Button>
      </Group>
      <ScrollArea h={320}>
        {items.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">Không có thông báo mới</Text>
        ) : (
          items.map((n) => (
            <Box
              key={n.id}
              px="sm"
              py="xs"
              style={{
                backgroundColor: n.readAt ? 'transparent' : 'var(--cmc-brand-muted)',
                borderBottom: '1px solid var(--cmc-border-faint)',
              }}
            >
              <Text size="sm" fw={n.readAt ? 400 : 500}>{n.title}</Text>
              <Text size="xs" c="dimmed" lineClamp={2}>{n.body}</Text>
            </Box>
          ))
        )}
      </ScrollArea>
    </Stack>
  );
}

// ─── Shell ─────────────────────────────────────────────────────────────────────

export function Shell({
  activeSection,
  onSectionChange,
  navGroups,
  sectionTitle,
  children,
}: {
  activeSection: SectionKey;
  onSectionChange: (key: SectionKey) => void;
  navGroups: NavGroup[];
  sectionTitle: string;
  children: React.ReactNode;
}) {
  const { me, logout } = useSession();
  const [mobileOpened, setMobileOpened] = useState(false);
  const facilityId = me.facilityIds[0] ?? null;
  const { unreadCount, notifications, fetchList, markAllRead, isMarkingAll } = useStaffNotif(facilityId);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding={0}
    >
      {/* ── Topbar ── */}
      <AppShell.Header
        style={{
          backgroundColor: 'var(--cmc-surface)',
          borderBottom: '1px solid var(--cmc-border)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
        }}
      >
        <Group justify="space-between" style={{ width: '100%' }}>
          <Group gap="md">
            <ActionIcon
              variant="subtle"
              hiddenFrom="sm"
              onClick={() => setMobileOpened((o) => !o)}
              aria-label="Mở menu"
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </ActionIcon>
            <Text fw={700} style={{ color: 'var(--cmc-brand)', fontSize: 18, letterSpacing: '-0.02em' }}>
              CMC
            </Text>
            <Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>
              {sectionTitle}
            </Text>
          </Group>
          <Group gap="sm">
            <Popover width={320} position="bottom-end" withArrow>
              <Popover.Target>
                <UnstyledButton
                  aria-label="Thông báo"
                  onClick={fetchList}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    color: 'var(--cmc-text-muted)',
                    position: 'relative',
                    transition: 'background-color 200ms',
                  }}
                >
                  <IconBell size={20} stroke={1.5} />
                  {unreadCount > 0 && (
                    <Badge
                      size="xs"
                      color="red"
                      variant="filled"
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        minWidth: 16,
                        height: 16,
                        padding: '0 4px',
                        fontSize: 9,
                      }}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Badge>
                  )}
                </UnstyledButton>
              </Popover.Target>
              <Popover.Dropdown style={{ padding: 0 }}>
                <StaffNotifDropdown
                  items={notifications}
                  onMarkAll={markAllRead}
                  isMarkingAll={isMarkingAll}
                />
              </Popover.Dropdown>
            </Popover>
            <Avatar size={32} radius="xl" color="blue" title={me.displayName}>
              {me.displayName.slice(0, 2).toUpperCase()}
            </Avatar>
            <Button variant="subtle" size="xs" color="gray" onClick={logout}>Đăng xuất</Button>
          </Group>
        </Group>
      </AppShell.Header>

      {/* ── Sidebar ── */}
      <AppShell.Navbar
        style={{
          backgroundColor: 'var(--cmc-surface)',
          borderRight: '1px solid var(--cmc-border)',
          padding: '8px 8px',
          overflowY: 'auto',
        }}
      >
        {navGroups.map((group) => {
          const visible = group.items.filter((i) => i.visible);
          if (visible.length === 0) return null;
          return (
            <div key={group.groupLabel}>
              <GroupLabel label={group.groupLabel} />
              {visible.map((item) => (
                <SidebarItem
                  key={item.key}
                  item={item}
                  active={activeSection === item.key}
                  onClick={() => { onSectionChange(item.key); setMobileOpened(false); }}
                />
              ))}
            </div>
          );
        })}
      </AppShell.Navbar>

      {/* ── Content ── */}
      <AppShell.Main style={{ backgroundColor: 'var(--cmc-bg)', minHeight: '100vh' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: 32 }}>
          {children}
        </div>
      </AppShell.Main>
    </AppShell>
  );
}

// ─── Nav builder ───────────────────────────────────────────────────────────────

const I = (size = 18, stroke = 1.5) => ({ size, stroke });

export function buildNavGroups({
  roles,
  isSuperAdmin,
}: {
  roles: string[];
  isSuperAdmin: boolean;
}): NavGroup[] {
  /**
   * Derive visibility from the shared permission registry via NAV_GATES.
   * No hardcoded role arrays here — adding/removing roles in packages/auth/permissions.ts
   * propagates automatically. The nav-consistency test enforces that every visible item
   * is backed by a passing can() check.
   */
  function visible(key: SectionKey): boolean {
    const gate = NAV_GATES[key];
    if (gate.kind === 'open') return true;
    if (gate.kind === 'superAdmin') return isSuperAdmin;
    return can(roles, isSuperAdmin, gate.module, gate.action);
  }

  // Teacher nav consolidation (Lịch 360): only collapse nav for accounts whose ONLY role is
  // giao_vien. assessment.termList/checkInOut.punch are also granted to giam_doc_dao_tao/
  // sale/cskh, so a multi-role account (e.g. giao_vien + giam_doc_dao_tao) must keep the original,
  // uncollapsed nav to avoid hiding sections those other roles rely on.
  const isTeacherOnly = roles.length === 1 && roles[0] === 'giao_vien';

  // Executive Cockpit (Phase 3): only collapse 'overview' into the cockpit for accounts whose
  // ONLY role is giam_doc_kinh_doanh. Several gates GĐKD holds (crm/finance/cskh/rewards/kpi/
  // shift-registration) are also granted to other roles, so a multi-role account (e.g.
  // giam_doc_kinh_doanh + giam_doc_dao_tao) must keep the original, uncollapsed nav — same safety
  // reasoning as isTeacherOnly above. Unlike teacher-nav, the cockpit does NOT hide the other
  // direct-access nav items (finance/crm/cskh/rewards/kpi/...) — it is a summary + quick-approve
  // screen, not a replacement for the detail screens the director still works in.
  const isBizDirectorOnly = roles.length === 1 && roles[0] === 'giam_doc_kinh_doanh';

  // Executive Cockpit (Phase 4): same reasoning as isBizDirectorOnly above, mirrored for
  // giam_doc_dao_tao. Several gates GĐĐT holds (attendance/grading/assessment/classes/courses/
  // meetings/levelup/guardians/kpi/shift-registration) are also granted to other roles
  // (giao_vien, giam_doc_kinh_doanh), so a multi-role account must keep the original nav.
  // The cockpit only replaces 'overview' — it does NOT hide the direct-access academic nav
  // items, since the director still needs to work in those detail screens.
  const isEduDirectorOnly = roles.length === 1 && roles[0] === 'giam_doc_dao_tao';

  const groups: NavGroup[] = [
    {
      groupLabel: 'Giảng dạy',
      items: [
        { key: 'schedule' as const, label: 'Lịch dạy', icon: <IconCalendar {...I()} />, visible: visible('schedule') },
        // Điểm danh/Chấm bài đã gộp vào "Lịch dạy" (Lịch 360 mở rộng — điểm danh nhúng sẵn trong
        // schedule-detail, chấm bài + họp PH là WorkflowCard) cho giáo_viên-only.
        { key: 'attendance' as const, label: 'Điểm danh', icon: <IconClipboardCheck {...I()} />, visible: !isTeacherOnly && visible('attendance') },
        { key: 'grading' as const, label: 'Chấm bài', icon: <IconPencil {...I()} />, visible: !isTeacherOnly && visible('grading') },
        { key: 'assessment' as const, label: 'Học bạ', icon: <IconReport {...I()} />, visible: !isTeacherOnly && visible('assessment') },
      ],
    },
    {
      groupLabel: 'Lớp học',
      items: [
        { key: 'classes' as const, label: 'Lớp học', icon: <IconDoor {...I()} />, visible: !isTeacherOnly && visible('classes') },
        // Course catalogue is a shared read-only reference that belongs next to classes, not under
        // "Quản trị" — otherwise a teacher sees a lone "Khóa học" under an Admin header.
        { key: 'courses' as const, label: 'Khóa học', icon: <IconBook {...I()} />, visible: !isTeacherOnly && visible('courses') },
        // Giáo viên (chỉ role này): 3 mục Lớp học/Khóa học/Học bạ gộp thành 1 màn có tab.
        { key: 'student-mgmt' as const, label: 'Quản lý học sinh', icon: <IconUsers {...I()} />, visible: isTeacherOnly },
        { key: 'meetings' as const, label: 'Họp PH', icon: <IconUsers {...I()} />, visible: !isTeacherOnly && visible('meetings') },
        { key: 'levelup' as const, label: 'Duyệt cấp độ', icon: <IconArrowUp {...I()} />, visible: visible('levelup') },
        // Tính năng chứng chỉ tạm tắt (chưa dùng) — đặt visible:false để ẩn khỏi nav; router/panel
        // vẫn còn nguyên, bật lại bằng visible('certificate') khi cần.
        { key: 'certificate' as const, label: 'Chứng chỉ', icon: <IconCertificate {...I()} />, visible: false },
      ],
    },
    {
      groupLabel: 'Học sinh',
      items: [
        { key: 'students' as const, label: 'Học sinh', icon: <IconSchool {...I()} />, visible: visible('students') },
        { key: 'guardians' as const, label: 'Phụ huynh', icon: <IconUsers {...I()} />, visible: visible('guardians') },
      ],
    },
    {
      groupLabel: 'CRM & Kinh doanh',
      items: [
        { key: 'crm' as const, label: 'CRM', icon: <IconTrendingUp {...I()} />, visible: visible('crm') },
        { key: 'cskh' as const, label: 'Chăm sóc KH', icon: <IconHeadset {...I()} />, visible: visible('cskh') },
        { key: 'rewards' as const, label: 'Đổi quà', icon: <IconGift {...I()} />, visible: visible('rewards') },
        { key: 'badges' as const, label: 'Huy hiệu', icon: <IconAward {...I()} />, visible: visible('badges') },
      ],
    },
    {
      groupLabel: 'Tài chính',
      items: [
        { key: 'finance' as const, label: 'Tài chính', icon: <IconReceipt {...I()} />, visible: visible('finance') },
        { key: 'email-outbox' as const, label: 'Hộp thư gửi đi', icon: <IconInbox {...I()} />, visible: visible('email-outbox') },
        { key: 'revenue-report' as const, label: 'Báo cáo doanh thu', icon: <IconReport {...I()} />, visible: visible('revenue-report') },
        { key: 'reconcile-worklist' as const, label: 'Đối soát theo kỳ', icon: <IconClipboardCheck {...I()} />, visible: visible('reconcile-worklist') },
      ],
    },
    {
      groupLabel: 'Nhân sự',
      items: [
        { key: 'hr' as const, label: 'Nhân sự & Lương', icon: <IconId {...I()} />, visible: visible('hr') },
        { key: 'kpi' as const, label: 'Đánh giá KPI', icon: <IconTargetArrow {...I()} />, visible: visible('kpi') },
        { key: 'compensation' as const, label: 'Cơ cấu lương', icon: <IconCurrencyDong {...I()} />, visible: visible('compensation') },
        { key: 'my-payslips' as const, label: 'Phiếu lương của tôi', icon: <IconWallet {...I()} />, visible: !isTeacherOnly && visible('my-payslips') },
        // Giáo viên (chỉ role này): Phiếu lương + Chấm công gộp thành 1 màn có tab.
        { key: 'payroll-checkin' as const, label: 'Lương & chấm công', icon: <IconWallet {...I()} />, visible: isTeacherOnly },
      ],
    },
    {
      groupLabel: 'Công ca',
      items: [
        { key: 'checkin' as const, label: 'Chấm công', icon: <IconClipboardCheck {...I()} />, visible: !isTeacherOnly && visible('checkin') },
        { key: 'shift-registration' as const, label: 'Đăng ký ca', icon: <IconCalendar {...I()} />, visible: visible('shift-registration') },
      ],
    },
    {
      groupLabel: 'Quản trị',
      items: [
        { key: 'overview' as const, label: 'Tổng quan', icon: <IconLayoutDashboard {...I()} />, visible: !isBizDirectorOnly && !isEduDirectorOnly && visible('overview') },
        // GĐ Kinh doanh (chỉ role này): "Tổng quan" thay bằng Executive Cockpit (summary +
        // hộp duyệt nhanh). Đặt gate 'open' (nav-permissions.ts) vì visibility thật nằm ở đây.
        { key: 'biz-director-cockpit' as const, label: 'Cockpit điều hành', icon: <IconLayoutDashboard {...I()} />, visible: isBizDirectorOnly },
        // GĐ Đào tạo (chỉ role này): "Tổng quan" thay bằng Executive Cockpit (summary +
        // hộp duyệt nhanh). Đặt gate 'open' (nav-permissions.ts) vì visibility thật nằm ở đây.
        { key: 'edu-director-cockpit' as const, label: 'Cockpit điều hành', icon: <IconLayoutDashboard {...I()} />, visible: isEduDirectorOnly },
        { key: 'org' as const, label: 'Cơ sở & Users', icon: <IconBuilding {...I()} />, visible: visible('org') },
        { key: 'facility-network' as const, label: 'IP WiFi chấm công', icon: <IconWifi {...I()} />, visible: visible('facility-network') },
        { key: 'shift-config' as const, label: 'Danh mục ca', icon: <IconAdjustments {...I()} />, visible: visible('shift-config') },
      ],
    },
  ];
  return groups;
}

// ─── Section title map ─────────────────────────────────────────────────────────

export const SECTION_TITLES: Record<SectionKey, string> = {
  overview: 'Tổng quan',
  courses: 'Khóa học',
  students: 'Học sinh',
  org: 'Cơ sở & Người dùng',
  guardians: 'Phụ huynh',
  finance: 'Tài chính',
  'email-outbox': 'Hộp thư gửi đi',
  'revenue-report': 'Báo cáo doanh thu',
  'reconcile-worklist': 'Đối soát theo kỳ',
  crm: 'CRM',
  cskh: 'Chăm sóc khách hàng',
  hr: 'Nhân sự & Lương',
  kpi: 'Đánh giá KPI',
  compensation: 'Cơ cấu lương',
  rewards: 'Đổi quà',
  badges: 'Huy hiệu',
  // Teaching / Academic
  schedule: 'Lịch dạy',
  attendance: 'Điểm danh',
  grading: 'Chấm bài',
  assessment: 'Học bạ',
  classes: 'Lớp học',
  meetings: 'Họp phụ huynh',
  levelup: 'Duyệt cấp độ',
  certificate: 'Chứng chỉ',
  'my-payslips': 'Phiếu lương của tôi',
  checkin: 'Chấm công',
  'shift-registration': 'Đăng ký ca',
  'facility-network': 'IP WiFi chấm công',
  'shift-config': 'Danh mục ca',
  // Teacher nav consolidation (Lịch 360)
  'student-mgmt': 'Quản lý học sinh',
  'payroll-checkin': 'Lương & chấm công',
  // Executive Cockpit (Phase 3)
  'biz-director-cockpit': 'Cockpit điều hành',
  // Executive Cockpit (Phase 4)
  'edu-director-cockpit': 'Cockpit điều hành',
};
