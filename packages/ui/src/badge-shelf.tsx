import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { trpc } from './client.js';

type EarnedBadge = Awaited<ReturnType<typeof trpc.badge.myBadges.query>>[number];

const SOURCE_LABEL: Record<string, string> = { auto: 'Tự đạt', manual: 'GV trao' };

/** Read-only shelf of badges a student has earned. Used in both the student and parent views;
 * `refreshKey` bumps it on a realtime badge_awarded notification. */
export function BadgeShelf({ studentId, refreshKey = 0 }: { studentId: string; refreshKey?: number }) {
  const [badges, setBadges] = useState<EarnedBadge[] | null>(null);

  const load = useCallback(() => {
    setBadges(null);
    trpc.badge.myBadges
      .query({ studentId })
      .then(setBadges)
      .catch(() => setBadges([]));
  }, [studentId]);
  useEffect(load, [load, refreshKey]);

  if (badges && badges.length === 0) {
    return (
      <Card withBorder>
        <Text c="dimmed" size="sm">
          Chưa đạt huy hiệu nào. Hoàn thành bài tập và tích sao để mở khóa!
        </Text>
      </Card>
    );
  }

  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }}>
      {(badges ?? []).map((b) => (
        <Card key={b.id} withBorder padding="sm">
          <Stack gap={4} align="center" ta="center">
            {b.badge.iconUrl ? (
              <img src={b.badge.iconUrl} alt={b.badge.name} width={32} height={32} />
            ) : (
              <Text fz={32}>🏅</Text>
            )}
            <Text fw={600} size="sm">
              {b.badge.name}
            </Text>
            {b.badge.description && (
              <Text size="xs" c="dimmed" lineClamp={2}>
                {b.badge.description}
              </Text>
            )}
            <Group gap={4}>
              <Badge size="xs" variant="light" color={b.source === 'manual' ? 'grape' : 'teal'}>
                {SOURCE_LABEL[b.source] ?? b.source}
              </Badge>
            </Group>
          </Stack>
        </Card>
      ))}
    </SimpleGrid>
  );
}
