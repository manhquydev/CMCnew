import { useEffect, useState } from 'react';
import { LoginGate, useSession, trpc, Card } from '@cmc/ui';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type User = Awaited<ReturnType<typeof trpc.user.list.query>>[number];

function Dashboard() {
  const { me } = useSession();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    trpc.facility.list.query().then(setFacilities).catch(() => {});
    trpc.user.list.query().then(setUsers).catch(() => {});
  }, []);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <p style={{ color: 'var(--cmc-text-muted)' }}>
        Xin chào {me.displayName}. Đây là khung Admin (Phase 0). Dữ liệu dưới đây đi qua tRPC + RLS.
      </p>
      <Card title={`Cơ sở (${facilities.length}) — lọc theo RLS`}>
        <ul>
          {facilities.map((f) => (
            <li key={f.id}>
              #{f.id} <strong>{f.code}</strong> — {f.name}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Người dùng (${users.length}) — chỉ super_admin`}>
        <ul>
          {users.map((u) => (
            <li key={u.id}>
              {u.displayName} — {u.email} [{u.roles.join(', ')}]
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function App() {
  return (
    <LoginGate appTitle="Admin">
      <Dashboard />
    </LoginGate>
  );
}
