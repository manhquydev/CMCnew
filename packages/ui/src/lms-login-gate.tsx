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

  // ── Học sinh ───────────────────────────────────────────────────────────────
  const [idField, setIdField] = useState('');
  const [password, setPassword] = useState('');
  const [studentError, setStudentError] = useState('');

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
    setIdField('');
    setStudentError('');
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

  // Đăng nhập học sinh (giữ nguyên)
  async function onStudentSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStudentError('');
    try {
      await trpc.lmsAuth.loginStudent.mutate({ loginCode: idField, password });
      setPrincipal(await trpc.lmsAuth.me.query());
    } catch {
      setStudentError('Đăng nhập thất bại — kiểm tra lại thông tin.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await trpc.lmsAuth.logout.mutate();
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
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" rel="stylesheet" />
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
            backgroundImage: 'linear-gradient(to right, rgba(0, 113, 227, 0.85) 0%, rgba(0, 113, 227, 0.45) 100%), url(/brand/lms-login-bg.png)',
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
                : 'Học sinh dùng mã đăng nhập và mật khẩu thầy cô đã cấp.'}
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
                    leftSection={<span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--cmc-text-muted)' }}>mail</span>}
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
                    leftSection={<span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--cmc-text-muted)' }}>key</span>}
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

            {/* ── Học sinh: mã + mật khẩu ── */}
            {mode === 'student' && (
              <form onSubmit={onStudentSubmit}>
                <Stack gap="md">
                  <TextInput
                    label="Mã đăng nhập"
                    value={idField}
                    onChange={(e) => setIdField(e.currentTarget.value)}
                    required
                    placeholder="Mã số học sinh (ví dụ: TEST-001)"
                    leftSection={<span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--cmc-text-muted)' }}>face</span>}
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
                    placeholder="Nhập mật khẩu"
                    leftSection={<span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--cmc-text-muted)' }}>lock</span>}
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
