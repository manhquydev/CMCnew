import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Stack, Table, Text } from '@mantine/core';
import { trpc } from './client.js';

type Board = Awaited<ReturnType<typeof trpc.leaderboard.forStudent.query>>[number];

/** Per-class star ranking for one student. Anonymized except the student's own row (server-side
 * decision: in-class scope, names hidden for classmates). `refreshKey` re-pulls on a star earn. */
export function Leaderboard({ studentId, refreshKey = 0 }: { studentId: string; refreshKey?: number }) {
  const [boards, setBoards] = useState<Board[] | null>(null);

  const load = useCallback(() => {
    setBoards(null);
    trpc.leaderboard.forStudent
      .query({ studentId })
      .then(setBoards)
      .catch(() => setBoards([]));
  }, [studentId]);
  useEffect(load, [load, refreshKey]);

  if (boards && boards.length === 0) {
    return (
      <Card withBorder>
        <Text c="dimmed" size="sm">
          Chưa có lớp nào để xếp hạng.
        </Text>
      </Card>
    );
  }

  return (
    <Stack>
      {(boards ?? []).map((b) => (
        <Card key={b.classBatchId} withBorder>
          <Text fw={600} mb="xs">
            {b.className} <Text span c="dimmed" size="sm">· {b.classCode}</Text>
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={60}>Hạng</Table.Th>
                <Table.Th>Học sinh</Table.Th>
                <Table.Th w={90}>Sao</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {b.entries.map((e) => (
                <Table.Tr key={e.rank} bg={e.isMe ? 'var(--mantine-color-cmc-0)' : undefined}>
                  <Table.Td>
                    {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}
                  </Table.Td>
                  <Table.Td>
                    {e.isMe ? (
                      <Text span fw={700}>
                        {e.name} <Badge size="xs" color="cmc" ml={4}>Bạn</Badge>
                      </Text>
                    ) : (
                      <Text span c="dimmed">
                        {e.name}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>⭐ {e.stars}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      ))}
    </Stack>
  );
}
