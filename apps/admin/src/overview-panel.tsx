import { useEffect, useState } from 'react';
import { trpc, notifyError } from '@cmc/ui';
import { Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconTrendingUp } from '@tabler/icons-react';

type Summary = Awaited<ReturnType<typeof trpc.dashboard.summary.query>>;

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

const STAGE_LABEL: Record<string, string> = {
  O1_LEAD: 'O1 Lead',
  O2_CONTACTED: 'O2 Liên hệ',
  O3_TEST_SCHEDULED: 'O3 Đặt test',
  O4_TESTED: 'O4 Đã test',
  O5_ENROLLED: 'O5 Nhập học',
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Text
        size="xs"
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--cmc-text-muted)',
          fontWeight: 600,
        }}
        mb={4}
      >
        {label}
      </Text>
      <Text
        fw={700}
        style={{
          fontSize: 28,
          color: 'var(--cmc-text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
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

  if (!s) {
    return (
      <Text c="dimmed" size="sm">
        Đang tải…
      </Text>
    );
  }

  return (
    <Stack>
      <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }} mb="xs">
        Tổng quan
      </Text>

      <SimpleGrid cols={{ base: 2, sm: 3 }}>
        <StatCard label="Doanh thu đã duyệt" value={vnd(s.revenueTotal)} />
        <StatCard label="Số phiếu thu" value={String(s.receiptsCount)} />
        <StatCard label="Học sinh đang học" value={String(s.studentsActive)} />
        <StatCard label="Lớp đang mở" value={String(s.classesOpen)} />
        <StatCard label="Cơ hội đang mở" value={String(s.opportunitiesOpen)} />
        <StatCard label="Cơ hội chốt (nhập học)" value={String(s.opportunitiesWon)} />
      </SimpleGrid>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Group gap="xs" mb="md">
          <IconTrendingUp size={18} stroke={1.5} color="var(--cmc-brand)" />
          <Text fw={600} style={{ color: 'var(--cmc-text)' }}>
            Pipeline đang mở
          </Text>
        </Group>
        {s.pipeline.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có cơ hội đang mở.
          </Text>
        ) : (
          <Stack gap={8}>
            {s.pipeline.map((p) => (
              <Group key={p.stage} justify="space-between">
                <Text size="sm" style={{ color: 'var(--cmc-text-2)' }}>
                  {STAGE_LABEL[p.stage] ?? p.stage}
                </Text>
                <Text fw={600} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {p.count}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
