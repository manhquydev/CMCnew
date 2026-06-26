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
      <Center h="100vh">
        <Paper withBorder shadow="sm" p="xl" w={400}>
          <Title order={3} ta="center" mb="lg" c="cmc.7">
            CMC · Học tập
          </Title>
          <SegmentedControl
            fullWidth
            mb="md"
            value={mode}
            onChange={handleModeChange}
            data={[
              { value: 'parent', label: 'Phụ huynh' },
              { value: 'student', label: 'Học sinh' },
            ]}
          />

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
      </Center>
    );
  }

  return (
    <LmsCtx.Provider value={{ principal, logout }}>
      {children}
    </LmsCtx.Provider>
  );
}
