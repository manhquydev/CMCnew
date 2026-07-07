import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { Center, Loader, Stack } from '@mantine/core';
import { FacilityPicker, notifyError, trpc, useSession } from '@cmc/ui';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type MySession = Awaited<ReturnType<typeof trpc.schedule.mySessions.query>>[number];

const C = {
  brand: '#0071E3',
  brandMuted: '#E8F1FC',
  text: '#1D1D1F',
  muted: '#6E6E73',
  bg: '#F5F5F7',
  surface: '#FFFFFF',
  border: '#E5E5EA',
  successBg: '#E6F4EA',
  success: '#137333',
  amberBg: '#FEF3E0',
  amber: '#8A5A00',
};

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

const STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  planned: { label: 'Sắp dạy', bg: C.brandMuted, color: C.brand },
  open: { label: 'Đang mở', bg: '#E3F2FD', color: '#1565C0' },
  running: { label: 'Đang học', bg: C.successBg, color: C.success },
  closed: { label: 'Đã xong', bg: C.bg, color: C.muted },
  cancelled: { label: 'Đã hủy', bg: '#FCE8E6', color: '#C5221F' },
};

interface TeacherTodayPanelProps {
  onSelectSession: (sessionId: string, batchId: string, batchCode: string) => void;
  onNavigateToGrading?: () => void;
  onNavigateToSchedule?: () => void;
}

export function TeacherTodayPanel({
  onSelectSession,
  onNavigateToGrading,
  onNavigateToSchedule,
}: TeacherTodayPanelProps) {
  const { me } = useSession();
  const today = dayjs().format('YYYY-MM-DD');
  const todayDisplay = dayjs().locale('vi').format('dddd, DD/MM/YYYY');

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(me.facilityIds[0] ?? null);
  const [sessions, setSessions] = useState<MySession[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    trpc.facility.list
      .query()
      .then((fs) => {
        setFacilities(fs);
        setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
      })
      .catch((e) => notifyError(e, 'Không tải được cơ sở'));
  }, []);

  useEffect(() => {
    if (!facilityId) return;
    setLoading(true);
    trpc.schedule.mySessions
      .query({ facilityId, from: today, to: today })
      .then(setSessions)
      .catch((e) => notifyError(e, 'Không tải được lịch dạy'))
      .finally(() => setLoading(false));
  }, [facilityId, today]);

  const activeSessions = sessions.filter((s) => s.status !== 'cancelled');
  const nearestSession = activeSessions[0];

  return (
    <div
      style={{
        padding: '26px 30px',
        maxWidth: 1320,
        fontFamily: FONT,
        color: C.text,
      }}
    >
      {/* Greeting header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 28,
        }}
      >
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
            Xin chào, {me.displayName ?? 'Giáo viên'}
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 3, textTransform: 'capitalize' }}>
            {todayDisplay}
          </div>
        </div>
        <FacilityPicker
          facilities={facilities}
          w={200}
          clearable={false}
          value={facilityId}
          onChange={setFacilityId}
        />
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 28,
        }}
      >
        <StatCard
          title="Buổi dạy hôm nay"
          value={loading ? '—' : String(activeSessions.length)}
          sub={
            nearestSession
              ? `gần nhất ${nearestSession.startTime}`
              : 'không có buổi nào'
          }
          accent={C.brand}
          onClick={onNavigateToSchedule}
        />
        <StatCard
          title="Học sinh điểm danh"
          value={loading ? '—' : activeSessions.length > 0 ? '...' : '0'}
          sub={`${activeSessions.length} lớp hôm nay`}
          onClick={
            nearestSession
              ? () =>
                  onSelectSession(
                    nearestSession.id,
                    nearestSession.batch.id,
                    nearestSession.batch.code,
                  )
              : undefined
          }
        />
        <StatCard
          title="Bài chờ chấm"
          value="..."
          sub="+ sao khi chấm"
          accent={C.amber}
          onClick={onNavigateToGrading}
        />
        <StatCard
          title="Nhận xét chờ chốt"
          value="..."
          sub="xem danh sách"
          accent={C.muted}
        />
      </div>

      {/* Two-column: tasks + timeline */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 280px',
          gap: 20,
          alignItems: 'start',
        }}
      >
        {/* Main: today's class list */}
        <div>
          <SectionLabel>Lớp của bạn hôm nay</SectionLabel>
          {loading ? (
            <Center py="xl">
              <Loader size="sm" />
            </Center>
          ) : activeSessions.length === 0 ? (
            <EmptyState>Hôm nay không có buổi dạy nào</EmptyState>
          ) : (
            <Stack gap={8}>
              {activeSessions.map((session) => {
                const s =
                  STATUS_LABEL[session.status] ?? {
                    label: session.status,
                    bg: C.bg,
                    color: C.muted,
                  };
                return (
                  <TaskRow
                    key={session.id}
                    title={session.batch.code}
                    meta={[
                      `${session.startTime} – ${session.endTime}`,
                      session.roomName,
                      session.batch.name,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    badge={s.label}
                    badgeBg={s.bg}
                    badgeColor={s.color}
                    onClick={() =>
                      onSelectSession(session.id, session.batch.id, session.batch.code)
                    }
                  />
                );
              })}
            </Stack>
          )}
        </div>

        {/* Side: timeline */}
        <div>
          <SectionLabel>Lịch dạy hôm nay</SectionLabel>
          <div
            style={{
              background: C.surface,
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              overflow: 'hidden',
            }}
          >
            {loading ? (
              <Center py="xl">
                <Loader size="xs" />
              </Center>
            ) : activeSessions.length === 0 ? (
              <div
                style={{ padding: 16, textAlign: 'center', color: C.muted, fontSize: 13 }}
              >
                Trống
              </div>
            ) : (
              activeSessions.map((session, i) => {
                const barColor =
                  i === 0 ? C.brand : i === 1 ? '#7FB0E8' : '#C7D8EE';
                return (
                  <div
                    key={session.id}
                    onClick={() =>
                      onSelectSession(session.id, session.batch.id, session.batch.code)
                    }
                    style={{
                      padding: '12px 16px',
                      borderBottom:
                        i < activeSessions.length - 1
                          ? `1px solid ${C.border}`
                          : 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                    }}
                  >
                    <div
                      style={{
                        width: 4,
                        height: 36,
                        borderRadius: 2,
                        background: barColor,
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div
                        style={{ fontSize: 13, fontWeight: 600, color: C.text }}
                      >
                        {session.startTime} · {session.batch.code}
                      </div>
                      <div
                        style={{ fontSize: 12, color: C.muted, marginTop: 2 }}
                      >
                        {session.roomName ?? '—'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  accent,
  onClick,
}: {
  title: string;
  value: string;
  sub: string;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={(e) => {
        if (onClick) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: C.muted,
          fontWeight: 600,
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: accent ?? C.text,
          letterSpacing: -0.9,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function TaskRow({
  title,
  meta,
  badge,
  badgeBg,
  badgeColor,
  onClick,
}: {
  title: string;
  meta: string;
  badge: string;
  badgeBg: string;
  badgeColor: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '14px 18px',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 3 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>{meta}</div>
      </div>
      <div
        style={{
          padding: '4px 10px',
          borderRadius: 6,
          background: badgeBg,
          color: badgeColor,
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {badge}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: C.muted,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '32px 20px',
        textAlign: 'center',
        background: C.surface,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
        color: C.muted,
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}
