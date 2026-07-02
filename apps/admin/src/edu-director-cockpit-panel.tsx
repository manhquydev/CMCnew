import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, useSession, notifyError, notifySuccess, EmptyState } from '@cmc/ui';
import { Badge, Button, Card, Group, Stack, Table, Text } from '@mantine/core';
import {
  IconInbox,
  IconReceipt,
  IconGift,
  IconCalendar,
  IconClipboardCheck,
  IconTargetArrow,
  IconArrowUp,
} from '@tabler/icons-react';
import { OverviewPanel } from './overview-panel';

type ApprovalItem = Awaited<ReturnType<typeof trpc.dashboard.myApprovals.query>>[number];

const TH_STYLE: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)', fontWeight: 600,
};

// Domains the aggregate can return for a giam_doc_dao_tao caller (dashboard.ts:198-210):
// kpi + shiftRegistration(GIAO_VIEN) + manualPunch are shared with giam_doc_kinh_doanh;
// levelProgress is giam_doc_dao_tao-only. receipt/rewards never appear here (giam_doc_kinh_doanh
// only) but are kept in the label/color maps as a defensive fallback so an unexpected domain
// still renders a readable row instead of "undefined" — mirrors biz-director-cockpit-panel.tsx.
const DOMAIN_LABEL: Record<string, string> = {
  receipt: 'Phiếu thu',
  rewards: 'Đổi quà',
  shiftRegistration: 'Đăng ký ca',
  manualPunch: 'Chấm công thủ công',
  kpi: 'KPI',
  levelProgress: 'Lên cấp độ',
};

const DOMAIN_COLOR: Record<string, string> = {
  receipt: 'blue',
  rewards: 'grape',
  shiftRegistration: 'teal',
  manualPunch: 'orange',
  kpi: 'violet',
  levelProgress: 'cyan',
};

const DOMAIN_ICON: Record<string, React.ReactNode> = {
  receipt: <IconReceipt size={14} stroke={1.5} />,
  rewards: <IconGift size={14} stroke={1.5} />,
  shiftRegistration: <IconCalendar size={14} stroke={1.5} />,
  manualPunch: <IconClipboardCheck size={14} stroke={1.5} />,
  kpi: <IconTargetArrow size={14} stroke={1.5} />,
  levelProgress: <IconArrowUp size={14} stroke={1.5} />,
};

// Domains whose aggregate `id` is directly the underlying record's PK, so the mutation can be
// called inline with just {id} (or {punchId} for manualPunch). kpi is deliberately excluded:
// kpiEvalConfirm/kpiEvalApprove require {userId, periodKey} — a composite key the aggregate item
// does not carry (its `id` is kpiScore.id, see apps/api/src/routers/payroll.ts:216-259). The
// existing KPI panel already resolves that composite key via payroll.kpiList before calling
// confirm/approve (kpi-evaluation-panel.tsx:169), so the cockpit routes to that panel instead of
// guessing the composite key from the item's display title — same resolution as
// biz-director-cockpit-panel.tsx (Phase 3), for consistency.
const INLINE_APPROVE_DOMAINS = new Set(['levelProgress', 'shiftRegistration', 'manualPunch']);

function actionLabel(domain: string): string | null {
  if (domain === 'kpi') return 'Xử lý trong KPI';
  if (INLINE_APPROVE_DOMAINS.has(domain)) return 'Duyệt';
  return null;
}

/** Approval-inbox widget — lists dashboard.myApprovals items with a one-click action per domain
 *  where the aggregate item carries enough data to call the mutation directly; kpi routes to the
 *  full KPI panel instead (see INLINE_APPROVE_DOMAINS comment above). */
