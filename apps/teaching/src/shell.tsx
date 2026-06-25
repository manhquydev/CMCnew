import { useState } from 'react';
import { AppShell, Button, Group, NavLink, Text, ActionIcon, ScrollArea, Box, Avatar } from '@mantine/core';
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
import { useSession } from '@cmc/ui';

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

function buildGroups(canPayroll: boolean, canMyPayslips: boolean): NavGroup[] {
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
    {
      label: 'GIAO TIẾP',
      items: [
        { key: 'meetings', label: 'Họp PH', icon: <IconUsers size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'classlog', label: 'Nhật ký lớp', icon: <IconNotes size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'cskh', label: 'CSKH', icon: <IconHeadset size={ICON_SIZE} stroke={ICON_STROKE} /> },
      ],
    },
    {
      label: 'KINH DOANH',
      items: [
        { key: 'crm', label: 'CRM', icon: <IconBriefcase size={ICON_SIZE} stroke={ICON_STROKE} /> },
        { key: 'finance', label: 'Phiếu thu', icon: <IconReceipt size={ICON_SIZE} stroke={ICON_STROKE} /> },
      ],
    },
  ];

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

interface ShellProps {
  activeSection: SectionKey;
  onSectionChange: (key: SectionKey) => void;
  children: React.ReactNode;
}

export function Shell({ activeSection, onSectionChange, children }: ShellProps) {
  const { me, logout } = useSession();
  const [mobileOpened, setMobileOpened] = useState(false);

  const canPayroll = me.isSuperAdmin || me.roles.includes('hr') || me.roles.includes('ke_toan');
  // All authenticated teachers/staff can see their own payslips
  const canMyPayslips = true;
  const groups = buildGroups(canPayroll, canMyPayslips);

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
              <Box
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  backgroundColor: 'var(--cmc-brand)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text size="xs" fw={700} style={{ color: '#fff', lineHeight: 1 }}>
                  C
                </Text>
              </Box>
              <Text size="sm" fw={600} style={{ color: 'var(--cmc-text)' }}>
                {SECTION_LABEL[activeSection]}
              </Text>
            </Group>
          </Group>
          <Group gap="sm">
            <ActionIcon variant="subtle" radius="md" aria-label="Thông báo">
              <IconBell size={18} stroke={ICON_STROKE} />
            </ActionIcon>
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
