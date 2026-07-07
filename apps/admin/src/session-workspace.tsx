import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Loader,
  Center,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft, IconUser } from '@tabler/icons-react';
import { notifyError, StatusBadge, trpc } from '@cmc/ui';
import { AttendanceRoster } from './attendance-roster.js';
import { SessionEvidencePanel } from './session-evidence-panel.js';

type SessionRow = Awaited<ReturnType<typeof trpc.schedule.listSessions.query>>[number];

interface SessionWorkspaceProps {
  classSessionId: string;
  batchId: string;
  batchCode?: string;
  onBack: () => void;
}

export function SessionWorkspace({ classSessionId, batchId, batchCode, onBack }: SessionWorkspaceProps) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    trpc.schedule.listSessions
      .query({ classBatchId: batchId })
      .then((rows) => setSession(rows.find((s) => s.id === classSessionId) ?? null))
      .catch((e) => notifyError(e, 'Không tải được thông tin buổi học'))
      .finally(() => setLoading(false));
  }, [classSessionId, batchId]);

  if (loading) {
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  }

  const sessionDate = session
    ? dayjs(session.sessionDate).format('DD/MM/YYYY')
    : '—';
  const timeRange = session ? `${session.startTime} – ${session.endTime}` : '—';

  return (
    <Stack gap={0} h="100%">
      {/* Header */}
      <Box p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap="sm">
          <ActionIcon variant="subtle" onClick={onBack} aria-label="Quay lại">
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Title order={4}>
            {batchCode ?? '—'}
          </Title>
          <Text c="dimmed" size="sm">
            {sessionDate} · {timeRange}
          </Text>
          {session && (
            <StatusBadge
              status={session.status}
              map={{
                planned: { label: 'Sắp diễn ra', tone: 'draft' },
                open: { label: 'Đang mở', tone: 'info' },
                running: { label: 'Đang học', tone: 'active' },
                closed: { label: 'Đã xong', tone: 'inactive' },
                cancelled: { label: 'Đã hủy', tone: 'rejected' },
              }}
            />
          )}
        </Group>
      </Box>

      {/* 3-column content */}
      <Grid gutter={0} style={{ flex: 1, overflow: 'hidden' }}>
        {/* LEFT — Attendance roster (35%) */}
        <Grid.Col
          span={{ base: 12, md: 4 }}
          style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflowY: 'auto', height: '100%' }}
          p="md"
        >
          <Stack gap="xs" mb="sm">
            <Group gap="xs">
              <IconUser size={16} />
              <Text fw={600} size="sm">
                Điểm danh
              </Text>
            </Group>
            <Button
              size="xs"
              variant="light"
              color="green"
              onClick={async () => {
                try {
                  await trpc.attendance.markAll.mutate({
                    classSessionId,
                    defaultStatus: 'present',
                    overrides: [],
                  });
                } catch (e) {
                  notifyError(e, 'Không điểm danh được');
                }
              }}
            >
              Điểm danh tất cả
            </Button>
          </Stack>
          <Divider mb="sm" />
          <AttendanceRoster
            classSessionId={classSessionId}
            batchId={batchId}
            facilityId={session?.facilityId ?? 0}
          />
        </Grid.Col>

        {/* CENTER — Session evidence (45%) */}
        <Grid.Col
          span={{ base: 12, md: 5 }}
          style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflowY: 'auto', height: '100%' }}
          p="md"
        >
          <Text fw={600} size="sm" mb="sm">
            Nhật ký buổi học
          </Text>
          <SessionEvidencePanel
            classSessionId={classSessionId}
            enabled={session?.status !== 'cancelled'}
          />
        </Grid.Col>

        {/* RIGHT — Session info (20%) */}
        <Grid.Col
          span={{ base: 12, md: 3 }}
          style={{ overflowY: 'auto', height: '100%' }}
          p="md"
        >
          <Card withBorder radius="md" p="sm">
            <Stack gap="xs">
              <Text fw={600} size="sm">
                Thông tin buổi học
              </Text>
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Ngày</Text>
                <Text size="xs">{sessionDate}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Giờ</Text>
                <Text size="xs">{timeRange}</Text>
              </Group>
              {session?.roomId && (
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Phòng</Text>
                  <Text size="xs">{session.roomId}</Text>
                </Group>
              )}
              {session?.curriculumUnitId && (
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Text size="xs" c="dimmed">Bài học</Text>
                  <Text size="xs" ta="right" style={{ maxWidth: '60%' }} truncate>
                    {session.curriculumUnitId.slice(0, 8)}…
                  </Text>
                </Group>
              )}
              {session?.status === 'cancelled' && (
                <Badge color="red" variant="light" size="sm">
                  Buổi học đã hủy
                </Badge>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
