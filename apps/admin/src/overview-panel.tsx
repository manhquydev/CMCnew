import { useEffect, useState } from 'react';
import {
  trpc,
  notifyError,
  PageHeader,
  StatCard,
  EmptyState,
} from '@cmc/ui';
import { Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import {
  IconCash,
  IconReceipt,
  IconSchool,
  IconBuildingStore,
  IconTargetArrow,
  IconTrophy,
  IconTrendingUp,
} from '@tabler/icons-react';

type Summary = Awaited<ReturnType<typeof trpc.dashboard.summary.query>>;

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

const STAGE_LABEL: Record<string, string> = {
  O1_LEAD: 'O1 Lead',
  O2_CONTACTED: 'O2 Liên hệ',
  O3_TEST_SCHEDULED: 'O3 Đặt test',
  O4_TESTED: 'O4 Đã test',
  O5_ENROLLED: 'O5 Nhập học',
};

const ICON = { size: 18, stroke: 1.5 };

export function OverviewPanel() {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    trpc.dashboard.summary
      .query()
      .then(setS)
      .catch((e) => {
        setError(true);
        notifyError(e, 'Không tải được tổng quan');
      });
  }, []);

  const loading = !s && !error;
  const today = new Date().toLocaleString('vi-VN', { dateStyle: 'long', timeStyle: 'short' });

  return (
    <Stack>
      <PageHeader title="Tổng quan" subtitle={`Cập nhật ${today}`} />

      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="md">
        <StatCard
          label="Doanh thu đã duyệt"
          value={s ? vnd(s.revenueTotal) : '—'}
          icon={<IconCash {...ICON} />}
          muted={!!s && s.revenueTotal === 0}
          loading={loading}
        />
        <StatCard
          label="Học sinh đang học"
          value={s ? String(s.studentsActive) : '—'}
          icon={<IconSchool {...ICON} />}
          muted={!!s && s.studentsActive === 0}
          loading={loading}
        />
        <StatCard
          label="Lớp đang mở"
          value={s ? String(s.classesOpen) : '—'}
          icon={<IconBuildingStore {...ICON} />}
          muted={!!s && s.classesOpen === 0}
          loading={loading}
        />
        <StatCard
          label="Số phiếu thu"
          value={s ? String(s.receiptsCount) : '—'}
          icon={<IconReceipt {...ICON} />}
          muted={!!s && s.receiptsCount === 0}
          loading={loading}
        />
        <StatCard
          label="Cơ hội đang mở"
          value={s ? String(s.opportunitiesOpen) : '—'}
          icon={<IconTargetArrow {...ICON} />}
          muted={!!s && s.opportunitiesOpen === 0}
          loading={loading}
        />
        <StatCard
          label="Cơ hội chốt (nhập học)"
          value={s ? String(s.opportunitiesWon) : '—'}
          icon={<IconTrophy {...ICON} />}
          muted={!!s && s.opportunitiesWon === 0}
          loading={loading}
        />
      </SimpleGrid>

      <Card radius="lg" p="lg" withBorder style={{ borderColor: 'var(--cmc-border)' }}>
        <Group gap={8} mb="md">
          <IconTrendingUp size={18} stroke={1.5} color="var(--cmc-brand)" />
          <Text fw={600} style={{ fontSize: 'var(--cmc-text-lg)', color: 'var(--cmc-text)' }}>
            Pipeline đang mở
          </Text>
        </Group>

        {s && s.pipeline.length === 0 ? (
          <EmptyState
            icon={<IconTargetArrow size={28} stroke={1.5} />}
            title="Chưa có cơ hội đang mở"
            description="Khi đội Sale tạo cơ hội mới, các bước pipeline sẽ hiển thị tại đây."
            py={32}
          />
        ) : (
          <Stack gap={10}>
            {(s?.pipeline ?? []).map((p) => {
              const max = Math.max(1, ...(s?.pipeline ?? []).map((x) => x.count));
              const pct = Math.round((p.count / max) * 100);
              return (
                <Group key={p.stage} justify="space-between" wrap="nowrap" gap="md">
                  <Text size="sm" w={120} style={{ color: 'var(--cmc-text-2)', flexShrink: 0 }}>
                    {STAGE_LABEL[p.stage] ?? p.stage}
                  </Text>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 'var(--cmc-radius-pill)',
                      backgroundColor: 'var(--cmc-surface-2)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        backgroundColor: 'var(--cmc-brand)',
                        borderRadius: 'var(--cmc-radius-pill)',
                      }}
                    />
                  </div>
                  <Text
                    fw={600}
                    size="sm"
                    w={36}
                    ta="right"
                    style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                  >
                    {p.count}
                  </Text>
                </Group>
              );
            })}
            {loading && (
              <Text c="dimmed" size="sm">
                Đang tải…
              </Text>
            )}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
