import { LoginGate, useSession, Card } from '@cmc/ui';

function Dashboard() {
  const { me } = useSession();
  return (
    <Card title="Bảng điều khiển giảng dạy / ERP">
      <p>
        Xin chào <strong>{me.displayName}</strong> ({me.primaryRole}). Đây là khung Teaching/ERP
        (Phase 0). Giáo vụ, điểm danh/chấm điểm, CRM, thu phí, lương sẽ thêm theo roadmap Phase 1–4.
      </p>
    </Card>
  );
}

export function App() {
  return (
    <LoginGate appTitle="Teaching / ERP">
      <Dashboard />
    </LoginGate>
  );
}
