import { useEffect, useState } from 'react';
import { API_URL, notifyError, trpc } from '@cmc/ui';
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Image,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';

type SessionEvidenceRow = Awaited<ReturnType<typeof trpc.sessionEvidence.listForPrincipal.query>>[number];

function fmtDate(s: string | Date): string {
  return new Date(s).toLocaleDateString('vi-VN');
}

function photoUrl(ref: string): string {
  return `${API_URL}/files/session-photo/${ref}`;
}

export function SessionEvidenceTab({
  studentId,
  refreshKey,
}: {
  studentId: string | null;
  refreshKey: number;
}) {
  const [items, setItems] = useState<SessionEvidenceRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!studentId) return;
    setItems(null);
    setError('');
    trpc.sessionEvidence.listForPrincipal
      .query({ studentId })
      .then(setItems)
      .catch((e) => {
        setError('Không tải được ảnh và nhận xét buổi học.');
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
        <Text c="dimmed">Chưa có ảnh hoặc nhận xét buổi học được xuất bản.</Text>
      </Card>
    );
  }

  return (
    <Stack gap="xl">
      {items.map((item) => {
        const comment = item.comments[0];
        return (
          <Card key={item.id} className="cmc-clay-card" p="xl">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={5}>{item.classSession.batch.name}</Title>
                  <Text size="sm" c="dimmed">
                    {fmtDate(item.classSession.sessionDate)} · {item.classSession.startTime}-{item.classSession.endTime}
                  </Text>
                </div>
                <Badge color="teal" variant="light" radius="xl">
                  Đã xuất bản
                </Badge>
              </Group>

              {item.summary && <Text size="sm">{item.summary}</Text>}

              {item.photos.length > 0 && (
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                  {item.photos
                    .slice()
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((photo) => (
                      <Card key={photo.id} withBorder radius="md" p="xs">
                        <Stack gap={6}>
                          {/* contain (not cover): evidence photos are often portrait — cover crops
                              a tall photo down to a thin horizontal strip inside the fixed height. */}
                          <Image
                            src={photoUrl(photo.photoRef)}
                            h={220}
                            fit="contain"
                            radius="sm"
                            style={{ backgroundColor: 'var(--mantine-color-gray-1)' }}
                          />
                        </Stack>
                      </Card>
                    ))}
                </SimpleGrid>
              )}

              {comment ? (
                <Stack gap="xs">
                  <Group gap="xs">
                    {comment.participation && (
                      <Badge variant="light" color="blue" radius="xl">Tham gia: {comment.participation}</Badge>
                    )}
                    {comment.strength && (
                      <Badge variant="light" color="teal" radius="xl">Điểm mạnh: {comment.strength}</Badge>
                    )}
                    {comment.needsImprovement && (
                      <Badge variant="light" color="yellow" radius="xl">Cần rèn: {comment.needsImprovement}</Badge>
                    )}
                  </Group>
                  {comment.teacherNote && <Text size="sm">{comment.teacherNote}</Text>}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">Buổi này chưa có nhận xét riêng cho học sinh.</Text>
              )}
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}
