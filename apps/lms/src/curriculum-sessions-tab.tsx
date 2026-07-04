import { useEffect, useState } from 'react';
import { notifyError, trpc } from '@cmc/ui';
import { Alert, Badge, Card, Center, Group, Loader, Stack, Text, Title } from '@mantine/core';

type SessionRow = Awaited<ReturnType<typeof trpc.schedule.sessionsForStudent.query>>[number];

function fmtDate(s: string | Date): string {
  return new Date(s).toLocaleDateString('vi-VN');
}

/**
 * Full session list for the student (kể cả buổi chưa có evidence), showing the curriculum
 * content mapped to each session (chủ đề / nội dung / tư duy / assessment). Complements the
 * evidence tab, which only surfaces published photos + teacher comments.
 */
export function CurriculumSessionsTab({
  studentId,
  refreshKey,
}: {
  studentId: string | null;
  refreshKey: number;
}) {
  const [items, setItems] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!studentId) return;
    setItems(null);
    setError('');
    trpc.schedule.sessionsForStudent
      .query({ studentId })
      .then(setItems)
      .catch((e) => {
        setError('Không tải được lịch học và nội dung buổi.');
        notifyError(e, 'Tải buổi học thất bại');
      });
  }, [studentId, refreshKey]);

  if (!studentId) {
    return (
      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text c="dimmed">Không có học sinh liên kết.</Text>
      </Card>
    );
  }
  if (error) return <Alert color="red">{error}</Alert>;
  if (items === null) return <Center py="xl"><Loader /></Center>;
  if (items.length === 0) {
    return (
      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text c="dimmed">Chưa có buổi học nào.</Text>
      </Card>
    );
  }

  return (
    <Stack gap="lg">
      {items.map((s) => {
        const unit = s.curriculumUnit;
        return (
          <Card key={s.id} className="cmc-clay-card" p="lg">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={5}>{unit ? unit.theme : 'Buổi học'}</Title>
                  <Text size="sm" c="dimmed">
                    {fmtDate(s.sessionDate)} · {s.startTime}-{s.endTime} · {s.batch.name}
                  </Text>
                </div>
                {unit && (
                  <Badge color={unit.unitType === 'REVIEW' ? 'grape' : 'teal'} variant="light" radius="xl">
                    {unit.unitType === 'REVIEW' ? 'Ôn tập / Thi' : 'Bài học'}
                  </Badge>
                )}
              </Group>

              {unit ? (
                <Stack gap={4}>
                  {unit.content && <Text size="sm"><b>Nội dung:</b> {unit.content}</Text>}
                  {unit.thinkingGoal && <Text size="sm"><b>Tư duy đạt được:</b> {unit.thinkingGoal}</Text>}
                  {unit.assessment && (
                    <Badge color="orange" variant="light" radius="xl" w="fit-content">
                      Đánh giá: {unit.assessment}
                    </Badge>
                  )}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">Nội dung buổi học chưa được cập nhật.</Text>
              )}
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}
