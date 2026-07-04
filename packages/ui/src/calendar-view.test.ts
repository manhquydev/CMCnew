import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import { getWeekRange, getMonthGridCells, placeEventsInDay, type CalendarEvent } from './calendar-view.js';

describe('getWeekRange', () => {
  it('returns Monday-start week range containing the given date', () => {
    // 2026-07-03 is a Friday.
    const [start, end] = getWeekRange(new Date('2026-07-03T12:00:00'));
    expect(dayjs(start).format('YYYY-MM-DD')).toBe('2026-06-29'); // Monday
    expect(dayjs(end).format('YYYY-MM-DD')).toBe('2026-07-05'); // Sunday
    expect(dayjs(start).hour()).toBe(0);
    expect(dayjs(end).hour()).toBe(23);
  });

  it('handles a date that already falls on the week-start day', () => {
    // 2026-06-29 is itself a Monday.
    const [start] = getWeekRange(new Date('2026-06-29T00:00:00'));
    expect(dayjs(start).format('YYYY-MM-DD')).toBe('2026-06-29');
  });

  it('supports a Sunday week-start via weekStartDay=0', () => {
    const [start, end] = getWeekRange(new Date('2026-07-03T12:00:00'), 0);
    expect(dayjs(start).format('YYYY-MM-DD')).toBe('2026-06-28'); // Sunday
    expect(dayjs(end).format('YYYY-MM-DD')).toBe('2026-07-04'); // Saturday
  });
});

describe('getMonthGridCells', () => {
  it('produces a 6x7 grid whose first cell aligns to week-start and covers the whole month', () => {
    const grid = getMonthGridCells(new Date('2026-07-15T00:00:00'));
    expect(grid).toHaveLength(6);
    grid.forEach((row) => expect(row).toHaveLength(7));

    // First cell must land on the configured week-start weekday (Monday = 1).
    expect(dayjs(grid[0]![0]!).day()).toBe(1);

    // Grid cells are consecutive calendar days with no gaps/duplicates.
    const flat = grid.flat();
    for (let i = 1; i < flat.length; i++) {
      expect(dayjs(flat[i]).diff(dayjs(flat[i - 1]!), 'day')).toBe(1);
    }

    // The month's first and last day must both appear somewhere in the grid
    // (covers the classic leading/trailing off-by-one bug surface).
    const monthStart = dayjs('2026-07-15').startOf('month').format('YYYY-MM-DD');
    const monthEnd = dayjs('2026-07-15').endOf('month').format('YYYY-MM-DD');
    const flatStrs = flat.map((d) => dayjs(d).format('YYYY-MM-DD'));
    expect(flatStrs).toContain(monthStart);
    expect(flatStrs).toContain(monthEnd);
  });

  it('handles a month that already starts on the week-start day', () => {
    // 2026-06-01 is a Monday.
    const grid = getMonthGridCells(new Date('2026-06-01T00:00:00'));
    expect(dayjs(grid[0]![0]!).format('YYYY-MM-DD')).toBe('2026-06-01');
  });

  it('handles a leap-February month (2028-02, 29 days)', () => {
    const grid = getMonthGridCells(new Date('2028-02-15T00:00:00'));
    expect(grid).toHaveLength(6);
    const flatStrs = grid.flat().map((d) => dayjs(d).format('YYYY-MM-DD'));
    expect(flatStrs).toContain('2028-02-01');
    expect(flatStrs).toContain('2028-02-29'); // leap day must be present
    expect(dayjs(grid[0]![0]!).day()).toBe(1); // still Monday-aligned
  });

  it('handles a month whose 1st falls on a Sunday (2026-02, 1st is Sunday)', () => {
    const grid = getMonthGridCells(new Date('2026-02-10T00:00:00'));
    expect(grid).toHaveLength(6);
    const flat = grid.flat();
    const flatStrs = flat.map((d) => dayjs(d).format('YYYY-MM-DD'));
    expect(flatStrs).toContain('2026-02-01');
    expect(flatStrs).toContain('2026-02-28');
    // 1st is a Sunday with Monday week-start, so it must NOT be the grid's first cell —
    // a full leading week of the prior month (Jan 26-31) should precede it.
    expect(dayjs(grid[0]![0]!).format('YYYY-MM-DD')).toBe('2026-01-26');
    for (let i = 1; i < flat.length; i++) {
      expect(dayjs(flat[i]).diff(dayjs(flat[i - 1]!), 'day')).toBe(1);
    }
  });
});

