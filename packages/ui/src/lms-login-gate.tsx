import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Anchor,
  Button,
  Center,
  Loader,
  Paper,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconLock, IconMail, IconKey, IconUserCircle } from '@tabler/icons-react';
import { trpc } from './client.js';
import { CMC_BRAND, LmsFooter } from './lms-brand.js';

type Principal = Awaited<ReturnType<typeof trpc.lmsAuth.me.query>>;
export type LmsPrincipal = NonNullable<Principal>;

const LmsCtx = createContext<{ principal: LmsPrincipal; logout: () => Promise<void> } | null>(null);

/** Resolved parent/student principal. Throws if used outside <LmsLoginGate>. */
export function useLmsSession() {
  const ctx = useContext(LmsCtx);
  if (!ctx) throw new Error('useLmsSession must be used inside <LmsLoginGate>');
  return ctx;
}

/**
 * Login gate for the LMS (parents + students). Two sign-in modes:
 *  - Phụ huynh: email OTP hai bước → lmsAuth.otpRequest / otpVerify
 *  - Học sinh:  mã đăng nhập + mật khẩu → lmsAuth.loginStudent
 * Renders `children` once a principal is resolved; provides it via useLmsSession().
 */
export function LmsLoginGate({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | undefined>(undefined);
  const [mode, setMode] = useState<'parent' | 'student'>('parent');

  // ── Phụ huynh OTP ──────────────────────────────────────────────────────────
  const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request');
  const [parentEmail, setParentEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [devHint, setDevHint] = useState(''); // mã hiển thị trong dev
  const [otpError, setOtpError] = useState('');

  // ── Học sinh: family phone login (parent phone + Cmc2026@) + profile picker ─
  // Netflix-style: loginFamilyByPhone returns a short-lived ticket (held here in local state
  // ONLY — it is not a cookie, not a session, see decision 0033 B1) + the family's non-blocked
  // children. 1 child → auto-enter (skip the picker). 2+ → render tiles; picking one calls
  // enterChildProfile, which mints the FIRST (and only) cookie on this path — always kind:'student'.
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [studentError, setStudentError] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [familyChildren, setFamilyChildren] = useState<{ id: string; fullName: string }[] | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    trpc.lmsAuth.me.query().then(setPrincipal).catch(() => setPrincipal(null));
  }, []);

  // Đặt lại trạng thái OTP khi chuyển tab
  function handleModeChange(v: string) {
    setMode(v as 'parent' | 'student');
    setOtpStep('request');
    setParentEmail('');
    setOtpCode('');
    setDevHint('');
    setOtpError('');
    setPhone('');
    setPassword('');
    setStudentError('');
    setTicket(null);
    setFamilyChildren(null);
  }

  // Bước 1: gửi OTP về email phụ huynh
  async function onOtpRequest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOtpError('');
    try {
      const res = await trpc.lmsAuth.otpRequest.mutate({ email: parentEmail });
      // Trong môi trường dev, backend trả về mã để tiện kiểm thử
      if (res.devCode) {
        setOtpCode(res.devCode);
        setDevHint(res.devCode);
      }
      setOtpStep('verify');
    } catch {
      // e.g. rate-limited (throttle) — surface a message instead of failing silently.
      setOtpError('Không gửi được mã, vui lòng thử lại sau ít phút.');
    } finally {
      setBusy(false);
    }
  }

  // Bước 2: xác nhận mã OTP
  async function onOtpVerify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOtpError('');
    try {
      await trpc.lmsAuth.otpVerify.mutate({ email: parentEmail, code: otpCode });
      setPrincipal(await trpc.lmsAuth.me.query());
    } catch {
      setOtpError('Mã không đúng hoặc đã hết hạn.');
    } finally {
      setBusy(false);
    }
  }

  // Bước 1: đăng nhập bằng SĐT phụ huynh + mật khẩu → ticket + danh sách con
  async function onFamilyLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStudentError('');
    try {
      const result = await trpc.lmsAuth.loginFamilyByPhone.mutate({ phone, password });
      const onlyChild = result.children.length === 1 ? result.children[0] : undefined;
      if (onlyChild) {
        // 1 con → vào thẳng, không hiện picker.
        await enterChild(result.ticket, onlyChild.id);
      } else {
        setTicket(result.ticket);
        setFamilyChildren(result.children);
      }
    } catch {
      setStudentError('Sai số điện thoại hoặc mật khẩu.');
    } finally {
      setBusy(false);
    }
  }

  // Bước 2 (hoặc trực tiếp nếu 1 con): chọn hồ sơ con → phiên đăng nhập học sinh thật.
  async function enterChild(t: string, studentId: string) {
    setEnteringId(studentId);
    setStudentError('');
    try {
      await trpc.lmsAuth.enterChildProfile.mutate({ ticket: t, studentId });
      setPrincipal(await trpc.lmsAuth.me.query());
    } catch {
      setStudentError('Phiên chọn hồ sơ đã hết hạn, vui lòng đăng nhập lại.');
      setTicket(null);
      setFamilyChildren(null);
    } finally {
      setEnteringId(null);
    }
  }

  // "Đăng nhập lại" từ picker — chưa có cookie nào được set ở bước này (chỉ có ticket cục bộ),
  // nên chỉ cần xóa state, không cần gọi logout().
  function backToFamilyLogin() {
    setTicket(null);
    setFamilyChildren(null);
    setPassword('');
    setStudentError('');
  }

  async function logout() {
    try {
      await trpc.lmsAuth.logout.mutate();
    } catch {
      // The server round-trip can legitimately fail here — e.g. a family/staff password
      // change just bumped tokenVersion, so the current cookie is already stale and
      // lmsAuth.logout (lmsProcedure) rejects it with UNAUTHORIZED. The session is dead
      // either way; always clear the client-side principal so the UI actually logs out.
    }
    setPrincipal(null);
  }

  if (principal === undefined) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (principal === null) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', width: '100vw', overflow: 'hidden' }}>
        <style dangerouslySetInnerHTML={{ __html: `
          .login-split-left {
            display: flex !important;
          }
          @media (max-width: 900px) {
            .login-split-left { display: none !important; }
            .login-split-right { flex: 1 1 100% !important; padding: 24px 16px !important; }
            .login-mobile-logo { display: flex !important; }
          }
        `}} />

        {/* Left Column - Graphic/Branding (Hidden on mobile) */}
        <div
          className="login-split-left"
          style={{
            flex: '1 1 55%',
            backgroundImage: 'linear-gradient(to right, rgba(0, 113, 227, 0.85) 0%, rgba(0, 113, 227, 0.45) 100%), url(brand/lms-login-bg.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '48px',
            position: 'relative',
          }}
        >
          {/* Logo and Brand Name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img 
              src={CMC_BRAND.logo} 
              alt={CMC_BRAND.name} 
              style={{ height: 38, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} 
            />
            <Text fw={800} size="xl" style={{ letterSpacing: '-0.02em', color: '#fff' }}>
              {CMC_BRAND.name}
            </Text>
          </div>

          {/* Central Slogan */}
          <Stack gap="xs" style={{ maxWidth: '520px' }}>
            <Text fw={900} style={{ fontSize: '42px', lineHeight: 1.2, color: '#fff', letterSpacing: '-0.02em', textShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
              Tò mò là khởi nguồn<br />
              của <span style={{ color: '#FFE066' }}>trí tuệ.</span>
            </Text>
            <Text size="md" style={{ color: 'rgba(255, 255, 255, 0.9)', marginTop: '12px', lineHeight: 1.6, textShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
              Học viện phát triển Tư duy & Năng lực số CMC.<br />
              Hệ thống LMS quản lý học tập cá nhân hóa giúp phụ huynh đồng hành và tiếp sức cho con leo tầng mây tri thức.
            </Text>
          </Stack>

          {/* Footer Copyright */}
          <Text size="xs" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
            &copy; {new Date().getFullYear()} {CMC_BRAND.name} · {CMC_BRAND.tagline}
          </Text>
        </div>

        {/* Right Column - Navigation & Form */}
        <div
          className="login-split-right"
          style={{
            flex: '1 1 45%',
            backgroundColor: '#F8FAFC',
            backgroundImage: 'radial-gradient(at 0% 0%, rgba(0, 113, 227, 0.05) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(255, 159, 10, 0.05) 0px, transparent 50%)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '32px 48px',
            overflowY: 'auto',
          }}
        >
          {/* Header Navigation for Mobile / Quick Links */}
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: '420px', alignItems: 'center' }}>
            <div style={{ display: 'none', alignItems: 'center', gap: '8px' }} className="login-mobile-logo">
              <img 
                src={CMC_BRAND.logo} 
                alt={CMC_BRAND.name} 
                style={{ height: 32, borderRadius: 6 }} 
              />
              <Text fw={800} size="md" style={{ color: 'var(--cmc-text)' }}>{CMC_BRAND.name}</Text>
            </div>
            <div style={{ display: 'flex', gap: '16px', marginLeft: 'auto' }}>
              <Anchor href={CMC_BRAND.websiteUrl} target="_blank" size="xs" fw={600} c="dimmed">
                Trang chủ CMC
              </Anchor>
            </div>
          </div>

          {/* Form Container Card */}
          <Paper
            withBorder
            shadow="md"
            p="xl"
            radius="lg"
            w="100%"
            maw={420}
            style={{
              background: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.4)',
              boxShadow: '0 8px 32px rgba(0, 113, 227, 0.06)',
              marginTop: 'auto',
              marginBottom: 'auto',
            }}
          >
            {/* Header Title for LMS Login */}
            <Stack align="center" gap={4} mb="xl">
              <Title order={1} size="h3" ta="center" style={{ color: 'var(--cmc-text)', fontWeight: 800 }}>
                Học tập cùng {CMC_BRAND.name}
              </Title>
              <Text ta="center" size="xs" c="dimmed">
                Chào mừng bạn! Hãy đăng nhập để bắt đầu học tập.
              </Text>
            </Stack>

            <SegmentedControl
              fullWidth
              mb="md"
              value={mode}
              onChange={handleModeChange}
              data={[
                { value: 'parent', label: 'Phụ huynh' },
                { value: 'student', label: 'Học sinh' },
              ]}
              styles={{
                root: {
                  backgroundColor: 'rgba(0, 113, 227, 0.05)',
                  borderRadius: '10px',
                  padding: '3px',
                },
                indicator: {
                  backgroundColor: mode === 'parent' ? 'var(--cmc-brand)' : '#fc9d41', // Blue for parent, warm orange for student
                  borderRadius: '8px',
                },
                label: {
                  fontWeight: 700,
                  fontSize: '13px',
                }
              }}
            />
            <Text size="xs" c="dimmed" ta="center" mb="lg">
              {mode === 'parent'
                ? 'Phụ huynh đăng nhập bằng email để theo dõi việc học của con.'
                : 'Đăng nhập bằng SĐT phụ huynh — nếu nhà có nhiều con, bạn sẽ chọn hồ sơ sau khi đăng nhập.'}
            </Text>

            {/* ── Phụ huynh: OTP hai bước ── */}
            {mode === 'parent' && otpStep === 'request' && (
              <form onSubmit={onOtpRequest}>
                <Stack gap="md">
                  <TextInput
                    label="Email phụ huynh"
                    type="email"
                    value={parentEmail}
                    onChange={(e) => setParentEmail(e.currentTarget.value)}
                    required
                    placeholder="phuhuynh@example.com"
                    leftSection={<IconMail size={18} stroke={1.5} color="var(--cmc-text-muted)" />}
                    styles={{
                      input: { height: '44px', borderRadius: '8px' },
                      label: { fontWeight: 600, fontSize: '13px', marginBottom: '4px' }
                    }}
                  />
                  {otpError && (
                    <Text c="red" size="sm">
                      {otpError}
                    </Text>
                  )}
                  <Button
                    type="submit"
                    loading={busy}
                    fullWidth
                    style={{
                      height: '44px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--cmc-brand)',
                      fontWeight: 600,
                      fontSize: '14px',
                      boxShadow: '0 4px 12px rgba(0, 113, 227, 0.2)'
                    }}
                  >
                    Gửi mã đăng nhập
                  </Button>
                </Stack>
              </form>
            )}

            {/* ── Phụ huynh: nhập mã OTP ── */}
            {mode === 'parent' && otpStep === 'verify' && (
              <form onSubmit={onOtpVerify}>
                <Stack gap="md">
                  <Text size="sm" c="dimmed">
                    Mã đã gửi đến: <strong>{parentEmail}</strong>
                  </Text>
                  {devHint && (
                    <Text size="xs" c="orange">
                      Mã (dev): {devHint}
                    </Text>
                  )}
                  <TextInput
                    label="Mã đăng nhập"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.currentTarget.value)}
                    maxLength={6}
                    required
                    placeholder="Nhập mã OTP 6 chữ số vừa nhận được"
                    leftSection={<IconKey size={18} stroke={1.5} color="var(--cmc-text-muted)" />}
                    styles={{
                      input: { height: '44px', borderRadius: '8px' },
                      label: { fontWeight: 600, fontSize: '13px', marginBottom: '4px' }
                    }}
                  />
                  {otpError && (
                    <Text c="red" size="sm">
                      {otpError}
                    </Text>
                  )}
                  <Button
                    type="submit"
                    loading={busy}
                    fullWidth
                    style={{
                      height: '44px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--cmc-brand)',
                      fontWeight: 600,
                      fontSize: '14px',
                      boxShadow: '0 4px 12px rgba(0, 113, 227, 0.2)'
                    }}
                  >
                    Xác nhận
                  </Button>
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    ta="center"
                    onClick={() => {
                      setOtpStep('request');
                      setOtpCode('');
                      setDevHint('');
                      setOtpError('');
                    }}
                    style={{ display: 'inline-block', padding: '8px 16px', marginTop: '4px' }}
                  >
                    Đổi email
                  </Anchor>
                </Stack>
              </form>
            )}

            {/* ── Học sinh: SĐT phụ huynh + mật khẩu ── */}
            {mode === 'student' && !familyChildren && (
              <form onSubmit={onFamilyLogin}>
                <Stack gap="md">
                  <TextInput
                    label="Số điện thoại phụ huynh"
                    value={phone}
                    onChange={(e) => setPhone(e.currentTarget.value)}
                    required
                    placeholder="0912345678"
                    leftSection={<IconUserCircle size={18} stroke={1.5} color="var(--cmc-text-muted)" />}
                    styles={{
                      input: { height: '44px', borderRadius: '8px' },
                      label: { fontWeight: 600, fontSize: '13px', marginBottom: '4px' }
                    }}
                  />
                  <PasswordInput
                    label="Mật khẩu"
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    required
                    placeholder="Cmc2026@"
                    leftSection={<IconLock size={18} stroke={1.5} color="var(--cmc-text-muted)" />}
                    styles={{
                      input: { height: '44px', borderRadius: '8px' },
                      label: { fontWeight: 600, fontSize: '13px', marginBottom: '4px' }
                    }}
                  />
                  {studentError && (
                    <Text c="red" size="sm">
                      {studentError}
                    </Text>
                  )}
                  <Button
                    type="submit"
                    loading={busy}
                    fullWidth
                    style={{
                      height: '44px',
                      borderRadius: '8px',
                      backgroundColor: '#fc9d41', // Warm orange for student
                      color: 'var(--cmc-text)', // Fix contrast from 2.1:1 to 8.3:1
                      fontWeight: 600,
                      fontSize: '14px',
                      boxShadow: '0 4px 12px rgba(252, 157, 65, 0.2)'
                    }}
                  >
                    Đăng nhập
                  </Button>
                </Stack>
              </form>
            )}

            {/* ── Học sinh: picker chọn hồ sơ (2+ con cùng SĐT) ── */}
            {mode === 'student' && familyChildren && (
              <Stack gap="md">
                <Text size="sm" c="dimmed" ta="center">
                  Chọn hồ sơ của con để tiếp tục
                </Text>
                <Stack gap="xs">
                  {familyChildren.map((child) => (
                    <Button
                      key={child.id}
                      variant="light"
                      fullWidth
                      loading={enteringId === child.id}
                      disabled={enteringId !== null && enteringId !== child.id}
                      onClick={() => ticket && enterChild(ticket, child.id)}
                      leftSection={<IconUserCircle size={20} stroke={1.5} />}
                      style={{ height: '52px', borderRadius: '10px', justifyContent: 'flex-start', fontSize: '14px', fontWeight: 600 }}
                    >
                      {child.fullName}
                    </Button>
                  ))}
                </Stack>
                {studentError && (
                  <Text c="red" size="sm" ta="center">
                    {studentError}
                  </Text>
                )}
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  ta="center"
                  onClick={backToFamilyLogin}
                  style={{ display: 'inline-block', padding: '8px 16px', marginTop: '4px' }}
                >
                  Đăng nhập lại
                </Anchor>
              </Stack>
            )}
          </Paper>

          <LmsFooter />
        </div>
      </div>
    );
  }

  return (
    <LmsCtx.Provider value={{ principal, logout }}>
      {children}
    </LmsCtx.Provider>
  );
}
