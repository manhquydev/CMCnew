import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import {
  Badge,
  Box,
  Card,
  Center,
  Grid,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconBook,
  IconClock,
  IconDoor,
  IconUsers,
} from '@tabler/icons-react';
import { FacilityPicker, notifyError, trpc, useSession } from '@cmc/ui';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type MySession = Awaited<ReturnType<typeof trpc.schedule.mySessions.query>>[number];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  planned: { label: 'Sắp diễn ra', color: 'blue' },
  open: { label: 'Đang mở', color: 'cyan' },
  running: { label: 'Đang học', color: 'green' },
  closed: { label: 'Đã xong', color: 'gray' },
  cancelled: { label: 'Đã hủy', color: 'red' },
};

interface TeacherTodayPanelProps {
  onSelectSession: (sessionId: string, batchId: string, batchCode: string) => void;
}

export function TeacherTodayPanel({ onSelectSession }: TeacherTodayPanelProps) {
  const { me } = useSession();
  const today = dayjs().format('YYYY-MM-DD');
  const todayDisplay = dayjs().locale('vi').format('dddd, DD/MM/YYYY');

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(me.facilityIds[0] ?? null);
  const [sessions, setSessions] = useState<MySession[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    trpc.facility.list
      .query()
      .then((fs) => {
        setFacilities(fs);
        setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
      })
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  }, []);

  useEffect(() => {
    if (!facilityId) return;
    setLoading(true);
    trpc.schedule.mySessions
      .query({ facilityId, from: today, to: today })
      .then(setSessions)
      .catch((e) => notifyError(e, 'Không tải được lịch dạy'))
      .finally(() => setLoading(false));
  }, [facilityId, today]);

  const activeSessions = sessions.filter((s) => s.status !== 'cancelled');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="flex-start">
        <Box>
          <Title order={2} fw={700}>
            Xin chào, {me.displayName ?? 'Giáo viên'}
          </Title>
          <Text c="dimmed" tt="capitalize">
            {todayDisplay}
          </Text>
        </Box>
        <FacilityPicker
          facilities={facilities}
          w={200}
          clearable={false}
          value={facilityId}
          onChange={setFacilityId}
        />
      </Group>

      {loading ? (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      ) : activeSessions.length === 0 ? (
        <Card withBorder p="xl" radius="md">
          <Center>
            <Stack align="center" gap="xs">
              <IconBook size={40} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed" size="lg">
                Hôm nay không có buổi dạy
              </Text>
            </Stack>
          </Center>
        </Card>
      ) : (
        <Grid gutter="md">
          {activeSessions.map((session) => {
            const cfg = STATUS_CONFIG[session.status] ?? { label: session.status, color: 'gray' };
            return (
              <Grid.Col key={session.id} span={{ base: 12, sm: 6, lg: 4 }}>
                <Card
                  withBorder
                  radius="md"
                  p="md"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelectSession(session.id, session.batch.id, session.batch.code)}
                >
                  <Stack gap="xs">
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={700} size="sm" truncate>
                        {session.batch.code}
                      </Text>
                      <Badge color={cfg.color} size="sm" variant="light">
                        {cfg.label}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {session.batch.name}
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                      <IconClock size={14} color="var(--mantine-color-dimmed)" />
                      <Text size="xs" c="dimmed">
                        {session.startTime} – {session.endTime}
                      </Text>
                    </Group>
                    {session.roomName && (
                      <Group gap="xs" wrap="nowrap">
                        <IconDoor size={14} color="var(--mantine-color-dimmed)" />
                        <Text size="xs" c="dimmed">
                          {session.roomName}
                        </Text>
                      </Group>
                    )}
                    <Group gap="xs" wrap="nowrap">
                      <IconUsers size={14} color="var(--mantine-color-dimmed)" />
                      <Text size="xs" c="dimmed">
                        {session.batch.id ? 'Xem danh sách' : '—'}
                      </Text>
                    </Group>
                  </Stack>
                </Card>
              </Grid.Col>
            );
          })}
        </Grid>
      )}
    </Stack>
  );
}
