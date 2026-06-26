import { useState } from 'react';
import {
  AppShell,
  ActionIcon,
  Button,
  Group,
  NavLink,
  ScrollArea,
  Text,
} from '@mantine/core';
import {
  IconHome,
  IconClipboard,
  IconChartBar,
  IconReport,
  IconMedal,
  IconTrophy,
  IconGift,
  IconBook2,
} from '@tabler/icons-react';
import { NotificationCenter, useLmsSession, type LmsPrincipal } from '@cmc/ui';
import { StudentView, type StudentTab } from './student-view';

const STUDENT_NAV: {
  group: string;
  items: { tab: StudentTab; label: string; icon: React.ReactNode }[];
}[] = [
  {
    group: 'HỌC TẬP',
    items: [
      { tab: 'courses', label: 'Khóa học', icon: <IconBook2 size={18} stroke={1.5} /> },
      { tab: 'exercises', label: 'Bài tập', icon: <IconClipboard size={18} stroke={1.5} /> },
      { tab: 'results', label: 'Kết quả học', icon: <IconChartBar size={18} stroke={1.5} /> },
    ],
  },
  {
    group: 'TIẾN ĐỘ',
    items: [
      { tab: 'gradebook', label: 'Học bạ', icon: <IconReport size={18} stroke={1.5} /> },
      { tab: 'badges', label: 'Huy hiệu', icon: <IconMedal size={18} stroke={1.5} /> },
      { tab: 'ranking', label: 'Bảng xếp hạng', icon: <IconTrophy size={18} stroke={1.5} /> },
    ],
  },
  {
    group: 'CỬA HÀNG',
    items: [
      { tab: 'rewards', label: 'Đổi quà', icon: <IconGift size={18} stroke={1.5} /> },
    ],
  },
];

// "Tổng quan" / overview section — shown at the top of the sidebar but maps to a
// dedicated overview landing in StudentView. Listed separately so it sits above the
// group labels.
const OVERVIEW_NAV = { tab: 'overview' as StudentTab, label: 'Tổng quan', icon: <IconHome size={18} stroke={1.5} /> };

interface StudentShellProps {
  principal: LmsPrincipal;
}

const ALL_STUDENT_TABS = new Set<string>([
  'overview', 'courses', 'exercises', 'results', 'gradebook', 'badges', 'ranking', 'rewards',
]);

export function StudentShell({ principal }: StudentShellProps) {
  const { logout } = useLmsSession();
  const hashKey = window.location.hash.slice(1);
  const [activeTab, setActiveTab] = useState<StudentTab>(
    ALL_STUDENT_TABS.has(hashKey) ? (hashKey as StudentTab) : 'exercises',
  );
  const [mobileOpened, setMobileOpened] = useState(false);
  const [notificationPulse, setNotificationPulse] = useState(0);

  function handleTabChange(tab: StudentTab) {
    window.location.hash = tab;
    setActiveTab(tab);
  }

  // StudentView will call this when a real-time notification arrives so the topbar
  // NotificationCenter badge updates in sync.
  function onNotification() {
    setNotificationPulse((k) => k + 1);
  }

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      bg="var(--cmc-bg)"
    >
      {/* ── Topbar ── */}
      <AppShell.Header
        style={{
          borderBottom: '1px solid var(--cmc-border)',
          background: 'var(--cmc-surface)',
        }}
      >
        <Group h="100%" px="lg" justify="space-between">
          <Group gap={0}>
            <ActionIcon
              variant="subtle"
              hiddenFrom="sm"
              onClick={() => setMobileOpened((o) => !o)}
              aria-label="Mở menu"
              mr={8}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </ActionIcon>
            <Text
              fw={700}
              size="md"
              style={{ color: 'var(--cmc-brand)', letterSpacing: '-0.01em' }}
            >
              CMC
            </Text>
            <Text
              size="sm"
              style={{
                color: 'var(--cmc-text-muted)',
                borderLeft: '1px solid var(--cmc-border)',
                marginLeft: 12,
                paddingLeft: 12,
              }}
            >
              {principal.displayName}
            </Text>
          </Group>
          <Group gap="sm">
            <NotificationCenter pulse={notificationPulse} />
            <Button variant="subtle" size="xs" color="gray" onClick={logout}>Đăng xuất</Button>
          </Group>
        </Group>
      </AppShell.Header>

      {/* ── Sidebar ── */}
      <AppShell.Navbar
        p="sm"
        style={{
          borderRight: '1px solid var(--cmc-border)',
          background: 'var(--cmc-surface)',
        }}
      >
        <ScrollArea h="100%" scrollbarSize={4}>
          {/* Overview link — no group label */}
          <NavLink
            label={OVERVIEW_NAV.label}
            leftSection={OVERVIEW_NAV.icon}
            active={activeTab === OVERVIEW_NAV.tab}
            onClick={() => { handleTabChange(OVERVIEW_NAV.tab); setMobileOpened(false); }}
            mb={4}
            styles={navlinkStyles(activeTab === OVERVIEW_NAV.tab)}
          />

          {STUDENT_NAV.map((section) => (
            <div key={section.group} style={{ marginBottom: 4 }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.06em',
                  color: 'var(--cmc-text-faint)',
                  padding: '10px 12px 4px',
                }}
              >
                {section.group}
              </Text>
              {section.items.map(({ tab, label, icon }) => (
                <NavLink
                  key={tab}
                  label={label}
                  leftSection={icon}
                  active={activeTab === tab}
                  onClick={() => { handleTabChange(tab); setMobileOpened(false); }}
                  styles={navlinkStyles(activeTab === tab)}
                />
              ))}
            </div>
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      {/* ── Main content ── */}
      <AppShell.Main style={{ padding: 'var(--cmc-space-6, 32px)' }}>
        <StudentView
          principal={principal}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onNotification={onNotification}
        />
      </AppShell.Main>
    </AppShell>
  );
}

function navlinkStyles(isActive: boolean) {
  return {
    root: {
      borderRadius: 10,
      color: isActive ? 'var(--cmc-brand-hover)' : 'var(--cmc-text)',
      backgroundColor: isActive ? 'var(--cmc-brand-muted)' : 'transparent',
      fontWeight: isActive ? 500 : 400,
    },
  };
}
