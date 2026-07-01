import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card, Center, Loader, Stack, Table, Text, Group, Box } from '@mantine/core';
import { IconStar } from '@tabler/icons-react';
import { trpc } from './client.js';

type Board = Awaited<ReturnType<typeof trpc.leaderboard.forStudent.query>>[number];

function CrownSVG({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 4px 6px rgba(217, 119, 6, 0.3))' }}>
      <path d="M2 4L5 13L12 7L19 13L22 4L17 19H7L2 4Z" fill="#FBBF24" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="4" r="1.5" fill="#FBBF24" stroke="#D97706" strokeWidth="1"/>
      <circle cx="2" cy="3" r="1.5" fill="#FBBF24" stroke="#D97706" strokeWidth="1"/>
      <circle cx="22" cy="3" r="1.5" fill="#FBBF24" stroke="#D97706" strokeWidth="1"/>
    </svg>
  );
}

function Medal2SVG({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="14" r="6" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="2"/>
      <path d="M8 8L10 2H14L16 8" stroke="#F43F5E" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 12V16M10 14H14" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function Medal3SVG({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="14" r="6" fill="#FDBA74" stroke="#C2410C" strokeWidth="2"/>
      <path d="M8 8L10 2H14L16 8" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 12V16M10 14H14" stroke="#C2410C" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function Leaderboard({ studentId, refreshKey = 0 }: { studentId: string; refreshKey?: number }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setBoards(null);
    setLoadError(false);
    trpc.leaderboard.forStudent
      .query({ studentId })
      .then(setBoards)
      .catch(() => setLoadError(true));
  }, [studentId]);
  useEffect(load, [load, refreshKey]);

  if (boards === null && !loadError) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  }

  if (loadError) {
    return (
      <Alert color="red" variant="light" radius="lg">
        Không thể tải bảng xếp hạng — thử lại sau.
      </Alert>
    );
  }

  if ((boards ?? []).length === 0) {
    return (
      <Card
        radius="lg"
        p="xl"
        style={{
          background: 'var(--cmc-gradient-card)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: 'var(--cmc-radius-kid-lg)',
          boxShadow: 'var(--cmc-kid-shadow)',
        }}
      >
        <Text c="dimmed" size="sm" style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 600 }}>
          Chưa có lớp học nào được xếp hạng sao.
        </Text>
      </Card>
    );
  }

  return (
    <Stack gap="xl">
      {(boards ?? []).map((b) => {
        // Separate top 3 for the 3D Podium
        const rank1 = b.entries.find((e) => e.rank === 1);
        const rank2 = b.entries.find((e) => e.rank === 2);
        const rank3 = b.entries.find((e) => e.rank === 3);
        const listEntries = b.entries.filter((e) => e.rank > 3 || !rank1 || !rank2 || !rank3);

        return (
          <Card
            key={b.classBatchId}
            radius="lg"
            p="xl"
            style={{
              background: 'var(--cmc-gradient-card)',
              border: '2px solid rgba(255, 255, 255, 0.6)',
              borderRadius: 'var(--cmc-radius-kid-lg)',
              boxShadow: 'var(--cmc-kid-shadow)',
            }}
          >
            <Text size="lg" fw={800} mb="lg" style={{ color: '#1c3d5a', fontFamily: 'var(--cmc-font-bubble)' }}>
              🏆 Bảng Vàng: {b.className} <Text span c="dimmed" size="xs" style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 600 }}>· {b.classCode}</Text>
            </Text>

            {/* 3D Podium Layout */}
            {(rank1 || rank2 || rank3) && (
              <Group justify="center" align="flex-end" gap="sm" style={{ margin: '24px 0 32px' }}>
                {/* 2nd Place */}
                {rank2 && (
                  <Stack align="center" gap={4} style={{ width: 100 }}>
                    <Medal2SVG />
                    <Text size="xs" fw={800} style={{ color: '#475569', textAlign: 'center' }} lineClamp={1}>
                      {rank2.name}
                    </Text>
                    <Box
                      style={{
                        height: 70,
                        width: '100%',
                        background: 'linear-gradient(180deg, #cbd5e1 0%, #94a3b8 100%)',
                        borderRadius: '16px 16px 12px 12px',
                        boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.1), inset 2px 2px 6px rgba(255,255,255,0.4)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Text size="lg" fw={900} c="white">2</Text>
                      <Text size="xs" fw={700} c="white" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <IconStar size={10} fill="currentColor" /> {rank2.stars}
                      </Text>
                    </Box>
                  </Stack>
                )}

                {/* 1st Place */}
                {rank1 && (
                  <Stack align="center" gap={4} style={{ width: 110 }}>
                    <CrownSVG />
                    <Text size="sm" fw={900} style={{ color: '#b45309', textAlign: 'center' }} lineClamp={1}>
                      {rank1.name}
                    </Text>
                    <Box
                      style={{
                        height: 100,
                        width: '100%',
                        background: 'linear-gradient(180deg, #fef08a 0%, #eab308 100%)',
                        borderRadius: '20px 20px 12px 12px',
                        boxShadow: 'inset -3px -3px 8px rgba(0,0,0,0.15), inset 3px 3px 8px rgba(255,255,255,0.5), 0 8px 20px rgba(234, 179, 8, 0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        border: '3px solid #fef08a',
                      }}
                    >
                      <Text size="xl" fw={900} c="white">1</Text>
                      <Text size="sm" fw={800} c="white" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <IconStar size={12} fill="currentColor" /> {rank1.stars}
                      </Text>
                    </Box>
                  </Stack>
                )}

                {/* 3rd Place */}
                {rank3 && (
                  <Stack align="center" gap={4} style={{ width: 100 }}>
                    <Medal3SVG />
                    <Text size="xs" fw={800} style={{ color: '#c2410c', textAlign: 'center' }} lineClamp={1}>
                      {rank3.name}
                    </Text>
                    <Box
                      style={{
                        height: 50,
                        width: '100%',
                        background: 'linear-gradient(180deg, #ffedd5 0%, #ea580c 100%)',
                        borderRadius: '16px 16px 12px 12px',
                        boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.1), inset 2px 2px 6px rgba(255,255,255,0.4)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Text size="md" fw={900} c="white">3</Text>
                      <Text size="xs" fw={700} c="white" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <IconStar size={10} fill="currentColor" /> {rank3.stars}
                      </Text>
                    </Box>
                  </Stack>
                )}
              </Group>
            )}

            {/* List for the rest of the ranks */}
            <Table variant="unstyled" style={{ borderCollapse: 'separate', borderSpacing: '0 8px' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ fontSize: 12, fontWeight: 700, color: 'var(--cmc-text-muted)' }}>Thứ hạng</Table.Th>
                  <Table.Th style={{ fontSize: 12, fontWeight: 700, color: 'var(--cmc-text-muted)' }}>Tên học sinh</Table.Th>
                  <Table.Th style={{ fontSize: 12, fontWeight: 700, color: 'var(--cmc-text-muted)' }} w={100}>Sao tích lũy</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {b.entries.map((e) => {
                  const isTop3 = e.rank <= 3;
                  return (
                    <Table.Tr
                      key={e.rank}
                      style={{
                        background: e.isMe ? 'var(--cmc-brand-muted)' : 'rgba(255, 255, 255, 0.4)',
                        boxShadow: e.isMe ? 'inset 0 0 0 2px var(--cmc-brand)' : 'none',
                        borderRadius: '16px',
                        transition: 'transform 0.15s ease',
                      }}
                    >
                      <Table.Td style={{ padding: '12px', borderTopLeftRadius: '16px', borderBottomLeftRadius: '16px' }}>
                        {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : (
                          <Badge variant="light" color="gray" radius="xl" size="lg">{e.rank}</Badge>
                        )}
                      </Table.Td>
                      <Table.Td style={{ padding: '12px' }}>
                        {e.isMe ? (
                          <Text span fw={900} style={{ color: 'var(--cmc-brand-ink)' }}>
                            {e.name} <Badge size="xs" color="cmc" radius="xl" ml={4}>Bạn</Badge>
                          </Text>
                        ) : (
                          <Text span c="dimmed" fw={600}>
                            {e.name}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td style={{ padding: '12px', borderTopRightRadius: '16px', borderBottomRightRadius: '16px' }}>
                        <Group gap={4}>
                          <IconStar size={14} fill="#eab308" stroke={1.5} color="#eab308" />
                          <Text fw={800} style={{ color: '#1c3d5a', fontVariantNumeric: 'tabular-nums' }}>{e.stars}</Text>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Card>
        );
      })}
    </Stack>
  );
}
