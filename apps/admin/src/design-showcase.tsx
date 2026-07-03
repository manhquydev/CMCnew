/**
 * Design System Showcase — accessible at /design (no login required).
 * Demonstrates all tokens and Mantine component overrides from the CMC design system.
 * For dev review only.
 */

import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Menu,
  Modal,
  NavLink,
  Notification,
  NumberInput,
  Pagination,
  PasswordInput,
  Progress,
  Select,
  Skeleton,
  Stack,
  Stepper,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBell,
  IconCash,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCurrencyDong,
  IconDots,
  IconDownload,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTargetArrow,
  IconTrash,
  IconUser,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import { StatCard, StatusBadge, InitialsAvatar, PipelineFunnel } from '@cmc/ui';

/* ─── Section wrapper ────────────────────────────────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box mb={48}>
      <Text
        size="xs"
        fw={600}
        tt="uppercase"
        c="dimmed"
        style={{ letterSpacing: '0.06em' }}
        mb={4}
      >
        {title}
      </Text>
      <Divider mb={20} color="var(--cmc-border-faint)" />
      {children}
    </Box>
  );
}

/* ─── Color swatch ───────────────────────────────────────────────────────── */
function Swatch({ color, label, hex }: { color: string; label: string; hex: string }) {
  return (
    <Stack gap={6} align="flex-start" style={{ minWidth: 80 }}>
      <Box
        style={{
          width: 56,
          height: 56,
          borderRadius: 10,
          backgroundColor: color,
          border: '1px solid var(--cmc-border)',
        }}
      />
      <Text size="xs" fw={500} c="var(--cmc-text)">
        {label}
      </Text>
      <Text size="xs" c="dimmed" style={{ fontFamily: 'var(--cmc-font-mono)' }}>
        {hex}
      </Text>
    </Stack>
  );
}

/* ─── Table sample data ──────────────────────────────────────────────────── */
const TABLE_DATA = [
  { id: 1, name: 'Nguyễn Văn An', role: 'Giáo viên', facility: 'CS1', status: 'active' },
  { id: 2, name: 'Trần Thị Bình', role: 'Kế toán', facility: 'CS2', status: 'pending' },
  { id: 3, name: 'Lê Minh Châu', role: 'Sale', facility: 'CS1', status: 'inactive' },
  { id: 4, name: 'Phạm Thu Dung', role: 'CSKH', facility: 'CS3', status: 'rejected' },
  { id: 5, name: 'Hoàng Văn Em', role: 'HR', facility: 'CS2', status: 'active' },
];

function statusBadge(status: string) {
  const map: Record<string, { color: string; label: string; dotColor: string }> = {
    active:   { color: 'cmcGreen', label: 'Hoạt động', dotColor: 'var(--cmc-status-active)'   },
    pending:  { color: 'cmcAmber', label: 'Chờ duyệt', dotColor: 'var(--cmc-status-pending)'  },
    inactive: { color: 'cmcGray',  label: 'Ngừng',     dotColor: 'var(--cmc-status-inactive)' },
    rejected: { color: 'cmcRed',   label: 'Từ chối',   dotColor: 'var(--cmc-status-rejected)' },
  };
  const s = map[status] ?? { color: 'cmcGray', label: 'Không xác định', dotColor: 'var(--cmc-status-inactive)' };
  return (
    <Group gap={4} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Box
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: s.dotColor,
          flexShrink: 0,
        }}
      />
      <Badge color={s.color} variant="light" radius="xl">
        {s.label}
      </Badge>
    </Group>
  );
}

/* ─── Stepper demo (extracted to avoid IIFE useState) ───────────────────── */
function StepperDemo() {
  const [step, setStep] = useState(1);
  return (
    <Stack gap={24}>
      <Stepper active={step} onStepClick={setStep}>
        <Stepper.Step label="Soạn thảo" description="Nhập tiêu chí KPI">
          <Card mt={16} p="lg">
            <Text size="sm" c="var(--cmc-text-muted)" mb={12}>Bước 1: Điền thông tin đánh giá KPI</Text>
            <Stack gap={12}>
              <TextInput label="Tên nhân viên" placeholder="Nguyễn Văn A" />
              <NumberInput label="Điểm tự đánh giá" min={0} max={100} placeholder="75" />
            </Stack>
          </Card>
        </Stepper.Step>
        <Stepper.Step label="Xác nhận" description="Trưởng bộ phận duyệt">
          <Card mt={16} p="lg">
            <Text size="sm" c="var(--cmc-text-muted)">Bước 2: Trưởng bộ phận xác nhận điểm KPI</Text>
          </Card>
        </Stepper.Step>
        <Stepper.Step label="Phê duyệt" description="Ban giám đốc phê duyệt">
          <Card mt={16} p="lg">
            <Text size="sm" c="var(--cmc-text-muted)">Bước 3: BGĐ phê duyệt và chốt điểm cuối</Text>
          </Card>
        </Stepper.Step>
        <Stepper.Completed>
          <Card mt={16} p="lg" style={{ textAlign: 'center' }}>
            <Text fw={600} c="var(--cmc-ok-text)">✓ Hoàn thành — Đánh giá KPI đã được phê duyệt</Text>
          </Card>
        </Stepper.Completed>
      </Stepper>
      <Group justify="flex-end" gap={8}>
        <Button
          variant="subtle"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          leftSection={<IconChevronLeft size={14} />}
        >
          Quay lại
        </Button>
        <Button
          variant="filled"
          radius={9999}
          disabled={step >= 3}
          onClick={() => setStep((s) => Math.min(3, s + 1))}
          rightSection={<IconChevronRight size={14} />}
        >
          {step >= 3 ? 'Hoàn thành' : 'Tiếp theo'}
        </Button>
      </Group>
    </Stack>
  );
}

