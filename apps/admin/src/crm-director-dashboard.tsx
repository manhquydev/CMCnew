import { useEffect, useMemo, useState } from 'react';
import { trpc, useSession, notifyError, StatCard, DataTable, EmptyState, type DataTableColumn } from '@cmc/ui';
import { Card, Group, SimpleGrid, Text } from '@mantine/core';
import {
  IconChartFunnel,
  IconTargetArrow,
  IconTrendingUp,
  IconClockHour4,
  IconMedal2,
} from '@tabler/icons-react';
import { STAGES, isClosed, stageIndex } from './crm-shared';

type Opp = Awaited<ReturnType<typeof trpc.crm.opportunityList.query>>[number];
type Owner = Awaited<ReturnType<typeof trpc.crm.assignableOwners.query>>[number];

const DAY_MS = 86_400_000;

/** Whole days between two dates (never negative). */
function daysBetween(a: string | Date, b: string | Date): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS));
}

/** True when an opportunity's lifetime spans `asOf` (created before, not yet closed by then). */
function isOpenAsOf(o: Opp, asOf: Date): boolean {
  if (new Date(o.createdAt) > asOf) return false;
  if (o.closedAt && new Date(o.closedAt) <= asOf) return false;
  return true;
}

function isWon(o: Opp): boolean {
  return o.stage === 'O5_ENROLLED' && !o.lostReason && !!o.closedAt;
}

/** {value, deltaPct} vs a comparison count; deltaPct is null when the baseline is 0 (no % to show). */
function trendOf(current: number, previous: number): { deltaPct: number | null } {
  if (previous === 0) return { deltaPct: null };
  return { deltaPct: Math.round(((current - previous) / previous) * 1000) / 10 };
}

// StatCard renders its own up/down arrow from deltaDir now (2a re-skin) — this returns text only,
// otherwise the trend icon would render twice.
function TrendDelta({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct === null) return null;
  return <>{deltaPct > 0 ? '+' : ''}{deltaPct}%</>;
}
// deltaDir is derived alongside the rendered delta node — small helper keeps StatCard call-sites terse.
function deltaDirOf(deltaPct: number | null): 'up' | 'down' | 'flat' {
  if (deltaPct === null || deltaPct === 0) return 'flat';
  return deltaPct > 0 ? 'up' : 'down';
}

interface ConsultantRow {
  ownerId: string;
  name: string;
  leads: number;
  closed: number;
  won: number;
  conversionPct: number | null;
  avgCycleDays: number | null;
}

/**
 * CRM director team-metrics dashboard (Bucket-B finding #26). Aggregates crm.opportunityList +
 * crm.assignableOwners client-side — no new backend endpoint, per YAGNI (existing data is enough).
 *
 * Data-shape notes (Opportunity has no deal-value/amount field — checked packages/db/prisma/schema.prisma):
 * - "Pipeline value" is approximated by open-opportunity COUNT, not VND, since no revenue field
 *   exists on Opportunity (receipt.netAmount exists but crm.opportunityList doesn't return it, and
 *   adding a join would violate the "no new backend endpoint" constraint for this dashboard).
 * - "Avg time per stage" is approximated as overall cycle time (createdAt → closedAt for won deals),
 *   since stage transitions aren't timestamped anywhere (only current stage is stored).
 * - Leaderboard "revenue" is approximated by won-deal COUNT (a direct proxy for commission-eligible
 *   conversions), for the same reason as pipeline value above.
 */
