import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
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
 *  - Phụ huynh: email/SĐT + mật khẩu  → lmsAuth.loginParent
 *  - Học sinh:  mã đăng nhập + mật khẩu → lmsAuth.loginStudent
 * Renders `children` once a principal is resolved; provides it via useLmsSession().
 */
export function LmsLoginGate({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | undefined>(undefined);
  const [mode, setMode] = useState<'parent' | 'student'>('parent');
  const [idField, setIdField] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    trpc.lmsAuth.me.query().then(setPrincipal).catch(() => setPrincipal(null));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'parent') {
        await trpc.lmsAuth.loginParent.mutate({ emailOrPhone: idField, password });
      } else {
        await trpc.lmsAuth.loginStudent.mutate({ loginCode: idField, password });
      }
      setPrincipal(await trpc.lmsAuth.me.query());
    } catch {
      setError('Đăng nhập thất bại — kiểm tra lại thông tin.');
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
            onChange={(v) => {
              setMode(v as 'parent' | 'student');
              setIdField('');
              setError('');
            }}
            data={[
              { value: 'parent', label: 'Phụ huynh' },
              { value: 'student', label: 'Học sinh' },
            ]}
          />
          <form onSubmit={onSubmit}>
            <Stack>
              <TextInput
                label={mode === 'parent' ? 'Email hoặc số điện thoại' : 'Mã đăng nhập'}
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
              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}
              <Button type="submit" loading={busy} fullWidth>
                Đăng nhập
              </Button>
            </Stack>
          </form>
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