/* ─── Main showcase ──────────────────────────────────────────────────────── */
export function DesignShowcase() {
  const [modalOpen, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [activeNav, setActiveNav] = useState('payroll');

  return (
    <Box
      style={{
        backgroundColor: 'var(--cmc-bg)',
        minHeight: '100vh',
        fontFamily: 'var(--cmc-font)',
      }}
    >
      {/* ── Topbar ── */}
      <Box
        style={{
          height: 'var(--cmc-topbar-h)',
          backgroundColor: 'rgba(245,245,247,0.85)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--cmc-border)',
          position: 'sticky',
          top: 0,
          zIndex: 'var(--cmc-z-sticky)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 32px',
          gap: 16,
        }}
      >
        <Text fw={700} size="md" c="var(--cmc-text)" style={{ letterSpacing: '-0.02em' }}>
          CMCnew
        </Text>
        <Text size="sm" c="dimmed">
          /
        </Text>
        <Text size="sm" c="var(--cmc-text-muted)">
          Design System Preview
        </Text>
        <Box style={{ flex: 1 }} />
        <ActionIcon variant="subtle" radius="md" aria-label="Search">
          <IconSearch size={16} />
        </ActionIcon>
        <ActionIcon variant="subtle" radius="md" aria-label="Notifications">
          <IconBell size={16} />
        </ActionIcon>
        <ActionIcon variant="subtle" radius="md" aria-label="Settings">
          <IconSettings size={16} />
        </ActionIcon>
      </Box>

      {/* ── Layout body ── */}
      <Box style={{ display: 'flex', minHeight: 'calc(100vh - 56px)' }}>

        {/* ── Sidebar ── */}
        <Box
          style={{
            width: 'var(--cmc-sidebar-w)',
            flexShrink: 0,
            backgroundColor: 'var(--cmc-surface)',
            borderRight: '1px solid var(--cmc-border)',
            padding: '20px 12px',
          }}
        >
          <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={8} px={8}
            style={{ letterSpacing: '0.06em' }}>
            Quản lý
          </Text>
          {[
            { id: 'overview',  label: 'Tổng quan',    icon: <IconInfoCircle size={18} /> },
            { id: 'users',     label: 'Người dùng',   icon: <IconUsers size={18} /> },
            { id: 'payroll',   label: 'Bảng lương',   icon: <IconCurrencyDong size={18} /> },
            { id: 'settings',  label: 'Cài đặt',      icon: <IconSettings size={18} /> },
          ].map((item) => (
            <NavLink
              key={item.id}
              label={item.label}
              leftSection={item.icon}
              active={activeNav === item.id}
              onClick={() => setActiveNav(item.id)}
              style={{
                borderRadius: 10,
                marginBottom: 2,
                color: activeNav === item.id ? 'var(--cmc-brand-hover)' : 'var(--cmc-text)',
                backgroundColor:
                  activeNav === item.id ? 'var(--cmc-brand-muted)' : 'transparent',
                fontWeight: activeNav === item.id ? 500 : 400,
              }}
            />
          ))}

          <Divider my={16} color="var(--cmc-border-faint)" />
          <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={8} px={8}
            style={{ letterSpacing: '0.06em' }}>
            Hệ thống
          </Text>
          <NavLink
            label="Tài khoản"
            leftSection={<IconUser size={18} />}
            active={activeNav === 'account'}
            onClick={() => setActiveNav('account')}
            style={{ borderRadius: 10 }}
          />
        </Box>

        {/* ── Main content ── */}
        <Box style={{ flex: 1, padding: '32px', maxWidth: 'var(--cmc-content-max)' }}>

          {/* Page header */}
          <Box mb={32}>
            <Breadcrumbs mb={8}>
              <Text size="sm" c="dimmed">Admin</Text>
              <Text size="sm" c="dimmed">Thiết kế</Text>
              <Text size="sm" fw={500}>Design System</Text>
            </Breadcrumbs>
            <Group justify="space-between" align="flex-end">
              <Box>
                <Title order={1} style={{ fontSize: 28, letterSpacing: '-0.02em' }}>
                  Design System Preview
                </Title>
                <Text c="dimmed" mt={4}>
                  Token palette, typography và toàn bộ component theo CMC Design System
                </Text>
              </Box>
              <Group gap={8}>
                <Button variant="subtle" color="cmc">Xem tài liệu</Button>
                <Button variant="filled">Tạo mới</Button>
              </Group>
            </Group>
          </Box>

          {/* ── COLORS ── */}
          <Section title="Màu sắc — Brand">
            <Group gap={20} wrap="wrap">
              <Swatch color="var(--cmc-brand)"       label="Brand"       hex="#0071E3" />
              <Swatch color="var(--cmc-brand-hover)"  label="Hover"       hex="#0055C6" />
              <Swatch color="var(--cmc-brand-muted)"  label="Muted"       hex="#E8F1FC" />
              <Swatch color="var(--cmc-brand-ink)"    label="Ink"         hex="#003D99" />
            </Group>
          </Section>

          <Section title="Màu sắc — Text & Surface">
            <Group gap={20} wrap="wrap">
              <Swatch color="var(--cmc-text)"         label="Text"        hex="#1D1D1F" />
              <Swatch color="var(--cmc-text-2)"       label="Text-2"      hex="#3C3C43" />
              <Swatch color="var(--cmc-text-muted)"   label="Muted"       hex="#6E6E73" />
              <Swatch color="var(--cmc-text-faint)"   label="Faint"       hex="#AEAEB2" />
              <Swatch color="var(--cmc-bg)"           label="Background"  hex="#F5F5F7" />
              <Swatch color="var(--cmc-surface)"      label="Surface"     hex="#FFFFFF" />
              <Swatch color="var(--cmc-surface-2)"    label="Surface-2"   hex="#F9F9FB" />
              <Swatch color="var(--cmc-border)"       label="Border"      hex="#E5E7EB" />
            </Group>
          </Section>

          <Section title="Màu sắc — Semantic">
            <Group gap={20} wrap="wrap">
              <Swatch color="var(--cmc-ok)"           label="Success"     hex="#06C167" />
              <Swatch color="var(--cmc-ok-bg)"        label="Success bg"  hex="#E6F9F0" />
              <Swatch color="var(--cmc-warn)"         label="Warning"     hex="#FF9F0A" />
              <Swatch color="var(--cmc-warn-bg)"      label="Warning bg"  hex="#FFF8EC" />
              <Swatch color="var(--cmc-danger)"       label="Danger"      hex="#FF3B30" />
              <Swatch color="var(--cmc-danger-bg)"    label="Danger bg"   hex="#FFF0EF" />
              <Swatch color="var(--cmc-info)"         label="Info"        hex="#0071E3" />
              <Swatch color="var(--cmc-info-bg)"      label="Info bg"     hex="#E8F1FC" />
            </Group>
          </Section>

          {/* ── TYPOGRAPHY ── */}
          <Section title="Typography">
            <Card p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
              <Stack gap={16}>
                {[
                  { label: 'text-3xl · 34px · 700', size: '34px', weight: 700, text: 'Tiêu đề KPI Dashboard' },
                  { label: 'text-2xl · 28px · 700', size: '28px', weight: 700, text: 'Quản lý nhân sự & Lương' },
                  { label: 'text-xl · 24px · 600',  size: '24px', weight: 600, text: 'Đánh giá KPI tháng 6/2026' },
                  { label: 'text-lg · 20px · 600',  size: '20px', weight: 600, text: 'Bảng lương chi tiết' },
                  { label: 'text-md · 17px · 500',  size: '17px', weight: 500, text: 'Thông tin nhân viên' },
                  { label: 'text-base · 15px · 400',size: '15px', weight: 400, text: 'Nguyễn Văn An làm việc tại cơ sở CS1 từ tháng 3/2025.' },
                  { label: 'text-sm · 13px · 400',  size: '13px', weight: 400, text: 'Cập nhật lần cuối: 25/06/2026 15:00' },
                  { label: 'text-xs · 11px · 600 · UPPERCASE', size: '11px', weight: 600, text: 'TRẠNG THÁI · MÃ NHÂN VIÊN · PHÒNG BAN', tt: 'uppercase' as const, ls: '0.06em' },
                ].map((t, i) => (
                  <Box key={i}>
                    <Text size="xs" c="dimmed" mb={2} style={{ fontFamily: 'var(--cmc-font-mono)' }}>
                      {t.label}
                    </Text>
                    <Text
                      style={{
                        fontSize: t.size,
                        fontWeight: t.weight,
                        letterSpacing: t.ls,
                        textTransform: t.tt,
                        lineHeight: 1.3,
                      }}
                    >
                      {t.text}
                    </Text>
                  </Box>
                ))}
              </Stack>
            </Card>
          </Section>

          {/* ── BUTTONS ── */}
          <Section title="Buttons">
            <Stack gap={16}>
              <Box>
                <Text size="xs" c="dimmed" mb={10}>Variants</Text>
                <Group gap={10} wrap="wrap">
                  <Button variant="filled">Filled (Primary)</Button>
                  <Button variant="light">Light</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="subtle">Subtle</Button>
                  <Button variant="default">Default</Button>
                </Group>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" mb={10}>Sizes</Text>
                <Group gap={10} align="center" wrap="wrap">
                  <Button size="xs">Extra Small</Button>
                  <Button size="sm">Small</Button>
                  <Button size="md">Medium</Button>
                  <Button size="lg">Large</Button>
                </Group>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" mb={10}>Colors & States</Text>
                <Group gap={10} wrap="wrap">
                  <Button variant="filled" color="cmc">Brand</Button>
                  <Button variant="filled" color="cmcRed">Destructive</Button>
                  <Button variant="filled" color="cmcGreen">Success</Button>
                  <Button variant="filled" loading>Loading</Button>
                  <Button variant="filled" disabled>Disabled</Button>
                </Group>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" mb={10}>With icons</Text>
                <Group gap={10} wrap="wrap">
                  <Button leftSection={<IconCheck size={15} />}>
                    Duyệt
                  </Button>
                  <Button variant="light" leftSection={<IconPencil size={15} />}>
                    Chỉnh sửa
                  </Button>
                  <Button variant="subtle" color="red" leftSection={<IconTrash size={15} />}>
                    Xóa
                  </Button>
                  <ActionIcon variant="subtle" radius="md" aria-label="Edit">
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" radius="md" aria-label="Delete">
                    <IconTrash size={16} />
                  </ActionIcon>
                  <Tooltip label="Tùy chọn thêm">
                    <ActionIcon variant="subtle" radius="md" aria-label="More">
                      <IconDots size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Box>
            </Stack>
          </Section>

          {/* ── BADGES ── */}
          <Section title="Badges & Status">
            <Group gap={10} wrap="wrap">
              <Badge color="cmcGreen" variant="light" radius="xl">Hoạt động</Badge>
              <Badge color="cmcAmber" variant="light" radius="xl">Chờ duyệt</Badge>
              <Badge color="cmcRed"   variant="light" radius="xl">Từ chối</Badge>
              <Badge color="cmcGray"  variant="light" radius="xl">Ngừng</Badge>
              <Badge color="cmc"      variant="light" radius="xl">Mới</Badge>
              <Badge color="cmcGreen" variant="filled" radius="xl">Đã duyệt</Badge>
              <Badge color="cmcAmber" variant="filled" radius="xl">Đang xử lý</Badge>
              <Badge color="cmcRed"   variant="filled" radius="xl">Lỗi</Badge>
              <Badge color="cmc"      variant="outline" radius="xl">Draft</Badge>
              <Badge color="cmcGreen" variant="light" size="lg" radius="xl">
                Active — Large
              </Badge>
            </Group>
          </Section>

          {/* ── FORM ── */}
          <Section title="Form & Inputs">
            <Card p="xl" style={{ border: '1px solid var(--cmc-border)', maxWidth: 640 }}>
              <Title order={3} mb="lg">Thông tin nhân viên</Title>
              <Stack gap="md">
                <Group grow gap="md">
                  <TextInput
                    label="Họ tên"
                    placeholder="Nguyễn Văn A"
                    required
                  />
                  <TextInput
                    label="Email"
                    type="email"
                    placeholder="email@cmc.edu.vn"
                    required
                  />
                </Group>
                <Select
                  label="Phòng ban"
                  placeholder="Chọn phòng ban"
                  data={['Giáo viên', 'Kế toán', 'HR', 'Sale', 'CSKH']}
                />
                <PasswordInput
                  label="Mật khẩu"
                  description="Tối thiểu 8 ký tự"
                  placeholder="••••••••"
                />
                <TextInput
                  label="Trạng thái lỗi"
                  defaultValue="abc"
                  error="Email không hợp lệ. Vui lòng nhập đúng định dạng."
                />
                <Textarea
                  label="Ghi chú"
                  placeholder="Nhập ghi chú..."
                  rows={3}
                />
                <Group>
                  <Checkbox label="Gửi email thông báo" defaultChecked />
                  <Switch label="Kích hoạt tài khoản" defaultChecked />
                </Group>
                <Group justify="flex-end" gap={8} mt={8}>
                  <Button variant="subtle">Hủy</Button>
                  <Button variant="filled">Lưu</Button>
                </Group>
              </Stack>
            </Card>
          </Section>

          {/* ── TABLE ── */}
          <Section title="Table — Data Dense">
            <Card p={0} style={{ border: '1px solid var(--cmc-border)', overflow: 'hidden' }}>
              <Box
                p="lg"
                style={{ borderBottom: '1px solid var(--cmc-border-faint)' }}
              >
                <Group justify="space-between">
                  <Text fw={600}>Danh sách nhân viên</Text>
                  <Group gap={8}>
                    <TextInput
                      placeholder="Tìm kiếm..."
                      size="sm"
                      leftSection={<IconSearch size={14} />}
                      style={{ width: 200 }}
                    />
                    <Button size="sm">+ Thêm</Button>
                  </Group>
                </Group>
              </Box>
              <Table striped highlightOnHover withTableBorder={false}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Họ tên</Table.Th>
                    <Table.Th>Vai trò</Table.Th>
                    <Table.Th>Cơ sở</Table.Th>
                    <Table.Th>Trạng thái</Table.Th>
                    <Table.Th style={{ width: 80 }}></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {TABLE_DATA.map((row) => (
                    <Table.Tr key={row.id}>
                      <Table.Td fw={500}>{row.name}</Table.Td>
                      <Table.Td c="dimmed">{row.role}</Table.Td>
                      <Table.Td>{row.facility}</Table.Td>
                      <Table.Td>{statusBadge(row.status)}</Table.Td>
                      <Table.Td>
                        <Menu shadow="sm" radius="md">
                          <Menu.Target>
                            <ActionIcon variant="subtle" radius="md" aria-label="Options">
                              <IconDots size={14} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconPencil size={14} />}>Chỉnh sửa</Menu.Item>
                            <Menu.Item leftSection={<IconUser size={14} />}>Xem hồ sơ</Menu.Item>
                            <Menu.Divider />
                            <Menu.Item
                              color="red"
                              leftSection={<IconTrash size={14} />}
                              data-danger
                            >
                              Xóa
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          </Section>

          {/* ── CARDS ── */}
          <Section title="Cards — KPI / Data">
            <Group gap={16} wrap="wrap" align="stretch">
              {[
                { label: 'Tổng thu nhập', value: '24,500,000 ₫', change: '+8.2%', ok: true },
                { label: 'Nhân viên hoạt động', value: '142', change: '+3', ok: true },
                { label: 'Khiếu nại tháng này', value: '7', change: '+2', ok: false },
                { label: 'KPI trung bình', value: '87.4%', change: '-1.2%', ok: false },
              ].map((kpi) => (
                <Card
                  key={kpi.label}
                  p="xl"
                  style={{
                    border: '1px solid var(--cmc-border)',
                    minWidth: 180,
                    flex: '1 1 180px',
                  }}
                >
                  <Text size="sm" c="dimmed" mb={6}>{kpi.label}</Text>
                  <Text
                    fw={700}
                    style={{
                      fontSize: 'var(--cmc-text-2xl)',
                      fontVariantNumeric: 'tabular-nums',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {kpi.value}
                  </Text>
                  <Group gap={4} mt={6}>
                    <Text
                      size="xs"
                      fw={500}
                      c={kpi.ok ? 'var(--cmc-ok-text)' : 'var(--cmc-danger-text)'}
                    >
                      {kpi.change}
                    </Text>
                    <Text size="xs" c="dimmed">so với tháng trước</Text>
                  </Group>
                </Card>
              ))}
            </Group>
          </Section>

          {/* ── STAT CARD (2a re-skin) ── */}
          <Section title="StatCard — Circular Accent Chip + Trend Arrow">
            <Group gap={16} wrap="wrap" align="stretch">
              <Box style={{ width: 220 }}>
                <StatCard
                  label="Doanh thu"
                  value="24.8 tỷ"
                  icon={<IconCash size={18} stroke={1.5} />}
                  accent="brand"
                  delta="+12.5%"
                  deltaDir="up"
                  deltaHint="so với tuần trước"
                />
              </Box>
              <Box style={{ width: 220 }}>
                <StatCard
                  label="Cơ hội chốt"
                  value="42"
                  icon={<IconTargetArrow size={18} stroke={1.5} />}
                  accent="ok"
                  delta="+8"
                  deltaDir="up"
                  deltaHint="tháng này"
                />
              </Box>
              <Box style={{ width: 220 }}>
                <StatCard
                  label="Cảnh báo KPI"
                  value="7"
                  icon={<IconTargetArrow size={18} stroke={1.5} />}
                  accent="warn"
                  delta="+2"
                  deltaDir="down"
                  deltaHint="so với tháng trước"
                />
              </Box>
              <Box style={{ width: 220 }}>
                <StatCard
                  label="Khiếu nại"
                  value="3"
                  icon={<IconTargetArrow size={18} stroke={1.5} />}
                  accent="danger"
                  delta="0%"
                  deltaDir="flat"
                  deltaHint="không đổi"
                />
              </Box>
            </Group>
          </Section>

          {/* ── STATUS BADGE PILL (2b re-skin) ── */}
          <Section title="StatusBadge — Pill Variant">
            <Stack gap={16}>
              <Box>
                <Text size="xs" c="dimmed" mb={10}>Mặc định (dot + light badge)</Text>
                <Group gap={10} wrap="wrap">
                  <StatusBadge status="active" label="Hoạt động" tone="active" />
                  <StatusBadge status="pending" label="Chờ duyệt" tone="pending" />
                  <StatusBadge status="rejected" label="Từ chối" tone="rejected" />
                </Group>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" mb={10}>Pill (uppercase, dotless — cockpit wireframe)</Text>
                <Group gap={10} wrap="wrap">
                  <StatusBadge status="active" label="Vượt KPI" tone="active" pill />
                  <StatusBadge status="pending" label="Cảnh báo" tone="pending" pill />
                  <StatusBadge status="rejected" label="Chưa đạt" tone="rejected" pill />
                </Group>
              </Box>
            </Stack>
          </Section>

          {/* ── INITIALS AVATAR (2c) ── */}
          <Section title="InitialsAvatar — Deterministic Color">
            <Group gap={16} wrap="wrap" align="center">
              <InitialsAvatar name="Nguyễn Thành Trung" />
              <InitialsAvatar name="Trần Thị Bình" />
              <InitialsAvatar name="Lê Minh Châu" />
              <InitialsAvatar name="Phạm Thu Dung" />
              <InitialsAvatar name="Hoàng Văn Em" size={44} />
            </Group>
          </Section>

          {/* ── PIPELINE FUNNEL (2d) ── */}
          <Section title="PipelineFunnel — Gradient Chevron Funnel">
            <PipelineFunnel
              stages={[
                { label: 'O1: Lead mới', count: 840, value: '100% Volume' },
                { label: 'O2: Liên hệ', count: 512, value: '61% Chuyển đổi' },
                { label: 'O3: Giải pháp', count: 204, value: '40% Chuyển đổi' },
                { label: 'O4: Đàm phán', count: 88, value: '43% Chuyển đổi' },
                { label: 'O5: Thành công', count: 42, value: '48% Chuyển đổi' },
              ]}
            />
          </Section>

          {/* ── TABS ── */}
          <Section title="Tabs">
            <Tabs defaultValue="general">
              <Tabs.List>
                <Tabs.Tab value="general">Tổng quan</Tabs.Tab>
                <Tabs.Tab value="payroll">Bảng lương</Tabs.Tab>
                <Tabs.Tab value="kpi">Đánh giá KPI</Tabs.Tab>
                <Tabs.Tab value="settings">Cài đặt</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="general" pt="xl">
                <Text c="dimmed" size="sm">Nội dung tab Tổng quan.</Text>
              </Tabs.Panel>
            </Tabs>
          </Section>

          {/* ── MODAL ── */}
          <Section title="Modal & Notifications">
            <Stack gap={16}>
              <Group gap={10}>
                <Button variant="filled" onClick={openModal}>
                  Mở Modal
                </Button>
              </Group>
              <Modal
                opened={modalOpen}
                onClose={closeModal}
                title="Xác nhận duyệt bảng lương"
                centered
              >
                <Text size="sm" c="dimmed" mb="xl">
                  Bạn có chắc muốn duyệt bảng lương tháng 6/2026 cho cơ sở CS1?
                  Sau khi duyệt, dữ liệu sẽ được gửi cho kế toán xử lý.
                </Text>
                <Group justify="flex-end" gap={8}>
                  <Button variant="subtle" onClick={closeModal}>Hủy</Button>
                  <Button variant="filled" onClick={closeModal}>
                    Xác nhận duyệt
                  </Button>
                </Group>
              </Modal>

              <Stack gap={10} style={{ maxWidth: 400 }}>
                <Notification
                  icon={<IconCheck size={18} />}
                  color="cmcGreen"
                  title="Duyệt thành công"
                  withCloseButton={false}
                >
                  Bảng lương tháng 6 đã được duyệt và gửi kế toán.
                </Notification>
                <Notification
                  icon={<IconX size={18} />}
                  color="cmcRed"
                  title="Lỗi hệ thống"
                  withCloseButton={false}
                >
                  Không thể kết nối máy chủ. Vui lòng thử lại.
                </Notification>
                <Notification
                  icon={<IconInfoCircle size={18} />}
                  color="cmc"
                  title="Thông báo"
                  withCloseButton={false}
                >
                  KPI tháng 6 đã được cập nhật từ hệ thống Callio.
                </Notification>
              </Stack>
            </Stack>
          </Section>

          {/* ── RADIUS SCALE ── */}
          <Section title="Border Radius Scale">
            <Group gap={20} wrap="wrap" align="flex-end">
              {[
                { label: 'xs · 4px',      r: '4px',    w: 48  },
                { label: 'sm · 8px',      r: '8px',    w: 56  },
                { label: 'base · 10px',   r: '10px',   w: 64  },
                { label: 'md · 14px',     r: '14px',   w: 72  },
                { label: 'lg · 18px',     r: '18px',   w: 80  },
                { label: 'xl · 24px',     r: '24px',   w: 88  },
                { label: 'pill · 9999px', r: '9999px', w: 96  },
              ].map((item) => (
                <Stack key={item.label} gap={8} align="center">
                  <Box
                    style={{
                      width: item.w,
                      height: 48,
                      backgroundColor: 'var(--cmc-brand-muted)',
                      border: '1px solid var(--cmc-brand)',
                      borderRadius: item.r,
                    }}
                  />
                  <Text size="xs" c="dimmed" style={{ fontFamily: 'var(--cmc-font-mono)' }}>
                    {item.label}
                  </Text>
                </Stack>
              ))}
            </Group>
          </Section>

          {/* ── SHADOW SCALE ── */}
          <Section title="Shadow Scale">
            <Text size="xs" c="dimmed" mb={12}>
              Zero Elevation doctrine: Card/Paper/Notification use <b>none</b> (decorative, border-only).
              Modal/Menu/Select/Drawer use <b>sm</b> (functional minimum depth-cue). md/lg/xl remain
              reserved for opportunistic use (e.g. hover-elevated cards) — no component defaults to them.
            </Text>
            <Group gap={24} wrap="wrap" align="flex-start">
              {[
                { label: 'none',  usage: 'Card, Paper, Notification', shadow: 'none',                   border: '1px solid var(--cmc-border)' },
                { label: 'xs',    usage: 'reserved',                  shadow: 'var(--cmc-shadow-xs)',   border: 'none' },
                { label: 'sm',    usage: 'Modal, Menu, Select, Drawer', shadow: 'var(--cmc-shadow-sm)', border: 'none' },
                { label: 'md',    usage: 'reserved (hover opt-in)',   shadow: 'var(--cmc-shadow-md)',   border: 'none' },
                { label: 'lg',    usage: 'reserved',                  shadow: 'var(--cmc-shadow-lg)',   border: 'none' },
                { label: 'xl',    usage: 'reserved',                  shadow: 'var(--cmc-shadow-xl)',   border: 'none' },
              ].map((item) => (
                <Stack key={item.label} gap={8} align="center">
                  <Box
                    style={{
                      width: 80,
                      height: 80,
                      backgroundColor: '#FFFFFF',
                      borderRadius: 14,
                      boxShadow: item.shadow,
                      border: item.border,
                    }}
                  />
                  <Text size="xs" c="dimmed" style={{ fontFamily: 'var(--cmc-font-mono)' }}>
                    {item.label}
                  </Text>
                  <Text size="xs" c="dimmed" ta="center" style={{ maxWidth: 90 }}>
                    {item.usage}
                  </Text>
                </Stack>
              ))}
            </Group>
          </Section>

          {/* ── PROGRESS & MISC ── */}
          <Section title="Progress & Misc">
            <Stack gap={16} style={{ maxWidth: 400 }}>
              <Box>
                <Text size="sm" mb={8}>KPI tiến độ — 87%</Text>
                <Progress value={87} color="cmc" radius="xl" />
              </Box>
              <Box>
                <Text size="sm" mb={8}>Hoàn thành mục tiêu — 62%</Text>
                <Progress value={62} color="cmcAmber" radius="xl" />
              </Box>
              <Box>
                <Text size="sm" mb={8}>Tỷ lệ lỗi — 23%</Text>
                <Progress value={23} color="cmcRed" radius="xl" />
              </Box>
            </Stack>
          </Section>

          {/* ── EMPTY STATE ── */}
          <Section title="Empty State">
            <Card p={48} style={{ textAlign: 'center' }}>
              <Stack align="center" gap={16}>
                <Box
                  style={{
                    width: 64, height: 64, borderRadius: '50%',
                    backgroundColor: 'var(--cmc-brand-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <IconUsers size={28} color="var(--cmc-brand)" />
                </Box>
                <Title order={4} c="var(--cmc-text)">Chưa có nhân sự</Title>
                <Text size="sm" c="var(--cmc-text-muted)" maw={320}>
                  Chưa có nhân viên nào trong hệ thống. Thêm nhân sự đầu tiên để bắt đầu quản lý.
                </Text>
                <Button variant="filled" leftSection={<IconPlus size={14} />}>
                  Thêm nhân sự
                </Button>
              </Stack>
            </Card>
          </Section>

          {/* ── SKELETON LOADING ── */}
          <Section title="Skeleton / Loading State">
            <Stack gap={12}>
              {/* Table skeleton */}
              <Card p={0} style={{ overflow: 'hidden' }}>
                <Box p="md" style={{ borderBottom: '1px solid var(--cmc-border-faint)' }}>
                  <Skeleton height={20} width={200} radius="sm" />
                </Box>
                {[1, 2, 3, 4].map((i) => (
                  <Box
                    key={i}
                    p="md"
                    style={{
                      borderBottom: '1px solid var(--cmc-border-faint)',
                      display: 'flex',
                      gap: 16,
                      alignItems: 'center',
                    }}
                  >
                    <Skeleton height={32} circle />
                    <Skeleton height={14} width="30%" radius="sm" />
                    <Skeleton height={14} width="20%" radius="sm" />
                    <Skeleton height={20} width={80} radius="xl" />
                  </Box>
                ))}
              </Card>
              {/* KPI skeleton */}
              <Group grow>
                {[1, 2, 3].map((i) => (
                  <Card key={i} p="lg">
                    <Skeleton height={12} width={100} radius="sm" mb={12} />
                    <Skeleton height={28} width={120} radius="sm" mb={8} />
                    <Skeleton height={12} width={80} radius="sm" />
                  </Card>
                ))}
              </Group>
            </Stack>
          </Section>

          {/* ── BULK ACTION BAR ── */}
          <Section title="Bulk Action Bar">
            <Stack gap={8}>
              {/* Selection toolbar — appears when rows are checked */}
              <Box
                style={{
                  backgroundColor: 'var(--cmc-brand-muted)',
                  border: '1px solid var(--cmc-brand)',
                  borderRadius: 10,
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <Text size="sm" fw={600} c="var(--cmc-brand-hover)">
                  3 mục đã chọn
                </Text>
                <Box style={{ flex: 1 }} />
                <Button size="xs" variant="light" color="cmc" leftSection={<IconDownload size={14} />}>
                  Xuất Excel
                </Button>
                <Button size="xs" variant="light" color="cmcAmber">
                  Tạm khóa
                </Button>
                <Button size="xs" variant="light" color="cmcRed" leftSection={<IconTrash size={14} />}>
                  Xóa
                </Button>
                <ActionIcon variant="subtle" size="sm" aria-label="Bỏ chọn">
                  <IconX size={14} />
                </ActionIcon>
              </Box>
              {/* Sample table with checkboxes */}
              <Card p={0} style={{ overflow: 'hidden' }}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 40 }}><Checkbox size="xs" /></Table.Th>
                      <Table.Th>Họ tên</Table.Th>
                      <Table.Th>Chức vụ</Table.Th>
                      <Table.Th>Trạng thái</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {TABLE_DATA.slice(0, 3).map((row) => (
                      <Table.Tr key={row.id}>
                        <Table.Td><Checkbox size="xs" defaultChecked={row.id <= 2} /></Table.Td>
                        <Table.Td>{row.name}</Table.Td>
                        <Table.Td><Text size="sm" c="var(--cmc-text-muted)">{row.role}</Text></Table.Td>
                        <Table.Td>{statusBadge(row.status)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            </Stack>
          </Section>

          {/* ── STEPPER ── */}
          <Section title="Multi-Step Stepper (KPI / Approval Flow)">
            <StepperDemo />
          </Section>

          {/* ── PAGINATION ── */}
          <Section title="Pagination">
            <Stack gap={16}>
              <Group justify="space-between" align="center">
                <Text size="sm" c="var(--cmc-text-muted)">Hiển thị 1–20 / 143 kết quả</Text>
                <Pagination total={8} defaultValue={1} color="cmc" radius="md" />
              </Group>
              <Group justify="space-between" align="center">
                <Text size="sm" c="var(--cmc-text-muted)">Hiển thị 1–50 / 143 kết quả</Text>
                <Pagination total={3} defaultValue={2} color="cmc" radius="md" size="sm" withEdges siblings={1} />
              </Group>
            </Stack>
          </Section>

          {/* ── READ-ONLY FIELDS ── */}
          <Section title="Read-Only Fields (Locked Form — Bảng lương đã duyệt)">
            <Card p="lg">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--cmc-text-muted)"
                mb={16}
                style={{ letterSpacing: '0.06em' }}
              >
                Thông tin bảng lương — Tháng 5/2026 (Đã phê duyệt)
              </Text>
              <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {[
                  { label: 'Nhân viên', value: 'Nguyễn Văn An' },
                  { label: 'Chức vụ', value: 'Giáo viên' },
                  { label: 'Lương cơ bản', value: '12.000.000 ₫' },
                  { label: 'Hoa hồng', value: '3.500.000 ₫' },
                  { label: 'KPI bonus', value: '2.000.000 ₫' },
                  { label: 'Thực nhận', value: '17.500.000 ₫' },
                ].map(({ label, value }) => (
                  <Box key={label}>
                    <Text size="xs" fw={500} c="var(--cmc-text-muted)" mb={4}>{label}</Text>
                    <Box
                      style={{
                        padding: '8px 12px',
                        backgroundColor: 'var(--cmc-surface-2)',
                        border: '1px solid var(--cmc-border-faint)',
                        borderRadius: 8,
                        fontSize: 14,
                        color: 'var(--cmc-text)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {value}
                    </Box>
                  </Box>
                ))}
              </Box>
              <Group mt={20} gap={8}>
                <Badge color="cmcGreen" variant="light" radius="xl">Đã phê duyệt</Badge>
                <Text size="xs" c="var(--cmc-text-muted)">Phê duyệt bởi: Trần Giám Đốc — 20/05/2026</Text>
              </Group>
            </Card>
          </Section>

          {/* Footer */}
          <Box mt={64} pt={24} style={{ borderTop: '1px solid var(--cmc-border-faint)' }}>
            <Text size="xs" c="dimmed">
              CMCnew Design System · Apple-inspired ERP · packages/ui/src/tokens.css + theme.ts
            </Text>
          </Box>

        </Box>
      </Box>
    </Box>
  );
}