function ApprovalInboxCard({ onNavigateToKpi }: { onNavigateToKpi: () => void }) {
  const { me } = useSession();
  const fid = me.facilityIds[0];
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [error, setError] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!fid) {
      setError(true);
      return;
    }
    trpc.dashboard.myApprovals
      .query({ facilityId: fid })
      .then((rows) => {
        setItems(rows);
        setError(false);
      })
      .catch((e) => {
        setError(true);
        notifyError(e, 'Không tải được hộp duyệt');
      });
  }, [fid]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(item: ApprovalItem) {
    if (item.domain === 'kpi') {
      onNavigateToKpi();
      return;
    }
    if (!INLINE_APPROVE_DOMAINS.has(item.domain)) return;
    setActingId(item.id);
    try {
      switch (item.domain) {
        case 'levelProgress':
          await trpc.levelProgress.decide.mutate({ id: item.id, decision: 'approve' });
          notifySuccess('Đã duyệt lên cấp độ');
          break;
        case 'shiftRegistration':
          await trpc.shiftRegistration.approve.mutate({ id: item.id });
          notifySuccess('Đã duyệt đăng ký ca');
          break;
        case 'manualPunch':
          await trpc.checkInOut.approveManual.mutate({ punchId: item.id });
          notifySuccess('Đã duyệt chấm công thủ công');
          break;
      }
      load();
    } catch (e) {
      notifyError(e, 'Duyệt thất bại');
    } finally {
      setActingId(null);
    }
  }

  const loading = items === null && !error;

  return (
    <Card radius="lg" p="lg" withBorder style={{ borderColor: 'var(--cmc-border)' }}>
      <Group gap={8} mb="md">
        <IconInbox size={18} stroke={1.5} color="var(--cmc-brand)" />
        <Text fw={600} style={{ fontSize: 'var(--cmc-text-lg)', color: 'var(--cmc-text)' }}>
          Hộp duyệt
        </Text>
        {items && items.length > 0 && (
          <Badge color="cmcRed" variant="light" radius="xl">
            {items.length}
          </Badge>
        )}
      </Group>

      {error && !loading && (
        <EmptyState
          tone="danger"
          title="Không tải được hộp duyệt"
          description="Thử tải lại trang hoặc kiểm tra kết nối."
          py={32}
        />
      )}

      {!error && !loading && items && items.length === 0 && (
        <EmptyState
          icon={<IconInbox size={28} stroke={1.5} />}
          title="Không có việc chờ duyệt"
          description="Mọi đề xuất lên cấp độ, đăng ký ca, chấm công thủ công và KPI đang chờ đều đã được xử lý."
          py={32}
        />
      )}

      {loading && (
        <Text c="dimmed" size="sm">
          Đang tải…
        </Text>
      )}

      {!error && items && items.length > 0 && (
        <Table striped highlightOnHover withTableBorder={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={TH_STYLE}>Loại</Table.Th>
              <Table.Th style={TH_STYLE}>Nội dung</Table.Th>
              <Table.Th style={TH_STYLE}>Ngày gửi</Table.Th>
              <Table.Th style={TH_STYLE}>Thao tác</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item) => {
              const label = actionLabel(item.domain);
              return (
                <Table.Tr key={`${item.domain}-${item.id}`}>
                  <Table.Td>
                    <Badge
                      size="sm"
                      variant="light"
                      color={DOMAIN_COLOR[item.domain] ?? 'gray'}
                      leftSection={DOMAIN_ICON[item.domain]}
                    >
                      {DOMAIN_LABEL[item.domain] ?? item.domain}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{item.title}</Table.Td>
                  <Table.Td>{dayjs(item.submittedAt).format('DD/MM HH:mm')}</Table.Td>
                  <Table.Td>
                    {label && (
                      <Button
                        size="xs"
                        variant="light"
                        loading={actingId === item.id}
                        onClick={() => act(item)}
                      >
                        {label}
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}

/** Executive Cockpit for giam_doc_dao_tao-only accounts (Phase 4,
 *  plans/260701-2344-nav-restructuring-operator-executive). Replaces the standalone 'overview'
 *  nav item — composes the existing dashboard.summary widget (via OverviewPanel, unmodified,
 *  same reusable piece Phase 3 used) with a new approval-inbox widget built on
 *  dashboard.myApprovals (Phase 1). No new mutations: every action button in the inbox calls an
 *  existing router procedure directly. */
export function EduDirectorCockpitPanel({ onNavigateToKpi }: { onNavigateToKpi: () => void }) {
  return (
    <Stack>
      <OverviewPanel />
      <ApprovalInboxCard onNavigateToKpi={onNavigateToKpi} />
    </Stack>
  );
}
