import { useState } from 'react';
import { notifyError, notifyInfo, notifySuccess } from '@cmc/ui';
import {
  AppShell,
  Group,
  Text,
  Button,
  Card,
  SimpleGrid,
  Stack,
  Title,
  Badge,
  Modal,
  Table,
  ActionIcon,
  Avatar,
  Progress,
  Box,
} from '@mantine/core';
import {
  IconHome,
  IconTrophy,
  IconGift,
  IconBook2,
  IconUser,
  IconStars,
  IconChevronRight,
  IconArrowLeft,
  IconCloud,
  IconLock,
  IconCheck,
  IconStar,
  IconCircleCheck,
} from '@tabler/icons-react';
import './climb/cloud-climb.css';

function CrownSVG({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 4px 6px rgba(217, 119, 6, 0.3))' }}>
      <path d="M2 4L5 13L12 7L19 13L22 4L17 19H7L2 4Z" fill="#FBBF24" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="4" r="1.5" fill="#FBBF24" stroke="#D97706" strokeWidth="1"/>
      <circle cx="2" cy="3" r="1.5" fill="#FBBF24" stroke="#D97706" strokeWidth="1"/>
      <circle cx="22" cy="3" r="1.5" fill="#FBBF24" stroke="#D97706" strokeWidth="1"/>
    </svg>
  );
}

