import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { trpc } from './client.js';
import { Button, Card, Field } from './components.js';

type Me = Awaited<ReturnType<typeof trpc.auth.me.query>>;
type Session = NonNullable<Me>;

const SessionCtx = createContext<{ me: Session; logout: () => Promise<void> } | null>(null);

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession must be used inside <LoginGate>');
  return ctx;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      {children}
    </div>
  );
}

/** Wraps an app: shows a login form until authenticated, then renders chrome + children. */
export function LoginGate({ appTitle, children }: { appTitle: string; children: ReactNode }) {
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    trpc.auth.me.query().then(setMe).catch(() => setMe(null));
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

  if (me === undefined) return <Centered>Đang tải…</Centered>;

  if (me === null) {
    return (
      <Centered>
        <div style={{ width: 360 }}>
          <h1 style={{ textAlign: 'center', color: 'var(--cmc-brand)' }}>CMC · {appTitle}</h1>
          <Card>
            <form onSubmit={onSubmit}>
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
              <Field
                label="Mật khẩu"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              {error && <p style={{ color: 'var(--cmc-danger)', margin: '0 0 12px' }}>{error}</p>}
              <Button type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
              </Button>
            </form>
          </Card>
        </div>
      </Centered>
    );
  }

  return (
    <SessionCtx.Provider value={{ me, logout }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          background: 'var(--cmc-surface)',
          borderBottom: '1px solid var(--cmc-border)',
        }}
      >
        <strong style={{ color: 'var(--cmc-brand)' }}>CMC · {appTitle}</strong>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--cmc-text-muted)' }}>
            {me.displayName} · {me.primaryRole}
          </span>
          <Button onClick={logout} style={{ background: 'var(--cmc-text-muted)' }}>
            Đăng xuất
          </Button>
        </span>
      </header>
      <main style={{ padding: 'var(--cmc-space-4)', maxWidth: 1100, margin: '0 auto' }}>{children}</main>
    </SessionCtx.Provider>
  );
}
