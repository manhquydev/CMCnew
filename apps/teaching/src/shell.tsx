import { useState } from 'react';
import { AppShell, Badge, Button, Group, NavLink, Text, ActionIcon, Popover, ScrollArea, Box, Stack, Avatar, UnstyledButton } from '@mantine/core';
import {
  IconCalendar,
  IconSchool,
  IconClipboardCheck,
  IconPencil,
  IconReport,
  IconDoor,
  IconUserPlus,
  IconArrowUp,
  IconCertificate,
  IconUsers,
  IconNotes,
  IconHeadset,
  IconBriefcase,
  IconReceipt,
  IconWallet,
  IconCurrencyDong,
  IconBell,
} from '@tabler/icons-react';
import { useSession, useStaffNotif } from '@cmc/ui';
import type { StaffNotifItem } from '@cmc/ui';

export type SectionKey =
  | 'schedule'
  | 'sessions'
  | 'attendance'
  | 'grading'
  | 'assessment'
  | 'classes'
  | 'enrollment'
  | 'levelup'
  | 'certificate'
  | 'meetings'
  | 'classlog'
  | 'cskh'
  | 'crm'
  | 'finance'
  | 'my-payslips'
  | 'payroll';

export const ALL_TEACHING_KEYS = new Set<string>([
  'schedule', 'sessions', 'attendance', 'grading', 'assessment',
  'classes', 'enrollment', 'levelup', 'certificate', 'meetings',
  'classlog', 'cskh', 'crm', 'finance', 'my-payslips', 'payroll',
]);

