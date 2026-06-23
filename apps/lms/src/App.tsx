import { LoginGate, useSession, Card } from '@cmc/ui';

function Dashboard() {
  const { me } = useSession();
  return (
    <Card title="Bảng điều khiển học sinh / phụ huynh">
      <p>
        Xin chào <strong>{me.displayName}</strong>. Đây là khung LMS (Phase 0). Các module học tập
        (bài tập, điểm, điểm danh, sao thưởng…) sẽ được thêm theo roadmap Phase 1–2.
      </p>
    </Card>
  );
}

export function App() {
  return (
    <LoginGate appTitle="LMS">
      <Dashboard />
    </LoginGate>
  );
}
