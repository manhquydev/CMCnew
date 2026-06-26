import { useState } from 'react';
import { AppShell, ActionIcon, Avatar, Badge, Box, Button, Group, NavLink, Popover, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { useSession, useStaffNotif } from '@cmc/ui';
import type { StaffNotifItem } from '@cmc/ui';
import {
  IconBook,
  IconBuilding,
  IconBell,
  IconCurrencyDong,
  IconHeadset,
  IconId,
  IconLayoutDashboard,
  IconReceipt,
  IconTargetArrow,
  IconTrendingUp,
  IconUsers,
  IconSchool,
  IconGift,
} from '@tabler/icons-react';

// ─── Nav config ────────────────────────────────────────────────────────────────

type SectionKey =
  | 'overview'
  | 'courses'
  | 'students'
  | 'org'
  | 'guardians'
  | 'hr'
  | 'kpi'
  | 'compensation'
  | 'finance'
  | 'crm'
  | 'cskh'
  | 'rewards';

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
  canFinance,
  canCrm,
  canCskh,
  canOrg,
  canGuardians,
  canStudents,
  canRewards,
  isSuperAdmin,
}: {
  canHr: boolean;
  canKpi: boolean;
  canFinance: boolean;
  canCrm: boolean;
  canCskh: boolean;
  canOrg: boolean;
  canGuardians: boolean;
  canStudents: boolean;
  canRewards: boolean;
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
        {
          key: 'students',
          label: 'Học sinh',
          icon: <IconSchool size={18} stroke={1.5} />,
          visible: canStudents,
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
          visible: canOrg,
        },
        {
          key: 'guardians',
          label: 'Phụ huynh',
          icon: <IconUsers size={18} stroke={1.5} />,
          visible: canGuardians,
        },
      ],
    },
    {
      groupLabel: 'Kinh doanh',
      items: [
        {
          key: 'finance',
          label: 'Tài chính',
          icon: <IconReceipt size={18} stroke={1.5} />,
          visible: canFinance,
        },
        {
          key: 'crm',
          label: 'CRM',
          icon: <IconTrendingUp size={18} stroke={1.5} />,
          visible: canCrm,
        },
        {
          key: 'cskh',
          label: 'Chăm sóc KH',
          icon: <IconHeadset size={18} stroke={1.5} />,
          visible: canCskh,
        },
        {
          key: 'rewards',
          label: 'Đổi quà',
          icon: <IconGift size={18} stroke={1.5} />,
          visible: canRewards,
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
  students: 'Học sinh',
  org: 'Cơ sở & Người dùng',
  guardians: 'Phụ huynh',
  finance: 'Tài chính',
  crm: 'CRM',
  cskh: 'Chăm sóc khách hàng',
  hr: 'Nhân sự & Lương',
  kpi: 'Đánh giá KPI',
  compensation: 'Cơ cấu lương',
  rewards: 'Đổi quà',
};
