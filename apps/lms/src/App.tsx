import { LoginGate, useSession } from '@cmc/ui';
import { Card, Text, Title } from '@mantine/core';

function Dashboard() {
  const { me } = useSession();
  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        Bảng điều khiển học sinh / phụ huynh
      </Title>
      <Text>
        Xin chào <b>{me.displayName}</b>. Đây là khung LMS. Trải nghiệm học sinh (bài tập, điểm,
        điểm danh, sao thưởng…) sẽ được thêm ở Phase 2.
      </Text>
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
