import { useEffect, useState } from 'react';
import { trpc, notifyError } from '@cmc/ui';
import { Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';

type Summary = Awaited<ReturnType<typeof trpc.dashboard.summary.query>>;

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
const STAGE_LABEL: Record<string, string> = {
  O1_LEAD: 'O1 Lead',
  O2_CONTACTED: 'O2 Liên hệ',
  O3_TEST_SCHEDULED: 'O3 Đặt test',
  O4_TESTED: 'O4 Đã test',
  O5_ENROLLED: 'O5 Nhập học',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text fw={700} fz={24} mt={4}>
        {value}
      </Text>
    </Card>
  );
}

export function OverviewPanel() {
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    trpc.dashboard.summary
      .query()
      .then(setS)
      .catch((e) => notifyError(e, 'Không tải được tổng quan'));
  }, []);

  if (!s) return <Text c="dimmed">Đang tải…</Text>;

  return (
    <Stack>
      <Title order={5}>Tổng quan (theo cơ sở bạn quản lý)</Title>
      <SimpleGrid cols={{ base: 2, sm: 3 }}>
        <Stat label="Doanh thu đã duyệt" value={vnd(s.revenueTotal)} />
        <Stat label="Số phiếu thu" value={String(s.receiptsCount)} />
        <Stat label="Học sinh đang học" value={String(s.studentsActive)} />
        <Stat label="Lớp đang mở" value={String(s.classesOpen)} />
        <Stat label="Cơ hội đang mở" value={String(s.opportunitiesOpen)} />
        <Stat label="Cơ hội chốt (nhập học)" value={String(s.opportunitiesWon)} />
      </SimpleGrid>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Pipeline đang mở
        </Text>
        {s.pipeline.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có cơ hội đang mở.
          </Text>
        ) : (
          <Stack gap={6}>
            {s.pipeline.map((p) => (
              <Group key={p.stage} justify="space-between">
                <Text size="sm">{STAGE_LABEL[p.stage] ?? p.stage}</Text>
                <Text fw={600}>{p.count}</Text>
              </Group>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
