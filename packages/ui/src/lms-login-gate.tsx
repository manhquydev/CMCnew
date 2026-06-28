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
      <div
        style={{
          minHeight: '100vh',
          background:
            'linear-gradient(180deg,#0071E3 0%,#3f8fe8 30%,rgba(120,170,235,0.86) 60%,rgba(190,215,245,0.55) 100%), url(/brand/login-bg.jpg) center bottom / cover no-repeat, #0071E3',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 16px',
        }}
      >
        <Stack align="center" gap="lg" w="100%" maw={420}>
          {/* Brand header */}
          <Stack align="center" gap={6}>
            <img
              src={CMC_BRAND.logo}
              alt={CMC_BRAND.name}
              style={{ height: 56, borderRadius: 12, background: '#fff', padding: '6px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}
            />
            <Title order={1} size="h3" ta="center" style={{ color: '#fff' }}>
              Học tập cùng {CMC_BRAND.name}
            </Title>
            <Text ta="center" size="sm" style={{ color: 'rgba(255,255,255,0.92)' }}>
              {CMC_BRAND.tagline}
            </Text>
          </Stack>

          <Paper withBorder shadow="md" p="xl" radius="lg" w="100%">
          <SegmentedControl
            fullWidth
            mb="xs"
            value={mode}
            onChange={handleModeChange}
            data={[
              { value: 'parent', label: 'Phụ huynh' },
              { value: 'student', label: 'Học sinh' },
            ]}
          />
          <Text size="xs" c="dimmed" ta="center" mb="md">
            {mode === 'parent'
              ? 'Phụ huynh đăng nhập bằng email để theo dõi việc học của con.'
              : 'Học sinh dùng mã đăng nhập và mật khẩu thầy cô đã cấp.'}
          </Text>

          {/* ── Phụ huynh: OTP hai bước ── */}
          {mode === 'parent' && otpStep === 'request' && (
            <form onSubmit={onOtpRequest}>
              <Stack>
                <TextInput
                  label="Email phụ huynh"
                  type="email"
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.currentTarget.value)}
                  required
                />
                {otpError && (
                  <Text c="red" size="sm">
                    {otpError}
                  </Text>
                )}
                <Button type="submit" loading={busy} fullWidth>
                  Gửi mã đăng nhập
                </Button>
              </Stack>
            </form>
          )}

          {/* ── Phụ huynh: nhập mã OTP ── */}
          {mode === 'parent' && otpStep === 'verify' && (
            <form onSubmit={onOtpVerify}>
              <Stack>
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
                />
                {otpError && (
                  <Text c="red" size="sm">
                    {otpError}
                  </Text>
                )}
                <Button type="submit" loading={busy} fullWidth>
                  Xác nhận
                </Button>
                <Anchor
                  component="button"
                  type="button"
                  size="sm"
                  ta="center"
                  onClick={() => {
                    setOtpStep('request');
                    setOtpCode('');
                    setDevHint('');
                    setOtpError('');
                  }}
                >
                  Đổi email
                </Anchor>
              </Stack>
            </form>
          )}

          {/* ── Học sinh: mã + mật khẩu (không thay đổi) ── */}
          {mode === 'student' && (
            <form onSubmit={onStudentSubmit}>
              <Stack>
                <TextInput
                  label="Mã đăng nhập"
                  value={idField}
                  onChange={(e) => setIdField(e.currentTarget.value)}
                  required
                />
                <PasswordInput
                  label="Mật khẩu"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  required
                />
                {studentError && (
                  <Text c="red" size="sm">
                    {studentError}
                  </Text>
                )}
                <Button type="submit" loading={busy} fullWidth>
                  Đăng nhập
                </Button>
              </Stack>
            </form>
          )}
          </Paper>

          <LmsFooter />
        </Stack>
      </div>
    );
  }

  return (
    <LmsCtx.Provider value={{ principal, logout }}>
      {children}
    </LmsCtx.Provider>
  );
}
