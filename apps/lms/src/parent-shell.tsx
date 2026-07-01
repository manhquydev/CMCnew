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
  IconReport,
  IconBell,
  IconStar,
  IconPhoto,
} from '@tabler/icons-react';
import { NotificationCenter, useLmsSession, type LmsPrincipal } from '@cmc/ui';
import { ParentView, type ParentTab } from './parent-view';

const PARENT_NAV: { tab: ParentTab; label: string; icon: React.ReactNode }[] = [
  { tab: 'overview', label: 'Tổng quan', icon: <IconHome size={18} stroke={1.5} /> },
  { tab: 'sessions', label: 'Buổi học', icon: <IconPhoto size={18} stroke={1.5} /> },
  { tab: 'gradebook', label: 'Học bạ', icon: <IconReport size={18} stroke={1.5} /> },
  { tab: 'notifications', label: 'Tiến trình', icon: <IconBell size={18} stroke={1.5} /> },
  { tab: 'rewards', label: 'Phần thưởng', icon: <IconStar size={18} stroke={1.5} /> },
];

interface ParentShellProps {
  principal: LmsPrincipal;
}

const ALL_PARENT_TABS = new Set<string>(['overview', 'sessions', 'gradebook', 'notifications', 'rewards']);

export function ParentShell({ principal }: ParentShellProps) {
  const { logout } = useLmsSession();
  const hashKey = window.location.hash.slice(1);
  const [activeTab, setActiveTab] = useState<ParentTab>(
    ALL_PARENT_TABS.has(hashKey) ? (hashKey as ParentTab) : 'overview',
  );
  const [mobileOpened, setMobileOpened] = useState(false);
  const [notificationPulse, setNotificationPulse] = useState(0);

  function handleTabChange(tab: ParentTab) {
    window.location.hash = tab;
    setActiveTab(tab);
  }

  function onNotification() {
    setNotificationPulse((k) => k + 1);
  }

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding={32}
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
          <Group gap="xs">
            <ActionIcon
              variant="subtle"
              hiddenFrom="sm"
              onClick={() => setMobileOpened((o) => !o)}
              aria-label="Mở menu"
              mr={4}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </ActionIcon>
            <img src="/brand/cmc-logo.jpg" alt="CMC EDU Logo" style={{ height: 32, borderRadius: 6 }} />
            <Text
              fw={800}
              size="md"
              style={{ color: 'var(--cmc-brand-ink)', letterSpacing: '-0.01em', fontFamily: 'var(--cmc-font-bubble)' }}
            >
              CMC EDU
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
              Phụ huynh {principal.displayName}
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
            CON CỦA TÔI
          </Text>
          {PARENT_NAV.map(({ tab, label, icon }) => (
            <NavLink
              key={tab}
              label={label}
              leftSection={icon}
              active={activeTab === tab}
              onClick={() => { handleTabChange(tab); setMobileOpened(false); }}
              styles={navlinkStyles(activeTab === tab)}
            />
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      {/* ── Main content ── (padding via AppShell `padding` keeps Mantine's navbar/header
           offset; an inline Main padding override would drop it and overlap the navbar). */}
      <AppShell.Main>
        <ParentView
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