export function CrmDirectorDashboardCard() {
  const { me } = useSession();
  const fid = me.facilityIds[0];
  const [opps, setOpps] = useState<Opp[] | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!fid) {
      setError(true);
      return;
    }
    setError(false);
    trpc.crm.opportunityList
      .query({ facilityId: fid })
      .then(setOpps)
      .catch((e) => {
        setError(true);
        notifyError(e, 'Không tải được số liệu CRM');
      });
    trpc.crm.assignableOwners.query({ facilityId: fid }).then(setOwners).catch(() => setOwners([]));
  }, [fid]);

  const loading = opps === null && !error;

  const kpis = useMemo(() => {
    if (!opps) return null;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

    const openNow = opps.filter((o) => isOpenAsOf(o, now)).length;
    const openWeekAgo = opps.filter((o) => isOpenAsOf(o, weekAgo)).length;

    const newThisWeek = opps.filter((o) => new Date(o.createdAt) > weekAgo && new Date(o.createdAt) <= now).length;
    const newLastWeek = opps.filter(
      (o) => new Date(o.createdAt) > twoWeeksAgo && new Date(o.createdAt) <= weekAgo,
    ).length;

    const closedInWindow = (from: Date, to: Date) =>
      opps.filter((o) => isClosed(o) && o.closedAt && new Date(o.closedAt) > from && new Date(o.closedAt) <= to);
    const closedThisWeek = closedInWindow(weekAgo, now);
    const closedLastWeek = closedInWindow(twoWeeksAgo, weekAgo);
    const conversionPct = (closed: Opp[]) =>
      closed.length === 0 ? null : Math.round((closed.filter(isWon).length / closed.length) * 100);
    const convThisWeek = conversionPct(closedThisWeek);
    const convLastWeek = conversionPct(closedLastWeek);

    const avgCycle = (closed: Opp[]) => {
      const won = closed.filter(isWon);
      if (won.length === 0) return null;
      return Math.round(won.reduce((sum, o) => sum + daysBetween(o.createdAt, o.closedAt!), 0) / won.length);
    };
    const cycleThisWeek = avgCycle(closedThisWeek);
    const cycleLastWeek = avgCycle(closedLastWeek);

    return {
      openNow,
      openTrend: trendOf(openNow, openWeekAgo),
      newThisWeek,
      newTrend: trendOf(newThisWeek, newLastWeek),
      convThisWeek,
      convLastWeek,
      cycleThisWeek,
      cycleLastWeek,
    };
  }, [opps]);

  const funnel = useMemo(() => {
    if (!opps) return [];
    const total = opps.length;
    return STAGES.map((s, i) => {
      const count = opps.filter((o) => stageIndex(o.stage) >= i).length;
      return { stage: s, count, pct: total === 0 ? 0 : Math.round((count / total) * 100) };
    });
  }, [opps]);

  const leaderboard = useMemo<ConsultantRow[]>(() => {
    if (!opps) return [];
    return owners
      .map((owner) => {
        const mine = opps.filter((o) => o.ownerId === owner.id);
        const closed = mine.filter(isClosed);
        const won = closed.filter(isWon);
        const avgCycleDays =
          won.length === 0
            ? null
            : Math.round(won.reduce((sum, o) => sum + daysBetween(o.createdAt, o.closedAt!), 0) / won.length);
        return {
          ownerId: owner.id,
          name: owner.displayName,
          leads: mine.length,
          closed: closed.length,
          won: won.length,
          conversionPct: closed.length === 0 ? null : Math.round((won.length / closed.length) * 100),
          avgCycleDays,
        };
      })
      .sort((a, b) => b.leads - a.leads);
  }, [opps, owners]);

  const columns: DataTableColumn<ConsultantRow>[] = [
    { key: 'name', header: 'Tư vấn viên', render: (r) => r.name },
    { key: 'leads', header: 'Số lead', width: 100, sortValue: (r) => r.leads, render: (r) => r.leads },
    {
      key: 'conversion',
      header: 'Tỷ lệ chuyển đổi',
      width: 140,
      sortValue: (r) => r.conversionPct ?? -1,
      render: (r) => (r.conversionPct === null ? '—' : `${r.conversionPct}%`),
    },
    {
      key: 'won',
      header: 'Cơ hội đã chốt',
      width: 130,
      sortValue: (r) => r.won,
      render: (r) => r.won,
    },
    {
      key: 'cycle',
      header: 'Chu kỳ TB (ngày)',
      width: 140,
      sortValue: (r) => r.avgCycleDays ?? -1,
      render: (r) => (r.avgCycleDays === null ? '—' : r.avgCycleDays),
    },
  ];

  return (
    <Card radius="lg" p="lg" withBorder style={{ borderColor: 'var(--cmc-border)' }}>
      <Group gap={8} mb="md">
        <IconChartFunnel size={18} stroke={1.5} color="var(--cmc-brand)" />
        <Text fw={600} style={{ fontSize: 'var(--cmc-text-lg)', color: 'var(--cmc-text)' }}>
          Hiệu suất CRM đội ngũ
        </Text>
      </Group>

      {error && (
        <EmptyState
          tone="danger"
          title="Không tải được số liệu CRM"
          description="Thử tải lại trang hoặc kiểm tra kết nối."
          py={32}
        />
      )}

      {!error && (
        <>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md" mb="lg">
            <StatCard
              label="Cơ hội đang mở"
              value={kpis ? kpis.openNow : '—'}
              icon={<IconTargetArrow size={18} stroke={1.5} />}
              loading={loading}
              muted={!!kpis && kpis.openNow === 0}
              delta={kpis ? <TrendDelta deltaPct={kpis.openTrend.deltaPct} /> : undefined}
              deltaDir={kpis ? deltaDirOf(kpis.openTrend.deltaPct) : 'flat'}
              deltaHint="so với tuần trước"
            />
            <StatCard
              label="Lead mới trong tuần"
              value={kpis ? kpis.newThisWeek : '—'}
              icon={<IconTrendingUp size={18} stroke={1.5} />}
              loading={loading}
              muted={!!kpis && kpis.newThisWeek === 0}
              delta={kpis ? <TrendDelta deltaPct={kpis.newTrend.deltaPct} /> : undefined}
              deltaDir={kpis ? deltaDirOf(kpis.newTrend.deltaPct) : 'flat'}
              deltaHint="so với tuần trước"
            />
            <StatCard
              label="Tỷ lệ chuyển đổi (tuần)"
              value={kpis && kpis.convThisWeek !== null ? `${kpis.convThisWeek}%` : '—'}
              icon={<IconMedal2 size={18} stroke={1.5} />}
              loading={loading}
              muted={!!kpis && kpis.convThisWeek === null}
              deltaHint={
                kpis && kpis.convLastWeek !== null
                  ? `Tuần trước ${kpis.convLastWeek}%`
                  : 'Chưa đủ dữ liệu tuần trước'
              }
            />
            <StatCard
              label="Chu kỳ trung bình (ngày)"
              value={kpis && kpis.cycleThisWeek !== null ? kpis.cycleThisWeek : '—'}
              icon={<IconClockHour4 size={18} stroke={1.5} />}
              loading={loading}
              muted={!!kpis && kpis.cycleThisWeek === null}
              deltaHint={
                kpis && kpis.cycleLastWeek !== null
                  ? `Tuần trước ${kpis.cycleLastWeek} ngày`
                  : 'Chưa đủ dữ liệu tuần trước'
              }
            />
          </SimpleGrid>

          <Text size="sm" fw={600} mb={8} style={{ color: 'var(--cmc-text-2)' }}>
            Phễu chuyển đổi (O1 → O5)
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 5 }} spacing="sm" mb="lg">
            {funnel.map((f) => (
              <Card key={f.stage.value} withBorder p="sm" radius="md">
                <Text size="xs" c="dimmed">{f.stage.label}</Text>
                <Text fw={700} style={{ fontSize: 'var(--cmc-text-2xl)', fontVariantNumeric: 'tabular-nums' }}>
                  {loading ? '—' : f.count}
                </Text>
                <Text size="xs" c="dimmed">{loading ? '' : `${f.pct}% tổng pipeline`}</Text>
              </Card>
            ))}
          </SimpleGrid>

          <Text size="sm" fw={600} mb={8} style={{ color: 'var(--cmc-text-2)' }}>
            Xếp hạng tư vấn viên
          </Text>
          <DataTable
            data={leaderboard}
            columns={columns}
            getRowKey={(r) => r.ownerId}
            loading={loading}
            pageSize={10}
            emptyState={
              <EmptyState
                icon={<IconTargetArrow size={28} stroke={1.5} />}
                title="Chưa có tư vấn viên nào"
                description="Khi cơ hội được gán cho tư vấn viên, bảng xếp hạng sẽ hiển thị tại đây."
              />
            }
          />
        </>
      )}
    </Card>
  );
}
