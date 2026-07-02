import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Anchor,
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
  Group,
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
      <div style={{ display: 'flex', minHeight: '100vh', width: '100vw', overflow: 'hidden' }}>
        {/* Left Column - Graphic/Branding (Hidden on mobile) */}
        <div
          style={{
            flex: '1 1 55%',
            backgroundImage: 'linear-gradient(to right, rgba(15, 23, 42, 0.9) 0%, rgba(15, 23, 42, 0.35) 100%), url(/brand/erp-login-bg.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '48px',
            position: 'relative',
          }}
          className="login-split-left"
        >
          {/* Media query to hide left side on mobile */}
          <style dangerouslySetInnerHTML={{ __html: `
            @media (max-width: 900px) {
              .login-split-left { display: none !important; }
            }
          `}} />

          {/* Logo and Brand Name */}
          <Group gap="xs">
            <img 
              src="/brand/cmc-logo.jpg" 
              alt="CMC Logo" 
              style={{ height: 38, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} 
            />
            <Text fw={800} size="xl" style={{ letterSpacing: '-0.02em', color: '#fff' }}>
              CMC <span style={{ color: 'var(--cmc-brand)' }}>ERP</span>
            </Text>
          </Group>

          {/* Central Slogan */}
          <Stack gap="xs" style={{ maxWidth: '520px' }}>
            <Text fw={900} style={{ fontSize: '48px', lineHeight: 1.1, color: '#fff', letterSpacing: '-0.03em' }}>
              THINK<br />
              <span style={{ color: 'var(--cmc-brand)' }}>CREATE</span><br />
              <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>LEAD.</span>
            </Text>
            <Text size="md" style={{ color: 'rgba(255, 255, 255, 0.75)', marginTop: '16px', lineHeight: 1.6 }}>
              Học viện phát triển Tư duy & Năng lực số CMC.<br />
              Hệ thống quản lý tích hợp ERP dành cho ban giám đốc, giảng viên và nhân sự vận hành.
            </Text>
          </Stack>

          {/* Footer Copyright */}
          <Text size="xs" style={{ color: 'rgba(255, 255, 255, 0.4)' }}>
            &copy; {new Date().getFullYear()} CMC EDU · Tò mò là khởi nguồn của trí tuệ
          </Text>
        </div>

        {/* Right Column - Navigation & Form */}
        <div
          style={{
            flex: '1 1 45%',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '32px 48px',
          }}
        >
          {/* Header Navigation Link Block */}
          <Group justify="space-between" w="100%" wrap="wrap" gap="md">
            {/* Mobile Brand Title */}
            <Group gap="xs" style={{ display: 'none' }} className="login-mobile-logo">
              <img 
                src="/brand/cmc-logo.jpg" 
                alt="CMC Logo" 
                style={{ height: 32, borderRadius: 6 }} 
              />
              <Text fw={800} size="md" style={{ color: 'var(--cmc-text)' }}>CMC ERP</Text>
            </Group>
            <style dangerouslySetInnerHTML={{ __html: `
              @media (max-width: 900px) {
                .login-mobile-logo { display: flex !important; }
              }
            `}} />
            <Group gap="lg">
              <Anchor href="https://cmcvn.edu.vn/" target="_blank" size="xs" fw={600} c="dimmed">
                Trang chủ CMC
              </Anchor>
              <Anchor href="https://hoc.cmcvn.edu.vn/login" target="_blank" size="xs" fw={600} c="cmc.7">
                Cổng học tập LMS
              </Anchor>
            </Group>
          </Group>

          {/* Form Container */}
          <Paper
            p="xl"
            w="100%"
            maw={400}
            style={{
              background: 'transparent',
              border: 'none',
              boxShadow: 'none',
            }}
          >
            <Stack mb="xl" gap="xs">
              <Title order={2} style={{ color: 'var(--cmc-text)', fontWeight: 800, letterSpacing: '-0.02em' }}>
                {appTitle} Portal
              </Title>
              <Text size="sm" c="dimmed">
                Đăng nhập để truy cập hệ thống quản lý & vận hành.
              </Text>
            </Stack>

            <form onSubmit={onSubmit}>
              <Stack gap="md">
                <TextInput
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  required
                  autoComplete="username"
                  styles={{
                    input: { height: '44px' },
                  }}
                />
                <PasswordInput
                  label="Mật khẩu"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  required
                  autoComplete="current-password"
                  styles={{
                    input: { height: '44px' },
                  }}
                />
                {error && (
                  <Text c="red" size="sm" fw={500}>
                    {error}
                  </Text>
                )}
                <Button
                  type="submit"
                  loading={busy}
                  fullWidth
                  style={{
                    height: '44px',
                    fontWeight: 600,
                  }}
                >
                  Đăng nhập
                </Button>
              </Stack>
            </form>

            <Stack gap="sm" mt="md">
              <Divider label="hoặc" labelPosition="center" />
              {ssoError && (
                <Text c="red" size="sm" mb="xs" fw={500}>
                  {ssoError}
                </Text>
              )}
              <Button
                variant="default"
                fullWidth
                onClick={() => {
                  window.location.href = `${API_URL}/auth/sso/login`;
                }}
                style={{
                  height: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {/* Microsoft Icon */}
                <svg width="16" height="16" viewBox="0 0 23 23" fill="none" style={{ marginRight: '6px', marginTop: '-2px' }}>
                  <path d="M0 0H11V11H0V0Z" fill="#F25022"/>
                  <path d="M12 0H23V11H12V0Z" fill="#7FBA00"/>
                  <path d="M0 12H11V23H0V12Z" fill="#00A4EF"/>
                  <path d="M12 12H23V23H12V12Z" fill="#FFB900"/>
                </svg>
                Đăng nhập bằng tài khoản Microsoft
              </Button>
            </Stack>
          </Paper>

          {/* Footer Guide / Redirect Block */}
          <Stack align="center" gap={4} w="100%">
            <Text size="xs" c="dimmed" ta="center">
              Bạn vào nhầm? Hệ thống chỉ dành cho cán bộ công ty.
            </Text>
            <Group gap="xs" justify="center">
              <Anchor href="https://cmcvn.edu.vn/" target="_blank" size="xs" fw={500} c="cmc.7">
                Trang chủ CMC
              </Anchor>
              <Text size="xs" c="dimmed">·</Text>
              <Anchor href="https://hoc.cmcvn.edu.vn/login" target="_blank" size="xs" fw={500} c="cmc.7">
                Cổng học tập LMS
              </Anchor>
            </Group>
          </Stack>
        </div>
      </div>
    );
  }

  return (
    <SessionCtx.Provider value={{ me, logout }}>
      {children}
    </SessionCtx.Provider>
  );
}
