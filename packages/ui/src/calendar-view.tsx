// CalendarView — hand-built week/month calendar primitive. No week/month/day view
// exists in @mantine/dates (7.17.8 resolved, confirmed no scheduler component), so this
// composes dayjs date math + Mantine layout primitives directly (see plans/260703-1549-
// p3-calendar-view-primitive). Locale is self-contained (packages/ui does not borrow
// apps/admin's dayjs.locale('vi') side effect — see phase-01 red-team correction #2).
//
// Scope notes (red-team corrections applied):
// - `end` is REQUIRED caller-synthesized input on CalendarEvent — entities with no native
//   duration field (testAppointment, parentMeeting) must synthesize a default end before
//   passing events in. This primitive does not infer durations.
// - `attendance` is explicitly OUT of scope as a direct passthrough — one ClassSession has
//   many Attendance rows; that's a session-level aggregation concern for the consumer (P6),
//   not solved generically here.
// - Overlap layout uses a fixed even-split column-width algorithm keyed by concurrent-
//   overlap-count, not measured/dynamic width (no ResizeObserver) — keeps placeEventsInDay
//   pure and unit-testable.

import { useMemo } from 'react';
import { ActionIcon, Box, Button, Group, SegmentedControl, Text } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/vi';

dayjs.locale('vi');

export type CalendarViewMode = 'week' | 'month';

export interface CalendarEvent {
  id: string;
  title: string;
  /** Required — callers with no native duration field must synthesize this. */
  start: Date;
  /** Required — see module doc: this primitive never infers a duration. */
  end: Date;
  status?: string;
  color?: string;
}

export interface PlacedEvent {
  event: CalendarEvent;
  /** Top offset as a 0..1 fraction of the rendered hour window. */
  top: number;
  /** Height as a 0..1 fraction of the rendered hour window (clipped to the window). */
  height: number;
  /** 0-based column index within the concurrent-overlap group (even-split algorithm). */
  columnIndex: number;
  /** Total concurrent-overlap columns at this event's position. */
  columnCount: number;
}

export interface HourWindow {
  startHour: number;
  endHour: number;
}

const DEFAULT_HOUR_WINDOW: HourWindow = { startHour: 7, endHour: 21 };

/* ─── Pure date-math helpers ────────────────────────────────────────────── */

/**
 * Returns the [start, end] of the week containing `date`, both at midnight.
 * `weekStartDay` follows dayjs's `day()` convention (0=Sun..6=Sat); default 1 = Monday (VN convention).
 */
export function getWeekRange(date: Date, weekStartDay = 1): [Date, Date] {
  const d = dayjs(date);
  const currentDay = d.day(); // 0..6, Sun..Sat
  const diff = (currentDay - weekStartDay + 7) % 7;
  const start = d.subtract(diff, 'day').startOf('day');
  const end = start.add(6, 'day').endOf('day');
  return [start.toDate(), end.toDate()];
}

/**
 * Returns a 6x7 grid of Dates covering the month containing `date`, including
 * leading/trailing days from adjacent months so every week row is complete.
 * Week starts Monday (VN convention, matches getWeekRange's default).
 */
