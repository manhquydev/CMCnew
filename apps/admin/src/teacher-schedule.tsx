import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { FacilityPicker, notifyError, trpc, useSession } from '@cmc/ui';
import { Center, Loader } from '@mantine/core';
import { TeacherScheduleDetail } from './teacher-schedule-session-detail';
import { effectiveSessionStatus } from './session-status';

type MySession = Awaited<ReturnType<typeof trpc.schedule.mySessions.query>>[number];
type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type ViewMode = 'list' | 'calendar' | 'kanban';

const C = {
  brand: '#0071E3', brandMuted: '#E8F1FC',
  text: '#1D1D1F', muted: '#6E6E73',
  bg: '#F5F5F7', surface: '#FFFFFF', border: '#E5E5EA',
};
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

const SESSION_STATUS: Record<string, { label: string; color: string }> = {
  planned:   { label: 'Sắp dạy',   color: '#0071E3' },
  open:      { label: 'Đang mở',   color: '#1565C0' },
  running:   { label: 'Đang học',  color: '#137333' },
  closed:    { label: 'Đã xong',   color: '#6E6E73' },
  cancelled: { label: 'Đã hủy',    color: '#C5221F' },
};

export function TeacherSchedule() {
  const { me } = useSession();

  const [view, setView] = useState<ViewMode>('calendar');
  const [currentMonth, setCurrentMonth] = useState(() => dayjs().startOf('month'));
  const [currentWeek, setCurrentWeek] = useState(() => dayjs().startOf('week'));
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(me.facilityIds[0] ?? null);
  const [sessions, setSessions] = useState<MySession[]>([]);
  const [loading, setLoading] = useState(false);

  // URL-driven drill-down — use history.pushState to preserve path
  const readSessionId = () => new URLSearchParams(window.location.search).get('session');
  const [sessionId, setSessionId] = useState<string | null>(() => readSessionId());

  useEffect(() => {
    const handler = () => setSessionId(readSessionId());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const openSession = (s: MySession) => {
    const url = new URL(window.location.href);
    url.searchParams.set('session', String(s.id));
    history.pushState({}, '', url.toString());
    setSessionId(String(s.id));
  };

  const closeSession = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('session');
    history.pushState({}, '', url.toString());
    setSessionId(null);
  };

  const activeSession = sessions.find(s => String(s.id) === sessionId) ?? null;

  // Load facilities
  useEffect(() => {
    trpc.facility.list.query()
      .then(fs => {
        setFacilities(fs);
        setFacilityId(cur => cur ?? fs[0]?.id ?? null);
      })
      .catch(e => notifyError(e, 'Không tải được cơ sở'));
  }, []);

  // Load sessions for current view range — requires a resolved facilityId (C1: backend field is required)
  const loadSessions = useCallback(() => {
    if (facilityId === null) return;
    setLoading(true);
    let from: string, to: string;
    if (view === 'calendar') {
      from = currentMonth.format('YYYY-MM-DD');
      to = currentMonth.endOf('month').format('YYYY-MM-DD');
    } else if (view === 'list') {
      from = currentWeek.format('YYYY-MM-DD');
      to = currentWeek.endOf('week').format('YYYY-MM-DD');
    } else {
      from = dayjs().subtract(2, 'week').format('YYYY-MM-DD');
      to = dayjs().add(2, 'week').format('YYYY-MM-DD');
    }
    trpc.schedule.mySessions.query({ facilityId, from, to })
      .then(setSessions)
      .catch(e => notifyError(e, 'Không tải được lịch dạy'))
      .finally(() => setLoading(false));
  }, [facilityId, view, currentMonth, currentWeek]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // When session is in URL but sessions haven't loaded yet, show loader
  if (sessionId && !activeSession && loading) {
    return <Center py="xl" style={{ fontFamily: FONT }}><Loader size="sm" /></Center>;
  }
  // Session from URL not found in current month (H3 — cross-month refresh)
  if (sessionId && !activeSession && !loading) {
    return (
      <div style={{ padding: '40px 24px', fontFamily: FONT, textAlign: 'center', color: C.muted }}>
        <div style={{ fontSize: 14, marginBottom: 12 }}>Không tìm thấy buổi học trong tháng đang xem.</div>
        <button onClick={closeSession} style={{ padding: '8px 20px', borderRadius: 8, background: C.brand, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 600 }}>
          ← Quay về lịch
        </button>
      </div>
    );
  }
  if (activeSession) {
    return <TeacherScheduleDetail session={activeSession} onBack={closeSession} onChanged={loadSessions} />;
  }

  return (
    <div style={{ padding: '20px 24px', fontFamily: FONT, color: C.text }}>
      {/* Header toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['list', 'calendar', 'kanban'] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '6px 16px', borderRadius: 8, fontFamily: FONT,
              border: `1.5px solid ${view === v ? C.brand : C.border}`,
              background: view === v ? C.brandMuted : C.surface,
              color: view === v ? C.brand : C.text,
              fontWeight: view === v ? 600 : 400,
              cursor: 'pointer', fontSize: 13,
            }}>
              {v === 'list' ? 'Danh sách' : v === 'calendar' ? 'Tháng' : 'Kanban'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {view === 'calendar' && (
            <>
              <NavBtn onClick={() => setCurrentMonth(m => m.subtract(1, 'month'))}>‹</NavBtn>
              <span style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>
                {currentMonth.locale('vi').format('MMMM YYYY')}
              </span>
              <NavBtn onClick={() => setCurrentMonth(m => m.add(1, 'month'))}>›</NavBtn>
              <NavBtn onClick={() => setCurrentMonth(dayjs().startOf('month'))}>Hôm nay</NavBtn>
            </>
          )}
          {view === 'list' && (
            <>
              <NavBtn onClick={() => setCurrentWeek(w => w.subtract(1, 'week'))}>‹</NavBtn>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {currentWeek.format('DD/MM')} – {currentWeek.endOf('week').format('DD/MM')}
              </span>
              <NavBtn onClick={() => setCurrentWeek(w => w.add(1, 'week'))}>›</NavBtn>
              <NavBtn onClick={() => setCurrentWeek(dayjs().startOf('week'))}>Tuần này</NavBtn>
            </>
          )}
          <FacilityPicker facilities={facilities} value={facilityId} onChange={setFacilityId} clearable={false} w={180} />
        </div>
      </div>

      {loading ? (
        <Center py="xl"><Loader size="sm" /></Center>
      ) : view === 'calendar' ? (
        <MonthGrid sessions={sessions} currentMonth={currentMonth} onSelect={openSession} />
      ) : view === 'list' ? (
        <ListView sessions={sessions} onSelect={openSession} />
      ) : (
        <KanbanView sessions={sessions} onSelect={openSession} />
      )}
    </div>
  );
}

function NavBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.border}`,
      background: C.surface, cursor: 'pointer', fontSize: 13, fontFamily: FONT,
    }}>
      {children}
    </button>
  );
}

// ─── Month Grid ────────────────────────────────────────────────────────────────

function MonthGrid({ sessions, currentMonth, onSelect }: {
  sessions: MySession[];
  currentMonth: dayjs.Dayjs;
  onSelect: (s: MySession) => void;
}) {
  const today = dayjs().format('YYYY-MM-DD');
  const monthStart = currentMonth.startOf('month');
  const isoDay = monthStart.day(); // 0=Sun..6=Sat
  const offsetToMonday = isoDay === 0 ? 6 : isoDay - 1;
  const gridStart = monthStart.subtract(offsetToMonday, 'day');

  const cells: dayjs.Dayjs[] = [];
  for (let i = 0; i < 42; i++) cells.push(gridStart.add(i, 'day'));

  const byDate = new Map<string, MySession[]>();
  for (const s of sessions) {
    const d = dayjs(s.sessionDate).format('YYYY-MM-DD');
    byDate.set(d, [...(byDate.get(d) ?? []), s]);
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
        {['T2','T3','T4','T5','T6','T7','CN'].map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.muted, padding: '4px 0', letterSpacing: '0.05em' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: C.border, border: `1px solid ${C.border}` }}>
        {cells.map(day => {
          const key = day.format('YYYY-MM-DD');
          const daySessions = byDate.get(key) ?? [];
          const isToday = key === today;
          const isThisMonth = day.month() === currentMonth.month();
          const shown = daySessions.slice(0, 3);
          const more = daySessions.length - 3;
          return (
            <div key={key} style={{ minHeight: 88, padding: '4px 6px', background: isToday ? '#E8F1FC' : C.surface, opacity: isThisMonth ? 1 : 0.45 }}>
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? C.brand : C.text, marginBottom: 3 }}>
                {day.date()}
              </div>
              {shown.map(s => (
                <div key={s.id} onClick={() => onSelect(s)} style={{
                  fontSize: 11, padding: '2px 5px', borderRadius: 4, marginBottom: 2,
                  background: '#E8F1FC', color: C.brand, cursor: 'pointer',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {s.startTime} {s.batch.code}
                </div>
              ))}
              {more > 0 && <div style={{ fontSize: 10, color: C.muted, padding: '1px 5px' }}>+{more}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({ sessions, onSelect }: { sessions: MySession[]; onSelect: (s: MySession) => void }) {
  if (sessions.length === 0) {
    return <EmptyState>Không có buổi dạy nào trong tuần này</EmptyState>;
  }
  const grouped = new Map<string, MySession[]>();
  for (const s of sessions) {
    const d = dayjs(s.sessionDate).format('YYYY-MM-DD');
    grouped.set(d, [...(grouped.get(d) ?? []), s]);
  }
  const sortedDates = [...grouped.keys()].sort();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {sortedDates.map(date => (
        <div key={date}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {dayjs(date).locale('vi').format('dddd, DD/MM')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(grouped.get(date) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime)).map(s => (
              <SessionCard key={s.id} session={s} onClick={() => onSelect(s)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Kanban View ──────────────────────────────────────────────────────────────

const KANBAN_COLS = [
  { statuses: ['planned'],         label: 'Sắp dạy' },
  { statuses: ['open', 'running'], label: 'Đang diễn ra' },
  { statuses: ['closed'],          label: 'Đã xong' },
  { statuses: ['cancelled'],       label: 'Đã hủy' },
];

function KanbanView({ sessions, onSelect }: { sessions: MySession[]; onSelect: (s: MySession) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'start' }}>
      {KANBAN_COLS.map(col => {
        const cols = sessions.filter(s => col.statuses.includes(s.status));
        return (
          <div key={col.label} style={{ background: C.bg, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>{col.label} ({cols.length})</div>
            {cols.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', padding: 12 }}>—</div>
            ) : cols.sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)).map(s => (
              <SessionCard key={s.id} session={s} onClick={() => onSelect(s)} compact />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function SessionCard({ session, onClick, compact }: { session: MySession; onClick: () => void; compact?: boolean }) {
  // Trạng thái suy theo GIỜ THỰC (fix bug buổi đã qua vẫn hiện "Sắp dạy") — xem session-status.ts.
  const st = effectiveSessionStatus(session.sessionDate, session.startTime, session.endTime, session.status);
  return (
    <div onClick={onClick} style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: compact ? '8px 12px' : '12px 16px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      cursor: 'pointer',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{session.batch.code}</div>
        <div style={{ fontSize: 12, color: C.muted }}>
          {compact ? dayjs(session.sessionDate).format('DD/MM') + ' · ' : ''}
          {session.startTime}–{session.endTime}
          {session.roomName ? ` · ${session.roomName}` : ''}
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: st.color, flexShrink: 0 }}>{st.label}</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, color: C.muted, fontSize: 14 }}>
      {children}
    </div>
  );
}
