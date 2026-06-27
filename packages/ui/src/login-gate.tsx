import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Button,
  Center,
  Divider,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { trpc, API_URL } from './client.js';

type Me = Awaited<ReturnType<typeof trpc.auth.me.query>>;
type Session = NonNullable<Me>;

const SessionCtx = createContext<{ me: Session; logout: () => Promise<void> } | null>(null);

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession must be used inside <LoginGate>');
  return ctx;
}

export function LoginGate({ appTitle, children }: { appTitle: string; children: ReactNode }) {
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ssoError, setSsoError] = useState('');

  useEffect(() => {
    trpc.auth.me.query().then(setMe).catch(() => setMe(null));

    // Đọc mã lỗi SSO từ query string sau khi redirect từ Microsoft
    const params = new URLSearchParams(window.location.search);
    const code = params.get('sso_error');
    if (code) {
      const messages: Record<string, string> = {
        denied: 'Bạn đã hủy đăng nhập.',
        state: 'Phiên đăng nhập hết hạn, vui lòng thử lại.',
        domain: 'Chỉ tài khoản @cmcvn.edu.vn được phép đăng nhập.',
        not_provisioned: 'Tài khoản chưa được cấp quyền trên hệ thống. Liên hệ quản trị viên.',
      };
      setSsoError(messages[code] ?? 'Đăng nhập SSO thất bại.');
      params.delete('sso_error');
      window.history.replaceState(null, '', params.size ? `?${params}` : window.location.pathname);
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await trpc.auth.login.mutate({ email, password });
      setMe(await trpc.auth.me.query());
    } catch {
      setError('Đăng nhập thất bại — kiểm tra email/mật khẩu.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await trpc.auth.logout.mutate();
    setMe(null);
  }

  if (me === undefined) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (me === null) {
    return (
      <Center h="100vh">
        <Paper withBorder shadow="sm" p="xl" w={380}>
          <Title order={3} ta="center" mb="lg" c="cmc.7">
            CMC · {appTitle}
          </Title>
          <form onSubmit={onSubmit}>
            <Stack>
              <TextInput
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
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
          <Divider label="hoặc" labelPosition="center" my="md" />
          {ssoError && (
            <Text c="red" size="sm" mb="sm">
              {ssoError}
            </Text>
          )}
          {/* Nút đăng nhập SSO qua Microsoft — dành cho tài khoản @cmcvn.edu.vn */}
          <Button
            variant="default"
            fullWidth
            onClick={() => { window.location.href = `${API_URL}/auth/sso/login`; }}
          >
            Đăng nhập bằng tài khoản CMC EDU
          </Button>
        </Paper>
      </Center>
    );
  }

  return (
    <SessionCtx.Provider value={{ me, logout }}>
      {children}
    </SessionCtx.Provider>
  );
}