function Medal2SVG({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="14" r="6" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="2"/>
      <path d="M8 8L10 2H14L16 8" stroke="#F43F5E" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 12V16M10 14H14" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function Medal3SVG({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="14" r="6" fill="#FDBA74" stroke="#C2410C" strokeWidth="2"/>
      <path d="M8 8L10 2H14L16 8" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 12V16M10 14H14" stroke="#C2410C" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

type ClimbNode = {
  id: string;
  step: number;
  title: string;
  state: 'done' | 'current' | 'upcoming';
  reward: number;
  starsEarned?: number;
  program: 'BLACK_HOLE' | 'BRIGHT_IG' | 'UCREA';
};

type GiftItem = {
  id: string;
  name: string;
  stars: number;
  img: string;
  stock: number;
  desc: string;
};

export function ShowcaseView() {
  const [role, setRole] = useState<'student' | 'parent'>('student');
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [mobileOpened, setMobileOpened] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [selectedCloud, setSelectedCloud] = useState<ClimbNode | null>(null);
  const [stars, setStars] = useState(320);

  // Mock data for student
  const studentStats = {
    stars: stars,
    exercisesCount: 18,
    doneCount: 14,
    rank: 4,
    levelName: 'BRIGHT I.G · Trí tuệ',
  };

  const climbNodes: ClimbNode[] = [
    { id: '1', step: 1, title: 'Làm quen với số học', state: 'done', reward: 10, starsEarned: 3, program: 'BLACK_HOLE' },
    { id: '2', step: 2, title: 'Hình học quanh ta', state: 'done', reward: 15, starsEarned: 3, program: 'BLACK_HOLE' },
    { id: '3', step: 3, title: 'Phép cộng thần kỳ', state: 'done', reward: 10, starsEarned: 2, program: 'BLACK_HOLE' },
    { id: '4', step: 4, title: 'Trò chơi logic vui nhộn', state: 'current', reward: 20, program: 'BRIGHT_IG' },
    { id: '5', step: 5, title: 'Thử thách mê cung số', state: 'upcoming', reward: 15, program: 'BRIGHT_IG' },
    { id: '6', step: 6, title: 'Sáng tạo hình khối 3D', state: 'upcoming', reward: 25, program: 'UCREA' },
  ];

  const rankingList = [
    { rank: 1, name: 'Nguyễn Minh Quân', stars: 450, avatar: 'MQ', color: 'yellow' },
    { rank: 2, name: 'Trần Gia Bảo', stars: 390, avatar: 'GB', color: 'gray' },
    { rank: 3, name: 'Lê Quỳnh Chi', stars: 340, avatar: 'QC', color: 'orange' },
    { rank: 4, name: 'Bạn (CMC Student)', stars: stars, avatar: 'ME', color: 'blue', isMe: true },
    { rank: 5, name: 'Phạm Đức Anh', stars: 290, avatar: 'DA', color: 'teal' },
  ];

  const giftItems: GiftItem[] = [
    { id: 'g1', name: 'Bộ lắp ráp LEGO Creative', stars: 150, img: '🧩', stock: 5, desc: 'Kích thích tư duy logic và sáng tạo không giới hạn.' },
    { id: 'g2', name: 'Bình nước CMC năng động', stars: 80, img: '🥤', stock: 12, desc: 'Bình giữ nhiệt chất liệu an toàn, đồng hành cùng con mỗi ngày.' },
    { id: 'g3', name: 'Balo rút học viên siêu chất', stars: 100, img: '🎒', stock: 8, desc: 'Tiện lợi, nhẹ nhàng và thời trang dành riêng cho CMCers.' },
    { id: 'g4', name: 'Truyện tranh khoa học kỳ thú', stars: 50, img: '📚', stock: 20, desc: 'Mở rộng kiến thức khoa học thường thức đầy bổ ích.' },
  ];

  // Parent specific mock data
  const parentNotifications = [
    { id: 'n1', date: '01/07/2026', content: 'Con vừa nộp bài tập "Trò chơi logic vui nhộn" đang chờ chấm điểm.' },
    { id: 'n2', date: '28/06/2026', content: 'Giáo viên đã chấm bài "Phép cộng thần kỳ": Đạt 9/10 điểm (+2 sao).' },
    { id: 'n3', date: '25/06/2026', content: 'Con xuất sắc nhận Huy hiệu "Nhà Thám Hiểm Trẻ" vì hoàn thành 10 bài tập!' },
  ];

  const classHistory = [
    { date: '30/06/2026', topic: 'Học phần tư duy không gian', attendance: 'Hiện diện', score: '9/10', comment: 'Con tập trung nghe giảng, tích cực tương tác xây dựng bài.' },
    { date: '27/06/2026', topic: 'Luyện tập phép tính nhanh', attendance: 'Hiện diện', score: '8/10', comment: 'Tính toán nhanh tốt, cần cẩn thận hơn ở các bước rà soát kết quả.' },
    { date: '24/06/2026', topic: 'Ứng dụng hình học cơ bản', attendance: 'Hiện diện', score: '10/10', comment: 'Xuất sắc! Con liên kết hình ảnh thực tế rất nhanh nhạy.' },
  ];

  const handleCloudClick = (node: ClimbNode) => {
    setSelectedCloud(node);
    setModalOpened(true);
  };

  const handleRedeem = (gift: GiftItem) => {
    if (stars >= gift.stars) {
      setStars(prev => prev - gift.stars);
      notifySuccess(`Đổi quà "${gift.name}" thành công! Hệ thống sẽ gửi thông báo duyệt đến phụ huynh.`, 'Đổi quà thành công');
    } else {
      notifyError('Bạn không đủ sao để đổi món quà này!', 'Không đủ sao');
    }
  };

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding="xl"
      styles={{
        root: {
          background: 'var(--cmc-gradient-sky)',
          minHeight: '100vh',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
        main: {
          paddingTop: '80px',
        }
      }}
    >
      {/* ── Header ── */}
      <AppShell.Header
        style={{
          background: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.4)',
          boxShadow: '0 4px 20px rgba(0, 113, 227, 0.05)',
        }}
      >
        <Group h="100%" px="xl" justify="space-between">
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
            <img src="brand/cmc-logo.jpg" alt="CMC EDU Logo" style={{ height: 36, borderRadius: 8 }} />
            <Stack gap={0}>
              <Text fw={900} size="lg" style={{ color: 'var(--cmc-brand-ink)', letterSpacing: '-0.02em', lineHeight: 1.1, fontFamily: 'var(--cmc-font-bubble)' }}>
                CMC EDU
              </Text>
              <Text size="10px" fw={700} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--cmc-font-friendly)' }}>
                Học Tập Gợi Mở
              </Text>
            </Stack>
          </Group>

          {/* Toggle Role Selector for User testing */}
          <Group gap="xs" style={{ background: 'rgba(0,0,0,0.05)', padding: 4, borderRadius: 9999 }} visibleFrom="sm">
            <Button
              size="xs"
              variant={role === 'student' ? 'filled' : 'subtle'}
              color="cmc"
              radius={9999}
              onClick={() => { setRole('student'); setActiveTab('overview'); setMobileOpened(false); }}
              leftSection={<IconStars size={14} />}
            >
              Học Sinh (3-11)
            </Button>
            <Button
              size="xs"
              variant={role === 'parent' ? 'filled' : 'subtle'}
              color="cmc"
              radius={9999}
              onClick={() => { setRole('parent'); setActiveTab('overview'); setMobileOpened(false); }}
              leftSection={<IconUser size={14} />}
            >
              Phụ Huynh
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      {/* ── Sidebar Navigation ── */}
      <AppShell.Navbar
        style={{
          background: 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(10px)',
          borderRight: '1px solid rgba(255, 255, 255, 0.4)',
          padding: '24px 16px',
        }}
      >
        <Stack gap="xs">
          {/* Toggle Role Selector for User testing — visible only on mobile inside sidebar */}
          <Group gap="xs" style={{ background: 'rgba(0,0,0,0.05)', padding: 4, borderRadius: 9999, marginBottom: 12 }} hiddenFrom="sm" justify="center">
            <Button
              size="xs"
              variant={role === 'student' ? 'filled' : 'subtle'}
              color="cmc"
              radius={9999}
              onClick={() => { setRole('student'); setActiveTab('overview'); setMobileOpened(false); }}
              leftSection={<IconStars size={12} />}
              style={{ flex: 1, minHeight: 32 }}
            >
              Học Sinh
            </Button>
            <Button
              size="xs"
              variant={role === 'parent' ? 'filled' : 'subtle'}
              color="cmc"
              radius={9999}
              onClick={() => { setRole('parent'); setActiveTab('overview'); setMobileOpened(false); }}
              leftSection={<IconUser size={12} />}
              style={{ flex: 1, minHeight: 32 }}
            >
              Phụ Huynh
            </Button>
          </Group>

          <Text size="11px" fw={800} c="dimmed" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', paddingLeft: 12 }}>
            {role === 'student' ? 'Hành Trình Con Học' : 'Quản Lý Của Mẹ'}
          </Text>

          {role === 'student' ? (
            <>
              <Button
                variant={activeTab === 'overview' ? 'light' : 'subtle'}
                color="cmc"
                radius="md"
                justify="flex-start"
                leftSection={<IconHome size={20} />}
                onClick={() => { setActiveTab('overview'); setMobileOpened(false); }}
                h={44}
              >
                Tổng quan
              </Button>
              <Button
                variant={activeTab === 'climb' ? 'light' : 'subtle'}
                color="cmc"
                radius="md"
                justify="flex-start"
                leftSection={<IconBook2 size={20} />}
                onClick={() => { setActiveTab('climb'); setMobileOpened(false); }}
                h={44}
              >
                Leo tầng mây
              </Button>
              <Button
                variant={activeTab === 'leaderboard' ? 'light' : 'subtle'}
                color="cmc"
                radius="md"
                justify="flex-start"
                leftSection={<IconTrophy size={20} />}
                onClick={() => { setActiveTab('leaderboard'); setMobileOpened(false); }}
                h={44}
              >
                Bảng xếp hạng
              </Button>
              <Button
                variant={activeTab === 'rewards' ? 'light' : 'subtle'}
                color="cmc"
                radius="md"
                justify="flex-start"
                leftSection={<IconGift size={20} />}
                onClick={() => { setActiveTab('rewards'); setMobileOpened(false); }}
                h={44}
              >
                Đổi quà nhận sao
              </Button>
            </>
          ) : (
            <>
              <Button
                variant={activeTab === 'overview' ? 'light' : 'subtle'}
                color="cmc"
                radius="md"
                justify="flex-start"
                leftSection={<IconHome size={20} />}
                onClick={() => { setActiveTab('overview'); setMobileOpened(false); }}
                h={44}
              >
                Nhật ký học tập
              </Button>
              <Button
                variant={activeTab === 'history' ? 'light' : 'subtle'}
                color="cmc"
                radius="md"
                justify="flex-start"
                leftSection={<IconBook2 size={20} />}
                onClick={() => { setActiveTab('history'); setMobileOpened(false); }}
                h={44}
              >
                Lịch sử & Nhận xét
              </Button>
              <Button
                variant={activeTab === 'rewards' ? 'light' : 'subtle'}
                color="cmc"
                radius="md"
                justify="flex-start"
                leftSection={<IconGift size={20} />}
                onClick={() => { setActiveTab('rewards'); setMobileOpened(false); }}
                h={44}
              >
                Duyệt đổi quà
              </Button>
            </>
          )}
        </Stack>

        {/* User profile & logout at the bottom of sidebar */}
        <Stack mt="auto" gap="xs" style={{ borderTop: '1px solid rgba(0, 0, 0, 0.08)', paddingTop: 16 }}>
          <Group gap="sm" px="xs">
            <Avatar color={role === 'student' ? 'orange' : 'teal'} radius="xl" size="md">
              {role === 'student' ? 'CS' : 'PH'}
            </Avatar>
            <Stack gap={0} style={{ flex: 1 }}>
              <Text size="xs" fw={800} style={{ color: '#1C3D5A', fontFamily: 'var(--cmc-font-friendly)' }}>
                {role === 'student' ? 'CMC Student' : 'Phụ Huynh Bé'}
              </Text>
              <Text size="10px" c="dimmed" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>
                {role === 'student' ? 'Lớp UCREA · Học sinh' : 'Tài khoản liên kết'}
              </Text>
            </Stack>
          </Group>
          <Button
            variant="subtle"
            color="red"
            radius="md"
            justify="flex-start"
            leftSection={<IconArrowLeft size={18} />}
            onClick={() => window.location.href = '/'}
            h={40}
            style={{ fontWeight: 700, fontFamily: 'var(--cmc-font-friendly)' }}
          >
            Đăng xuất
          </Button>
        </Stack>
      </AppShell.Navbar>

      {/* ── Main Content Shell ── */}
      <AppShell.Main>
        {role === 'student' ? (
          /* ==========================================================
             STUDENT MODE REDESIGN
             ========================================================== */
          activeTab === 'overview' ? (
            <Stack gap="xl">
              <Group justify="space-between">
                <Stack gap={2}>
                  <Title order={2} style={{ color: '#1D1D1F', fontWeight: 800 }}>
                    Chào con yêu, CMC Student! 👋
                  </Title>
                  <Text size="sm" c="dimmed">Hôm nay hãy cùng chinh phục những tầng mây tri thức mới nhé!</Text>
                </Stack>
                <Badge size="lg" color="yellow" variant="filled" style={{ height: 38, fontSize: 14, borderRadius: 999 }}>
                  🌟 {studentStats.stars} Sao tích lũy
                </Badge>
              </Group>

              {/* Stat grid widgets */}
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xl">
                <Card
                  className="cmc-clay-card"
                  onClick={() => setActiveTab('climb')}
                  p="xl"
                >
                  <Group justify="space-between" align="center" mb="xs">
                    <Text fw={800} size="xs" c="dimmed" style={{ textTransform: 'uppercase', fontFamily: 'var(--cmc-font-friendly)', letterSpacing: '0.08em' }}>Hành Trình Học</Text>
                    <IconCloud size={24} color="#0071E3" />
                  </Group>
                  <Text size="32px" fw={900} style={{ color: 'var(--cmc-brand)', fontFamily: 'var(--cmc-font-bubble)' }}>
                    {studentStats.doneCount}/{studentStats.exercisesCount}
                  </Text>
                  <Text size="xs" c="dimmed" mt={4} style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Bậc mây đã hoàn thành</Text>
                  <Progress value={(studentStats.doneCount / studentStats.exercisesCount) * 100} mt="md" radius="xl" color="blue" animated />
                </Card>

                <Card
                  className="cmc-clay-card"
                  onClick={() => setActiveTab('leaderboard')}
                  p="xl"
                >
                  <Group justify="space-between" align="center" mb="xs">
                    <Text fw={800} size="xs" c="dimmed" style={{ textTransform: 'uppercase', fontFamily: 'var(--cmc-font-friendly)', letterSpacing: '0.08em' }}>Xếp Hạng</Text>
                    <IconTrophy size={24} color="#FF9F0A" />
                  </Group>
                  <Text size="32px" fw={900} style={{ color: '#FF9F0A', fontFamily: 'var(--cmc-font-bubble)' }}>
                    #{studentStats.rank}
                  </Text>
                  <Text size="xs" c="dimmed" mt={4} style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Trực thuộc lớp học tư duy</Text>
                  <Group gap={4} mt="md">
                    <Text size="xs" fw={700} style={{ color: '#FF9F0A', fontFamily: 'var(--cmc-font-friendly)' }}>Lên hạng nhanh chóng</Text>
                    <IconChevronRight size={12} color="#FF9F0A" />
                  </Group>
                </Card>

                <Card
                  className="cmc-clay-card"
                  onClick={() => setActiveTab('rewards')}
                  p="xl"
                >
                  <Group justify="space-between" align="center" mb="xs">
                    <Text fw={800} size="xs" c="dimmed" style={{ textTransform: 'uppercase', fontFamily: 'var(--cmc-font-friendly)', letterSpacing: '0.08em' }}>Cửa Hàng Quà</Text>
                    <IconGift size={24} color="#34C759" />
                  </Group>
                  <Text size="32px" fw={900} style={{ color: '#34C759', fontFamily: 'var(--cmc-font-bubble)' }}>
                    4 Quà Tặng
                  </Text>
                  <Text size="xs" c="dimmed" mt={4} style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Đủ điều kiện đổi 2 món quà</Text>
                  <Group gap={4} mt="md">
                    <Text size="xs" fw={700} style={{ color: '#34C759', fontFamily: 'var(--cmc-font-friendly)' }}>Xem danh sách quà</Text>
                    <IconChevronRight size={12} color="#34C759" />
                  </Group>
                </Card>
              </SimpleGrid>

              {/* Action Suggestion */}
              <Card className="cmc-clay-card" p="xl" style={{ background: 'linear-gradient(135deg, rgba(0, 113, 227, 0.08), rgba(0, 210, 255, 0.05))' }}>
                <Group justify="space-between" align="center">
                  <Stack gap={4}>
                    <Text fw={800} size="md" style={{ color: 'var(--cmc-brand-ink)', fontFamily: 'var(--cmc-font-bubble)' }}>Bài học gợi ý tiếp theo</Text>
                    <Text size="sm" c="dimmed" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Chinh phục "Trò chơi logic vui nhộn" (+20 ⭐) để thăng hạng nhé!</Text>
                  </Stack>
                  <Button
                    className="cmc-clay-btn"
                    rightSection={<IconChevronRight size={16} />}
                    onClick={() => setActiveTab('climb')}
                    style={{ height: 38 }}
                  >
                    Học Ngay
                  </Button>
                </Group>
              </Card>
            </Stack>
          ) : activeTab === 'climb' ? (
            /* Redesigned interactive Climb View Beanstalk */
            <div className="climb-root" style={{ borderRadius: 'var(--cmc-radius-kid-lg)', border: '1px solid rgba(255,255,255,0.4)', background: '#C2E9FB' }}>
              <div className="climb-bg" style={{ background: 'linear-gradient(180deg, rgba(90, 182, 255, 0.6) 0%, rgba(194, 233, 251, 0.7) 100%)' }} />
              <div className="climb-scene" style={{ height: 1800 }}>
                {/* HUD inside scene */}
                <div className="climb-hud" style={{ background: 'rgba(255,255,255,0.2)', borderBottom: 'none' }}>
                  <img className="climb-hud__logo" src="brand/cmc-logo.jpg" alt="CMC" style={{ height: 26, borderRadius: 5 }} />
                  <span className="climb-hud__spacer" />
                  <span className="climb-chip climb-chip--gold">⭐ {stars}</span>
                  <span className="climb-chip">🏔 {studentStats.doneCount}/{climbNodes.length} bậc</span>
                </div>

                {/* Beanstalk trunk */}
                <div className="climb-trunk" style={{ height: 1800, width: 120, opacity: 0.85 }} />

                {/* Ground */}
                <div className="climb-ground" style={{ bottom: -30, height: 160 }} />

                {/* Wooden signs representing Program Tiers */}
                <div className="climb-sign" style={{ bottom: 300, borderColor: '#7950F2' }}>
                  <div className="climb-sign__text">
                    <strong>BLACK HOLE · Tư duy</strong>
                    <span>Chinh phục nền tảng cơ bản</span>
                  </div>
                </div>

                <div className="climb-sign" style={{ bottom: 900, borderColor: '#1B98E0' }}>
                  <div className="climb-sign__text">
                    <strong>BRIGHT I.G · Trí tuệ</strong>
                    <span>Khám phá logic chiều sâu</span>
                  </div>
                </div>

                <div className="climb-sign" style={{ bottom: 1500, borderColor: '#FF7B2E' }}>
                  <div className="climb-sign__text">
                    <strong>UCREA · Sáng tạo</strong>
                    <span>Bay bổng cùng hình khối</span>
                  </div>
                </div>

                {/* Beanstalk Clouds */}
                {climbNodes.map((n, i) => {
                  const leftPct = n.step % 2 === 0 ? '30%' : n.step % 2 === 1 ? '70%' : '50%';
                  const bottomPos = 380 + i * 220;
                  const isCurrent = n.state === 'current';
                  const isDone = n.state === 'done';
                  const isUpcoming = n.state === 'upcoming';

                  return (
                    <div
                      key={n.id}
                      className="climb-bnode"
                      style={{ bottom: bottomPos, left: leftPct }}
                    >
                      {isCurrent && <span className="climb-bnode__here">Con đang ở đây</span>}
                      {/* Floating Cloud */}
                      <div
                        style={{
                          background: 'rgba(255,255,255,0.92)',
                          borderRadius: 30,
                          padding: '16px 20px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 8,
                          boxShadow: isCurrent ? '0 12px 28px rgba(0, 113, 227, 0.18)' : '0 8px 16px rgba(0,0,0,0.06)',
                          border: isCurrent ? '2px solid var(--cmc-brand)' : '1px solid rgba(255,255,255,0.6)',
                          cursor: 'pointer',
                          transition: 'transform 0.2s ease',
                          transform: hoveredCard === `cloud-${n.id}` ? 'scale(1.05) translateY(-3px)' : 'none',
                        }}
                        onMouseEnter={() => setHoveredCard(`cloud-${n.id}`)}
                        onMouseLeave={() => setHoveredCard(null)}
                        onClick={() => handleCloudClick(n)}
                      >
                        {/* Cloud Button Circle */}
                        <div style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          background: isDone ? '#E2FBE9' : isCurrent ? '#FFF9DB' : '#F1F3F5',
                          border: `2px solid ${isDone ? '#34C759' : isCurrent ? '#F59E0B' : '#CED4DA'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: 16,
                          color: isDone ? '#1A6B34' : isCurrent ? '#7A4A00' : '#868E96',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.05)',
                        }}>
                          {isDone ? <IconCheck size={20} stroke={3} /> : isUpcoming ? <IconLock size={18} /> : n.step}
                        </div>

                        {/* Title & Reward info */}
                        <Stack gap={2} align="center">
                          <Text fw={800} size="xs" style={{ color: '#1C3D5A', maxWidth: 140, textAlign: 'center' }}>
                            {n.title}
                          </Text>
                          {isDone && n.starsEarned && (
                            <Text size="10px" fw={700} style={{ color: '#FF9F0A' }}>
                              {'⭐'.repeat(n.starsEarned)}
                            </Text>
                          )}
                          {!isDone && (
                            <Badge size="xs" color="yellow" variant="light">
                              +{n.reward} sao
                            </Badge>
                          )}
                        </Stack>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : activeTab === 'leaderboard' ? (
            /* Redesigned Kid Leaderboard with cute medals */
            <Stack gap="xl">
              <Title order={2} style={{ color: '#1D1D1F', fontWeight: 800, fontFamily: 'var(--cmc-font-bubble)' }}>
                🏆 Bảng Xếp Hạng Sao Tuần này
              </Title>
              <Card className="cmc-clay-card" p="xl">
                <Text size="lg" fw={800} mb="lg" style={{ color: '#1c3d5a', fontFamily: 'var(--cmc-font-bubble)' }}>
                  🏆 Bảng Vàng: Lớp Tư Duy UCREA
                </Text>

                {/* 3D Podium Layout */}
                <Group justify="center" align="flex-end" gap="sm" style={{ margin: '24px 0 32px' }}>
                  {/* 2nd Place */}
                  <Stack align="center" gap={4} style={{ width: 100 }}>
                    <Medal2SVG />
                    <Text size="xs" fw={800} style={{ color: '#475569', textAlign: 'center' }} lineClamp={1}>
                      Nguyễn Hoàng Nam
                    </Text>
                    <Box
                      style={{
                        height: 70,
                        width: '100%',
                        background: 'linear-gradient(180deg, #cbd5e1 0%, #94a3b8 100%)',
                        borderRadius: '16px 16px 12px 12px',
                        boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.1), inset 2px 2px 6px rgba(255,255,255,0.4)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Text size="lg" fw={900} c="white">2</Text>
                      <Text size="xs" fw={700} c="white" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <IconStar size={10} fill="currentColor" /> 165
                      </Text>
                    </Box>
                  </Stack>

                  {/* 1st Place */}
                  <Stack align="center" gap={4} style={{ width: 110 }}>
                    <CrownSVG />
                    <Text size="sm" fw={900} style={{ color: '#b45309', textAlign: 'center' }} lineClamp={1}>
                      CMC Student (Con)
                    </Text>
                    <Box
                      style={{
                        height: 100,
                        width: '100%',
                        background: 'linear-gradient(180deg, #fef08a 0%, #eab308 100%)',
                        borderRadius: '20px 20px 12px 12px',
                        boxShadow: 'inset -3px -3px 8px rgba(0,0,0,0.15), inset 3px 3px 8px rgba(255,255,255,0.5), 0 8px 20px rgba(234, 179, 8, 0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        border: '3px solid #fef08a',
                      }}
                    >
                      <Text size="xl" fw={900} c="white">1</Text>
                      <Text size="sm" fw={800} c="white" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <IconStar size={12} fill="currentColor" /> {stars}
                      </Text>
                    </Box>
                  </Stack>

                  {/* 3rd Place */}
                  <Stack align="center" gap={4} style={{ width: 100 }}>
                    <Medal3SVG />
                    <Text size="xs" fw={800} style={{ color: '#c2410c', textAlign: 'center' }} lineClamp={1}>
                      Trần Bảo Ngọc
                    </Text>
                    <Box
                      style={{
                        height: 50,
                        width: '100%',
                        background: 'linear-gradient(180deg, #ffedd5 0%, #ea580c 100%)',
                        borderRadius: '16px 16px 12px 12px',
                        boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.1), inset 2px 2px 6px rgba(255,255,255,0.4)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Text size="md" fw={900} c="white">3</Text>
                      <Text size="xs" fw={700} c="white" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <IconStar size={10} fill="currentColor" /> 140
                      </Text>
                    </Box>
                  </Stack>
                </Group>

                {/* List for the rest of the ranks */}
                <Stack gap="sm">
                  {rankingList.map((rankUser) => {
                    return (
                      <Group
                        key={rankUser.rank}
                        justify="space-between"
                        p="md"
                        style={{
                          background: rankUser.isMe ? 'var(--cmc-brand-muted)' : 'rgba(255, 255, 255, 0.4)',
                          borderRadius: '16px',
                          boxShadow: rankUser.isMe ? 'inset 0 0 0 2px var(--cmc-brand)' : 'none',
                        }}
                      >
                        <Group>
                          <div style={{ width: 36, display: 'flex', justifyContent: 'center' }}>
                            {rankUser.rank === 1 ? '🥇' : rankUser.rank === 2 ? '🥈' : rankUser.rank === 3 ? '🥉' : (
                              <Badge variant="light" color="gray" radius="xl" size="lg">{rankUser.rank}</Badge>
                            )}
                          </div>
                          <Avatar color={rankUser.color} radius="xl" size="md">
                            {rankUser.avatar}
                          </Avatar>
                          <Text fw={800} style={{ color: rankUser.isMe ? 'var(--cmc-brand-ink)' : '#1D1D1F', fontFamily: 'var(--cmc-font-friendly)' }}>
                            {rankUser.name} {rankUser.isMe && <Badge size="xs" color="cmc" radius="xl" ml={4}>Bạn</Badge>}
                          </Text>
                        </Group>
                        <Badge size="lg" color="yellow" variant="light" radius="xl" style={{ fontFamily: 'var(--cmc-font-bubble)' }}>
                          🌟 {rankUser.rank === 1 ? stars : rankUser.stars} Sao
                        </Badge>
                      </Group>
                    );
                  })}
                </Stack>
              </Card>
            </Stack>
          ) : (
            /* Redesigned Kid Rewards Gift Shop */
            <Stack gap="xl">
              <Group justify="space-between" align="center">
                <Stack gap={2}>
                  <Title order={2} style={{ color: '#1D1D1F', fontWeight: 800, fontFamily: 'var(--cmc-font-bubble)' }}>
                    🎁 Cửa Hàng Quà Tặng Ước Mơ
                  </Title>
                  <Text size="sm" c="dimmed" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Sử dụng sao tích lũy được từ việc làm bài tập để nhận những món quà siêu xịn!</Text>
                </Stack>
                <Badge size="lg" color="yellow" variant="filled" style={{ height: 38, fontSize: 14, fontFamily: 'var(--cmc-font-bubble)', borderRadius: 999 }}>
                  🌟 {stars} Sao khả dụng
                </Badge>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xl">
                {giftItems.map((gift) => {
                  const notEnough = stars < gift.stars;
                  return (
                    <Card
                      key={gift.id}
                      className="cmc-clay-card"
                      p="xl"
                    >
                      <Stack h="100%" gap="xs">
                        <div style={{
                          fontSize: 48,
                          background: 'rgba(0, 113, 227, 0.05)',
                          height: 100,
                          borderRadius: 'var(--cmc-radius-kid-lg)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)',
                        }}>
                          {gift.img}
                        </div>
                        <Text fw={800} size="md" mt="xs" style={{ color: '#1C3D5A', fontFamily: 'var(--cmc-font-bubble)' }}>
                          {gift.name}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={2} style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 500 }}>
                          {gift.desc}
                        </Text>
                        <Group justify="space-between" mt="md" gap="xs">
                          <Badge color="yellow" variant="light" size="sm" style={{ fontFamily: 'var(--cmc-font-bubble)' }}>🌟 {gift.stars} Sao</Badge>
                          <Text size="xs" c="dimmed" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Còn {gift.stock} phần</Text>
                        </Group>
                        <Button
                          className="cmc-clay-btn"
                          mt="auto"
                          disabled={notEnough}
                          onClick={() => handleRedeem(gift)}
                          style={{ height: 38 }}
                        >
                          {notEnough ? 'Thiếu Sao' : 'Đổi Quà Ngay'}
                        </Button>
                      </Stack>
                    </Card>
                  );
                })}
              </SimpleGrid>
            </Stack>
          )
        ) : (
          /* ==========================================================
             PARENT MODE REDESIGN (Aesthetic & analytical for parent)
             ========================================================== */
          activeTab === 'overview' ? (
            <Stack gap="xl">
              <Group justify="space-between" align="center">
                <Stack gap={2}>
                  <Title order={2} style={{ color: '#1D1D1F', fontWeight: 800, fontFamily: 'var(--cmc-font-bubble)' }}>
                    Nhật ký học tập của bé CMC Student 📝
                  </Title>
                  <Text size="sm" c="dimmed" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Đồng hành cùng con trên chặng đường rèn luyện và thấu hiểu tư duy.</Text>
                </Stack>
              </Group>

              {/* Progress Summary */}
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
                <Card className="cmc-clay-card" p="xl">
                  <Text fw={800} c="dimmed" size="xs" style={{ textTransform: 'uppercase', fontFamily: 'var(--cmc-font-friendly)', letterSpacing: '0.08em' }}>Tiến độ tuần này</Text>
                  <Group justify="space-between" mt="sm">
                    <Text size="xl" fw={900} style={{ fontFamily: 'var(--cmc-font-bubble)' }}>Hoàn thành 14/18 bài tập</Text>
                    <Text size="sm" fw={700} c="green" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Đúng hạn 100%</Text>
                  </Group>
                  <Progress value={(14 / 18) * 100} mt="md" radius="xl" color="green" />
                </Card>

                <Card className="cmc-clay-card" p="xl">
                  <Text fw={800} c="dimmed" size="xs" style={{ textTransform: 'uppercase', fontFamily: 'var(--cmc-font-friendly)', letterSpacing: '0.08em' }}>Huy hiệu gần nhất</Text>
                  <Group gap="md" mt="sm">
                    <IconTrophy size={32} color="#FF9F0A" />
                    <Stack gap={2}>
                      <Text fw={800} size="sm" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Nhà Thám Hiểm Trẻ</Text>
                      <Text size="xs" c="dimmed" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Đạt được khi hoàn thành toàn bộ khóa học tư duy Black Hole</Text>
                    </Stack>
                  </Group>
                </Card>
              </SimpleGrid>

              {/* Notification log */}
              <Card className="cmc-clay-card" p="xl">
                <Text fw={800} mb="md" style={{ color: '#1D1D1F', fontFamily: 'var(--cmc-font-bubble)' }}>Thông báo mới nhất về bé</Text>
                <Stack gap="md">
                  {parentNotifications.map((notif) => (
                    <Group key={notif.id} justify="space-between" align="flex-start" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" align="flex-start">
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cmc-brand)', marginTop: 6 }} />
                        <Text size="sm" style={{ color: '#3C3C43', fontFamily: 'var(--cmc-font-friendly)', fontWeight: 500 }}>{notif.content}</Text>
                      </Group>
                      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap', fontFamily: 'var(--cmc-font-friendly)' }}>{notif.date}</Text>
                    </Group>
                  ))}
                </Stack>
              </Card>
            </Stack>
          ) : activeTab === 'history' ? (
            /* History & detailed teacher reviews */
            <Stack gap="xl">
              <Title order={2} style={{ color: '#1D1D1F', fontWeight: 800, fontFamily: 'var(--cmc-font-bubble)' }}>
                Lịch sử học tập & Nhận xét của Giáo viên
              </Title>
              <Card className="cmc-clay-card" p="xl">
                <Table striped highlightOnHover verticalSpacing="md" style={{ borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 800 }}>Ngày học</Table.Th>
                      <Table.Th style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 800 }}>Nội dung chủ đề</Table.Th>
                      <Table.Th style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 800 }}>Điểm số</Table.Th>
                      <Table.Th style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 800 }}>Nhận xét chi tiết của Giáo viên</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {classHistory.map((row, i) => (
                      <Table.Tr key={i} style={{ background: 'rgba(255, 255, 255, 0.4)', borderRadius: 8 }}>
                        <Table.Td fw={700} style={{ fontFamily: 'var(--cmc-font-friendly)' }}>{row.date}</Table.Td>
                        <Table.Td style={{ fontFamily: 'var(--cmc-font-friendly)' }}>{row.topic}</Table.Td>
                        <Table.Td>
                          <Badge color="green" variant="light" size="md" style={{ fontFamily: 'var(--cmc-font-bubble)' }}>{row.score}</Badge>
                        </Table.Td>
                        <Table.Td style={{ maxWidth: 300 }}>
                          <Text size="sm" style={{ fontStyle: 'italic', fontFamily: 'var(--cmc-font-friendly)', fontWeight: 500 }}>"{row.comment}"</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            </Stack>
          ) : (
            /* Parent Reward Redemption approvals */
            <Stack gap="xl">
              <Title order={2} style={{ color: '#1D1D1F', fontWeight: 800, fontFamily: 'var(--cmc-font-bubble)' }}>
                Duyệt Đổi Quà Cho Bé
              </Title>
              <Card className="cmc-clay-card" p="xl">
                <Text size="sm" c="dimmed" mb="lg" style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 500 }}>
                  Khi con yêu cầu đổi quà trên ứng dụng, yêu cầu sẽ được hiển thị ở đây để bạn rà soát và gửi phê duyệt đến văn phòng CMC.
                </Text>

                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <IconCircleCheck size={48} color="var(--cmc-ok-text)" style={{ marginBottom: 12, filter: 'drop-shadow(0 4px 8px rgba(52, 199, 89, 0.2))' }} />
                  <Text fw={800} size="md" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Tất cả yêu cầu đã được xử lý</Text>
                  <Text size="xs" c="dimmed" mt={4} style={{ fontFamily: 'var(--cmc-font-friendly)' }}>Khi bé tích lũy đủ sao và bấm đổi quà, thông tin sẽ xuất hiện ngay lập tức.</Text>
                </div>
              </Card>
            </Stack>
          )
        )}
      </AppShell.Main>

      {/* Cloud Lesson Detail Dialog Prototype */}
      <Modal
        opened={modalOpened}
        onClose={() => setModalOpened(false)}
        title={selectedCloud ? `Bậc Mây Số ${selectedCloud.step}: ${selectedCloud.title}` : ''}
        size="md"
        radius="lg"
        centered
        styles={{
          header: { background: 'var(--cmc-bg)', borderBottom: '1px solid var(--cmc-border)' },
          content: { borderRadius: 'var(--cmc-radius-kid-lg)', overflow: 'hidden' }
        }}
      >
        {selectedCloud && (
          <Stack gap="md">
            <Group justify="space-between">
              <Badge color={selectedCloud.state === 'done' ? 'teal' : 'yellow'} size="md">
                {selectedCloud.state === 'done' ? 'Đã hoàn thành' : 'Đang mở làm'}
              </Badge>
              <Text size="xs" c="dimmed">Thưởng: {selectedCloud.reward} Sao</Text>
            </Group>

            <Text size="sm" style={{ color: '#3C3C43' }}>
              Hãy nhấp chuột để bắt đầu thử thách. Con sẽ trả lời trực tiếp bằng văn bản hoặc ghi chú hình vẽ lên file PDF đề bài để tích lũy sao nhé!
            </Text>

            {selectedCloud.state === 'done' && (
              <Card p="md" radius="md" bg="#E2FBE9">
                <Text size="xs" fw={700} c="green">Kết quả chấm bài của Thầy Cô:</Text>
                <Text size="sm" fw={800} mt={2}>Điểm đạt: 10/10 (+10 sao từ đề bài, +5 sao thưởng nộp bài sớm!)</Text>
                <Text size="xs" c="dimmed" mt={4}>"Nhận xét: Con có phương pháp tính thông minh, hình vẽ sạch sẽ, rõ ràng."</Text>
              </Card>
            )}

            <Group justify="flex-end" mt="md">
              <Button variant="subtle" color="gray" onClick={() => setModalOpened(false)}>
                Đóng
              </Button>
              <Button
                color="cmc"
                radius={9999}
                onClick={() => {
                  setModalOpened(false);
                  if (selectedCloud.state !== 'done') {
                    notifyInfo('Bắt đầu làm bài thi/bài tập mẫu của học viên!', 'Demo');
                  }
                }}
              >
                {selectedCloud.state === 'done' ? 'Xem lại bài làm' : 'Làm bài ngay'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </AppShell>
  );
}