export function getMonthGridCells(date: Date, weekStartDay = 1): Date[][] {
  const monthStart = dayjs(date).startOf('month');
  const firstDayOfWeek = monthStart.day(); // 0..6
  const leadingDays = (firstDayOfWeek - weekStartDay + 7) % 7;
  const gridStart = monthStart.subtract(leadingDays, 'day');

  const grid: Date[][] = [];
  let cursor = gridStart;
  for (let week = 0; week < 6; week++) {
    const row: Date[] = [];
    for (let day = 0; day < 7; day++) {
      row.push(cursor.toDate());
      cursor = cursor.add(1, 'day');
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Positions events within a single day's hour window. Pure function: no DOM
 * measurement, no component state. Overlapping events split their column
 * width evenly among the concurrent-overlap group (fixed algorithm, not
 * measured) — see module doc red-team correction #4.
 */
export function placeEventsInDay(
  events: CalendarEvent[],
  dayStart: Date,
  dayEnd: Date,
  hourWindow: HourWindow = DEFAULT_HOUR_WINDOW,
): PlacedEvent[] {
  const dStart = dayjs(dayStart);
  const dEnd = dayjs(dayEnd);
  const windowStart = dStart.hour(hourWindow.startHour).minute(0).second(0);
  const windowEnd = dStart.hour(hourWindow.endHour).minute(0).second(0);
  const windowMinutes = windowEnd.diff(windowStart, 'minute');
  if (windowMinutes <= 0) return [];

  // Keep only events that intersect this day + hour window.
  const dayEvents = events
    .filter((e) => {
      const s = dayjs(e.start);
      const en = dayjs(e.end);
      return en.isAfter(dStart) && s.isBefore(dEnd) && en.isAfter(windowStart) && s.isBefore(windowEnd);
    })
    .map((e) => {
      const s = dayjs(e.start);
      const en = dayjs(e.end);
      const clippedStart = s.isBefore(windowStart) ? windowStart : s;
      const clippedEnd = en.isAfter(windowEnd) ? windowEnd : en;
      return { event: e, clippedStart, clippedEnd };
    })
    .sort((a, b) => a.clippedStart.valueOf() - b.clippedStart.valueOf());

  // Group events into overlap clusters (connected-interval components), then
  // even-split columns within each cluster by concurrent-overlap peak count.
  const placed: PlacedEvent[] = [];
  let clusterStartIdx = 0;
  let clusterEnd = -1;

  const flushCluster = (from: number, to: number) => {
    const cluster = dayEvents.slice(from, to + 1);
    // Assign each event the first free column (greedy interval graph coloring).
    const columnEnds: Dayjs[] = [];
    const columnOf: number[] = [];
    for (const item of cluster) {
      let col = columnEnds.findIndex((endTime) => !endTime.isAfter(item.clippedStart));
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(item.clippedEnd);
      } else {
        columnEnds[col] = item.clippedEnd;
      }
      columnOf.push(col);
    }
    const columnCount = columnEnds.length;
    cluster.forEach((item, i) => {
      const top = item.clippedStart.diff(windowStart, 'minute') / windowMinutes;
      const height = item.clippedEnd.diff(item.clippedStart, 'minute') / windowMinutes;
      placed.push({
        event: item.event,
        top,
        height,
        columnIndex: columnOf[i]!,
        columnCount,
      });
    });
  };

  for (let i = 0; i < dayEvents.length; i++) {
    const item = dayEvents[i]!;
    if (clusterEnd === -1) {
      clusterStartIdx = i;
      clusterEnd = item.clippedEnd.valueOf();
      continue;
    }
    if (item.clippedStart.valueOf() < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, item.clippedEnd.valueOf());
      continue;
    }
    flushCluster(clusterStartIdx, i - 1);
    clusterStartIdx = i;
    clusterEnd = item.clippedEnd.valueOf();
  }
  if (clusterEnd !== -1) flushCluster(clusterStartIdx, dayEvents.length - 1);

  return placed;
}

/* ─── Component ─────────────────────────────────────────────────────────── */

const WEEKDAY_LABELS_MON_FIRST = ['Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7', 'CN'];

export interface CalendarViewProps {
  events: CalendarEvent[];
  view: CalendarViewMode;
  onViewChange: (view: CalendarViewMode) => void;
  date: Date;
  onDateChange: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  hourWindow?: HourWindow;
}

export function CalendarView({
  events,
  view,
  onViewChange,
  date,
  onDateChange,
  onEventClick,
  hourWindow = DEFAULT_HOUR_WINDOW,
}: CalendarViewProps) {
  const goToday = () => onDateChange(new Date());
  const goPrev = () => onDateChange(dayjs(date).subtract(1, view === 'week' ? 'week' : 'month').toDate());
  const goNext = () => onDateChange(dayjs(date).add(1, view === 'week' ? 'week' : 'month').toDate());

  const headerLabel = useMemo(() => {
    if (view === 'month') return dayjs(date).format('MMMM YYYY');
    const [start, end] = getWeekRange(date);
    return `${dayjs(start).format('DD/MM')} - ${dayjs(end).format('DD/MM/YYYY')}`;
  }, [date, view]);

  return (
    <Box>
      <Group justify="space-between" mb="md" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Button variant="default" size="xs" onClick={goToday}>Hôm nay</Button>
          <ActionIcon variant="default" size="sm" onClick={goPrev} aria-label="Kỳ trước">
            <IconChevronLeft size={16} />
          </ActionIcon>
          <ActionIcon variant="default" size="sm" onClick={goNext} aria-label="Kỳ sau">
            <IconChevronRight size={16} />
          </ActionIcon>
          <Text fw={600} size="sm" tt="capitalize">{headerLabel}</Text>
        </Group>
        <SegmentedControl
          size="xs"
          value={view}
          onChange={(v) => onViewChange(v as CalendarViewMode)}
          data={[
            { value: 'week', label: 'Tuần' },
            { value: 'month', label: 'Tháng' },
          ]}
        />
      </Group>

      {view === 'week' ? (
        <WeekGrid date={date} events={events} hourWindow={hourWindow} onEventClick={onEventClick} />
      ) : (
        <MonthGrid date={date} events={events} onEventClick={onEventClick} />
      )}
    </Box>
  );
}

function WeekGrid({
  date,
  events,
  hourWindow,
  onEventClick,
}: {
  date: Date;
  events: CalendarEvent[];
  hourWindow: HourWindow;
  onEventClick?: (event: CalendarEvent) => void;
}) {
  const [weekStart] = getWeekRange(date);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => dayjs(weekStart).add(i, 'day').toDate()),
    [weekStart],
  );
  const hours = useMemo(
    () => Array.from({ length: hourWindow.endHour - hourWindow.startHour }, (_, i) => hourWindow.startHour + i),
    [hourWindow],
  );
  const rowHeight = 60; // px per hour row (Core 3 time-grid: 60px hour rows)
  const headerRowHeight = 40; // px — Core 3 time-grid header row

  return (
    <Box style={{ border: '1px solid var(--cmc-border)', borderRadius: 10, overflow: 'hidden' }}>
      <Box style={{ display: 'grid', gridTemplateColumns: `56px repeat(7, 1fr)` }}>
        <Box style={{ height: headerRowHeight }} />
        {days.map((d, i) => {
          const isToday = dayjs(d).isSame(new Date(), 'day');
          return (
            <Box
              key={i}
              style={{
                height: headerRowHeight,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderLeft: '1px solid var(--cmc-border-faint)',
                backgroundColor: isToday ? 'var(--cmc-brand-muted)' : undefined,
                boxShadow: isToday ? 'inset 0 0 0 2px var(--cmc-brand)' : undefined,
              }}
            >
              <Text size="xs" c="dimmed" lh={1.2}>{WEEKDAY_LABELS_MON_FIRST[i]}</Text>
              <Text size="sm" fw={600} lh={1.2} c={isToday ? 'var(--cmc-brand)' : undefined}>{dayjs(d).format('DD')}</Text>
            </Box>
          );
        })}
      </Box>
      <Box style={{ display: 'grid', gridTemplateColumns: `56px repeat(7, 1fr)`, position: 'relative' }}>
        <Box>
          {hours.map((h) => (
            <Box key={h} style={{ height: rowHeight, textAlign: 'right', paddingRight: 6 }}>
              <Text size="xs" c="dimmed">{String(h).padStart(2, '0')}:00</Text>
            </Box>
          ))}
        </Box>
        {days.map((d, i) => {
          const dayStart = dayjs(d).startOf('day').toDate();
          const dayEnd = dayjs(d).endOf('day').toDate();
          const placed = placeEventsInDay(events, dayStart, dayEnd, hourWindow);
          const totalHeight = rowHeight * hours.length;
          const isToday = dayjs(d).isSame(new Date(), 'day');
          return (
            <Box
              key={i}
              style={{
                position: 'relative',
                borderLeft: '1px solid var(--cmc-border-faint)',
                height: totalHeight,
                backgroundColor: isToday ? 'var(--cmc-brand-muted)' : undefined,
                boxShadow: isToday ? 'inset 2px 0 0 0 var(--cmc-brand)' : undefined,
              }}
            >
              {hours.map((h) => (
                <Box key={h} style={{ height: rowHeight, borderBottom: '1px solid var(--cmc-border-faint)' }} />
              ))}
              {placed.map((p) => {
                const accent = p.event.color ?? 'var(--cmc-brand)';
                return (
                  <Box
                    key={p.event.id}
                    onClick={() => onEventClick?.(p.event)}
                    style={{
                      position: 'absolute',
                      top: `${p.top * 100}%`,
                      height: `${p.height * 100}%`,
                      left: `${(p.columnIndex / p.columnCount) * 100}%`,
                      width: `${(1 / p.columnCount) * 100}%`,
                      backgroundColor: `color-mix(in srgb, ${accent} 14%, var(--cmc-surface))`,
                      color: accent,
                      border: '1px solid var(--cmc-border-faint)',
                      borderLeft: `4px solid ${accent}`,
                      borderRadius: 6,
                      padding: '2px 6px',
                      fontSize: 11,
                      fontWeight: 600,
                      overflow: 'hidden',
                      cursor: onEventClick ? 'pointer' : undefined,
                      boxSizing: 'border-box',
                    }}
                    title={p.event.title}
                  >
                    {p.event.title}
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

const MONTH_CHIP_LIMIT = 3;

function MonthGrid({
  date,
  events,
  onEventClick,
}: {
  date: Date;
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
}) {
  const grid = useMemo(() => getMonthGridCells(date), [date]);
  const month = dayjs(date).month();

  return (
    <Box style={{ border: '1px solid var(--cmc-border)', borderRadius: 10, overflow: 'hidden' }}>
      <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {WEEKDAY_LABELS_MON_FIRST.map((label) => (
          <Box
            key={label}
            style={{
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderLeft: '1px solid var(--cmc-border-faint)',
            }}
          >
            <Text size="xs" c="dimmed">{label}</Text>
          </Box>
        ))}
      </Box>
      {grid.map((row, ri) => (
        <Box key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {row.map((cellDate, ci) => {
            const cellDay = dayjs(cellDate);
            const isCurrentMonth = cellDay.month() === month;
            const isToday = cellDay.isSame(new Date(), 'day');
            const dayEvents = events.filter((e) => dayjs(e.start).isSame(cellDay, 'day'));
            const visible = dayEvents.slice(0, MONTH_CHIP_LIMIT);
            const overflow = dayEvents.length - visible.length;
            return (
              <Box
                key={ci}
                style={{
                  minHeight: 88,
                  padding: 4,
                  borderLeft: '1px solid var(--cmc-border-faint)',
                  borderTop: '1px solid var(--cmc-border-faint)',
                  backgroundColor: isToday ? 'var(--cmc-brand-muted)' : undefined,
                  boxShadow: isToday ? 'inset 0 0 0 2px var(--cmc-brand)' : undefined,
                  opacity: isCurrentMonth ? 1 : 0.45,
                  position: 'relative',
                }}
              >
                <Text size="xs" fw={isToday ? 700 : 500} c={isToday ? 'var(--cmc-brand)' : undefined}>{cellDay.format('DD')}</Text>
                {visible.map((e) => {
                  const accent = e.color ?? 'var(--cmc-brand)';
                  return (
                    <Box
                      key={e.id}
                      onClick={() => onEventClick?.(e)}
                      style={{
                        marginTop: 2,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 4px',
                        borderRadius: 4,
                        backgroundColor: `color-mix(in srgb, ${accent} 14%, var(--cmc-surface))`,
                        color: accent,
                        borderLeft: `3px solid ${accent}`,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        cursor: onEventClick ? 'pointer' : undefined,
                      }}
                      title={e.title}
                    >
                      {e.title}
                    </Box>
                  );
                })}
                {overflow > 0 && (
                  <Text size="xs" c="dimmed" mt={2}>+{overflow} khác</Text>
                )}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
