import { useState } from 'react';
import { AppShell, ActionIcon, Avatar, Badge, Button, Group, NavLink, Text, UnstyledButton } from '@mantine/core';
import { useSession } from '@cmc/ui';
import {
  IconBook,
  IconBuilding,
  IconBell,
  IconCurrencyDong,
  IconId,
  IconLayoutDashboard,
  IconTargetArrow,
  IconUsers,
} from '@tabler/icons-react';

// ─── Nav config ────────────────────────────────────────────────────────────────

type SectionKey =
  | 'overview'
  | 'courses'
  | 'org'
  | 'guardians'
  | 'hr'
  | 'kpi'
  | 'compensation';

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

// ─── Sidebar item ──────────────────────────────────────────────────────────────

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
        label: {
          fontSize: 14,
        },
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

// ─── Shell ─────────────────────────────────────────────────────────────────────

export type { SectionKey };

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
            <Text
              fw={700}
              style={{ color: 'var(--cmc-brand)', fontSize: 18, letterSpacing: '-0.02em' }}
            >
              CMC
            </Text>
            <Text
              size="sm"
              style={{ color: 'var(--cmc-text-muted)' }}
            >
              {sectionTitle}
            </Text>
          </Group>
          <Group gap="sm">
            <UnstyledButton
              aria-label="Thông báo"
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
              {/* Placeholder badge — replace with real unread count when staff-notif router is ready */}
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
                  display: 'none', // hidden until real data available
                }}
              >
                0
              </Badge>
            </UnstyledButton>
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
      <AppShell.Main
        style={{
          backgroundColor: 'var(--cmc-bg)',
          minHeight: '100vh',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            padding: 32,
          }}
        >
          {children}
        </div>
      </AppShell.Main>
    </AppShell>
  );
}

// ─── Nav items builder (used in App.tsx) ──────────────────────────────────────

export function buildNavGroups({
  canHr,
  canKpi,
  isSuperAdmin,
}: {
  canHr: boolean;
  canKpi: boolean;
  isSuperAdmin: boolean;
}): NavGroup[] {
  return [
    {
      groupLabel: 'Quản trị',
      items: [
        {
          key: 'overview',
          label: 'Tổng quan',
          icon: <IconLayoutDashboard size={18} stroke={1.5} />,
          visible: true,
        },
        {
          key: 'courses',
          label: 'Khóa học',
          icon: <IconBook size={18} stroke={1.5} />,
          visible: true,
        },
      ],
    },
    {
      groupLabel: 'Vận hành',
      items: [
        {
          key: 'org',
          label: 'Cơ sở & Users',
          icon: <IconBuilding size={18} stroke={1.5} />,
          visible: true,
        },
        {
          key: 'guardians',
          label: 'Phụ huynh',
          icon: <IconUsers size={18} stroke={1.5} />,
          visible: true,
        },
      ],
    },
    {
      groupLabel: 'Nhân sự',
      items: [
        {
          key: 'hr',
          label: 'Nhân sự & Lương',
          icon: <IconId size={18} stroke={1.5} />,
          visible: canHr,
        },
        {
          key: 'kpi',
          label: 'Đánh giá KPI',
          icon: <IconTargetArrow size={18} stroke={1.5} />,
          visible: canKpi,
        },
        {
          key: 'compensation',
          label: 'Cơ cấu lương',
          icon: <IconCurrencyDong size={18} stroke={1.5} />,
          visible: isSuperAdmin,
        },
      ],
    },
  ];
}

// ─── Section title map ─────────────────────────────────────────────────────────

export const SECTION_TITLES: Record<SectionKey, string> = {
  overview: 'Tổng quan',
  courses: 'Khóa học',
  org: 'Cơ sở & Người dùng',
  guardians: 'Phụ huynh',
  hr: 'Nhân sự & Lương',
  kpi: 'Đánh giá KPI',
  compensation: 'Cơ cấu lương',
};