describe('placeEventsInDay', () => {
  const dayStart = new Date('2026-07-06T00:00:00');
  const dayEnd = new Date('2026-07-06T23:59:59');
  const hourWindow = { startHour: 7, endHour: 21 }; // 840-minute window

  function evt(id: string, startHM: string, endHM: string): CalendarEvent {
    return {
      id,
      title: id,
      start: new Date(`2026-07-06T${startHM}:00`),
      end: new Date(`2026-07-06T${endHM}:00`),
    };
  }

  it('positions a single non-overlapping event with proportional top/height', () => {
    const [placed] = placeEventsInDay([evt('solo', '11:00', '12:00')], dayStart, dayEnd, hourWindow);
    expect(placed).toBeDefined();
    // (11:00 - 07:00) = 240min / 840min window
    expect(placed!.top).toBeCloseTo(240 / 840, 5);
    // 60min duration / 840min window
    expect(placed!.height).toBeCloseTo(60 / 840, 5);
    expect(placed!.columnIndex).toBe(0);
    expect(placed!.columnCount).toBe(1);
  });

  it('even-splits columns across a 3-way overlap cluster and keeps a separate event isolated', () => {
    const events = [
      evt('a', '09:00', '10:00'),
      evt('b', '09:30', '10:30'),
      evt('c', '09:45', '10:15'),
      evt('solo', '11:00', '12:00'), // starts after cluster ends — must not join it
    ];
    const placed = placeEventsInDay(events, dayStart, dayEnd, hourWindow);
    expect(placed).toHaveLength(4);

    const cluster = placed.filter((p) => p.event.id !== 'solo');
    // All three overlap pairwise, so every one needs its own column.
    cluster.forEach((p) => expect(p.columnCount).toBe(3));
    expect(new Set(cluster.map((p) => p.columnIndex))).toEqual(new Set([0, 1, 2]));

    const solo = placed.find((p) => p.event.id === 'solo')!;
    expect(solo.columnCount).toBe(1);
    expect(solo.columnIndex).toBe(0);
  });

  it('reuses a freed column once an earlier overlapping event ends (2-way then non-overlapping)', () => {
    const events = [
      evt('a', '09:00', '09:30'),
      evt('b', '09:15', '09:45'), // overlaps a
      evt('c', '09:45', '10:15'), // starts exactly when the cluster's running end (09:45) is reached —
      // clustering uses strict `<`, so this starts a NEW cluster (not a column-reuse within a's cluster);
      // columnIndex 0 either way since it's the first event in its own cluster, not because it reused a's slot.
    ];
    const placed = placeEventsInDay(events, dayStart, dayEnd, hourWindow);
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect(byId.a!.columnIndex).toBe(0);
    expect(byId.b!.columnIndex).toBe(1);
    expect(byId.c!.columnIndex).toBe(0);
  });

  it('clips events extending outside the hour window and drops events entirely outside it', () => {
    const events = [
      evt('early-bleed', '06:00', '08:00'), // starts before window, should clip to windowStart
      evt('late-bleed', '20:30', '22:00'), // ends after window, should clip to windowEnd
      evt('outside', '22:30', '23:00'), // entirely after window — excluded
    ];
    const placed = placeEventsInDay(events, dayStart, dayEnd, hourWindow);
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]));

    expect(byId.outside).toBeUndefined();

    // early-bleed clipped to windowStart (07:00): top 0, height = (08:00-07:00)=60min/840
    expect(byId['early-bleed']!.top).toBeCloseTo(0, 5);
    expect(byId['early-bleed']!.height).toBeCloseTo(60 / 840, 5);

    // late-bleed clipped to windowEnd (21:00): top=(20:30-07:00)=810/840, height=(21:00-20:30)=30/840
    expect(byId['late-bleed']!.top).toBeCloseTo(810 / 840, 5);
    expect(byId['late-bleed']!.height).toBeCloseTo(30 / 840, 5);
  });
});