interface NavItem {
  key: SectionKey;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const ICON_SIZE = 18;
const ICON_STROKE = 1.5;

interface BuildGroupsOpts {
  canPayroll: boolean;
  canMyPayslips: boolean;
  canCrm: boolean;
  canFinance: boolean;
  canCskh: boolean;
}

function buildGroups({ canPayroll, canMyPayslips, canCrm, canFinance, canCskh }: BuildGroupsOpts): NavGroup[] {
  const groups: NavGroup[] = [
    {
      label: 'GIẢNG DẠY',
      items: [
        { key: 'schedule', label: 'Lịch dạy', icon: <IconCalendar size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'sessions', label: 'Buổi học', icon: <IconSchool size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'attendance', label: 'Điểm danh', icon: <IconClipboardCheck size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'grading', label: 'Chấm bài', icon: <IconPencil size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'assessment', label: 'Học bạ', icon: <IconReport size={ICON_SIZE} stroke={ICON_STROKE} /> },
      ],
    },
    {
      label: 'QUẢN LÝ LỚP',
      items: [
        { key: 'classes', label: 'Lớp học', icon: <IconDoor size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'enrollment', label: 'Ghi danh', icon: <IconUserPlus size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'levelup', label: 'Duyệt cấp độ', icon: <IconArrowUp size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'certificate', label: 'Chứng chỉ', icon: <IconCertificate size={ICON_SIZE} stroke={ICON_STROKE} /> },
      ],
    },
  ];

  // GIAO TIẾP: meetings + classlog always; CSKH only for cskh/quan_ly staff
  const commsItems: NavItem[] = [
    { key: 'meetings', label: 'Họp PH', icon: <IconUsers size={ICON_SIZE} stroke={ICON_STROKE} /> },
    { key: 'classlog', label: 'Nhật ký lớp', icon: <IconNotes size={ICON_SIZE} stroke={ICON_STROKE} /> },
  ];
  if (canCskh) {
    commsItems.push({ key: 'cskh', label: 'CSKH', icon: <IconHeadset size={ICON_SIZE} stroke={ICON_STROKE} /> });
  }
  groups.push({ label: 'GIAO TIẾP', items: commsItems });

  // KINH DOANH: only visible to roles that can use these sections
  const bizItems: NavItem[] = [];
  if (canCrm) bizItems.push({ key: 'crm', label: 'CRM', icon: <IconBriefcase size={ICON_SIZE} stroke={ICON_STROKE} /> });
  if (canFinance) bizItems.push({ key: 'finance', label: 'Phiếu thu', icon: <IconReceipt size={ICON_SIZE} stroke={ICON_STROKE} /> });
  if (bizItems.length > 0) {
    groups.push({ label: 'KINH DOANH', items: bizItems });
  }

  const hrItems: NavItem[] = [];
  if (canMyPayslips) {
    hrItems.push({ key: 'my-payslips', label: 'Phiếu lương của tôi', icon: <IconWallet size={ICON_SIZE} stroke={ICON_STROKE} /> });
  }
  if (canPayroll) {
    hrItems.push({ key: 'payroll', label: 'Bảng lương', icon: <IconCurrencyDong size={ICON_SIZE} stroke={ICON_STROKE} /> });
  }
  if (hrItems.length > 0) {
    groups.push({ label: 'NHÂN SỰ', items: hrItems });
  }

  return groups;
}

const SECTION_LABEL: Record<SectionKey, string> = {
  schedule: 'Lịch dạy',
  sessions: 'Buổi học',
  attendance: 'Điểm danh',
  grading: 'Chấm bài',
  assessment: 'Học bạ',
  classes: 'Lớp học',
  enrollment: 'Ghi danh',
  levelup: 'Duyệt cấp độ',
  certificate: 'Chứng chỉ',
  meetings: 'Họp PH',
  classlog: 'Nhật ký lớp',
  cskh: 'CSKH',
  crm: 'CRM',
  finance: 'Phiếu thu',
  'my-payslips': 'Phiếu lương của tôi',
  payroll: 'Bảng lương',
};

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

interface ShellProps {
  activeSection: SectionKey;
  onSectionChange: (key: SectionKey) => void;
  children: React.ReactNode;
}

export function Shell({ activeSection, onSectionChange, children }: ShellProps) {
  const { me, logout } = useSession();
  const [mobileOpened, setMobileOpened] = useState(false);
  const facilityId = me.facilityIds[0] ?? null;
  const { unreadCount, notifications, fetchList, markAllRead, isMarkingAll } = useStaffNotif(facilityId);

  const canPayroll = me.isSuperAdmin || me.roles.includes('hr') || me.roles.includes('ke_toan');
  const canCrm = me.isSuperAdmin || me.roles.some((r) => ['sale', 'quan_ly', 'cskh'].includes(r));
  const canFinance = me.isSuperAdmin || me.roles.some((r) => ['ke_toan', 'quan_ly'].includes(r));
  const canCskh = me.isSuperAdmin || me.roles.some((r) => ['cskh', 'quan_ly'].includes(r));
  const canMyPayslips = true; // all staff can view their own payslips
  const groups = buildGroups({ canPayroll, canMyPayslips, canCrm, canFinance, canCskh });

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      styles={{
        root: { backgroundColor: 'var(--cmc-bg)' },
        header: {
          backgroundColor: 'var(--cmc-surface)',
          borderBottom: '1px solid var(--cmc-border)',
          position: 'sticky',
          top: 0,
          zIndex: 200,
        },
        navbar: {
          backgroundColor: 'var(--cmc-surface)',
          borderRight: '1px solid var(--cmc-border)',
        },
        main: {
          backgroundColor: 'var(--cmc-bg)',
          minHeight: 'calc(100vh - 56px)',
        },
      }}
    >
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Group gap="sm">
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
            <Group gap={8}>
              <Text
                fw={700}
                style={{ color: 'var(--cmc-brand)', fontSize: 18, letterSpacing: '-0.02em' }}
              >
                CMC
              </Text>
              <Text size="sm" fw={600} style={{ color: 'var(--cmc-text)' }}>
                {SECTION_LABEL[activeSection]}
              </Text>
            </Group>
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
                  <IconBell size={20} stroke={ICON_STROKE} />
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
            <Avatar
              size={32}
              radius="xl"
              style={{ cursor: 'pointer', backgroundColor: 'var(--cmc-brand-muted)' }}
            >
              <Text size="xs" fw={600} style={{ color: 'var(--cmc-brand-hover)' }}>
                {me.displayName?.charAt(0)?.toUpperCase() ?? 'U'}
              </Text>
            </Avatar>
            <Button variant="subtle" size="xs" color="gray" onClick={logout}>Đăng xuất</Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar>
        <ScrollArea style={{ height: '100%' }} px="xs" py="sm">
          {groups.map((group) => (
            <Box key={group.label} mb="sm">
              <Text
                size="xs"
                fw={600}
                mb={4}
                px={8}
                style={{
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--cmc-text-faint)',
                  fontSize: 11,
                }}
              >
                {group.label}
              </Text>
              {group.items.map((item) => {
                const isActive = activeSection === item.key;
                return (
                  <NavLink
                    key={item.key}
                    label={item.label}
                    leftSection={item.icon}
                    active={isActive}
                    onClick={() => {
                      onSectionChange(item.key);
                      setMobileOpened(false);
                    }}
                    styles={{
                      root: {
                        borderRadius: 10,
                        color: isActive ? 'var(--cmc-brand-hover)' : 'var(--cmc-text)',
                        backgroundColor: isActive ? 'var(--cmc-brand-muted)' : 'transparent',
                        fontWeight: isActive ? 500 : 400,
                        fontSize: 14,
                        '&:hover': {
                          backgroundColor: isActive ? 'var(--cmc-brand-muted)' : 'var(--cmc-surface-2)',
                        },
                      },
                    }}
                  />
                );
              })}
            </Box>
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box p="xl" style={{ maxWidth: 1280 }}>
          {children}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
