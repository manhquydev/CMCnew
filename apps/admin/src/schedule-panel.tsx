import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, notifyError, FacilityPicker } from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type MySession = Awaited<ReturnType<typeof trpc.schedule.mySessions.query>>[number];

const STATUS_COLOR: Record<string, string> = {
  planned: 'gray',
  open: 'blue',
  running: 'green',
  closed: 'dark',
  cancelled: 'red',
};

const fmtDate = (d: string | Date) => dayjs(d).format('DD/MM/YYYY');

interface SchedulePanelProps {
  /** Navigate to a specific class workspace tab (e.g. 'sessions'). */
  goToClass: (batchId: string, tab: string) => void;
  /** Open the connected Session Detail view for one lesson (row click). */
  onOpenSession: (session: MySession) => void;
}

/**
 * Cross-class schedule panel — shows the teacher's (or facility's) agenda for a
 * selected date range, grouped by class. Default = this week + next week (rolling 2-week
 * window, so upcoming sessions are visible without manually widening the range). A row click
 * opens the connected Session Detail (onOpenSession); the class-card title opens the
 * Class Workspace via goToClass.
 */
export function SchedulePanel({ goToClass, onOpenSession }: SchedulePanelProps) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  // Default to a rolling 2-week window (this week + next week) so upcoming sessions are visible
  // without requiring the user to manually widen the range (#9: "this week" alone hid next week's
  // sessions for teachers who plan ahead).
  const [from, setFrom] = useState<Date | null>(() => dayjs().startOf('week').toDate());
  const [to, setTo] = useState<Date | null>(() => dayjs().add(1, 'week').endOf('week').toDate());
  const [sessions, setSessions] = useState<MySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load facility list once. `facilitiesLoading` holds the Select in a disabled/loading state so it
  // never flashes an empty/required-looking control before the facility auto-populates (#28).
  useEffect(() => {
    trpc.facility.list
      .query()
      .then((fs) => {
        setFacilities(fs);
        setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
      })
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'))
      .finally(() => setFacilitiesLoading(false));
  }, []);

  // Reload sessions when facility or date range changes
  useEffect(() => {
    if (!facilityId || !from || !to) return;
    setLoading(true);
    setError('');
    trpc.schedule.mySessions
      .query({
        facilityId,
        from: dayjs(from).format('YYYY-MM-DD'),
        to: dayjs(to).format('YYYY-MM-DD'),
      })
      .then(setSessions)
      .catch((e: Error) => {
        setError(e.message);
        setSessions([]);
      })
      .finally(() => setLoading(false));
  }, [facilityId, from, to]);

  // Group sessions by class batch
  const byBatch = new Map<string, { batch: MySession['batch']; rows: MySession[] }>();
  for (const s of sessions) {
    if (!byBatch.has(s.classBatchId)) {
      byBatch.set(s.classBatchId, { batch: s.batch, rows: [] });
    }
    byBatch.get(s.classBatchId)!.rows.push(s);
  }

  return (
    <Stack>
      <Group align="flex-end" wrap="wrap">
        <FacilityPicker
          facilities={facilities}
          w={220}
          placeholder={facilitiesLoading ? 'Đang tải...' : undefined}
          disabled={facilitiesLoading}
          clearable={false}
          value={facilityId}
          onChange={setFacilityId}
        />
        <DateInput
          label="Từ ngày"
          value={from}
          onChange={setFrom}
          valueFormat="DD/MM/YYYY"
          clearable
        />
        <DateInput
          label="Đến ngày"
          value={to}
          onChange={setTo}
          valueFormat="DD/MM/YYYY"
          clearable
        />
        <Button
          variant="default"
          onClick={() => {
            setFrom(dayjs().startOf('week').toDate());
            setTo(dayjs().add(1, 'week').endOf('week').toDate());
          }}
        >
          2 tuần này
        </Button>
      </Group>

      {loading && <Loader size="sm" />}

      {error && (
        <Text c="red" size="sm">
          Lỗi tải lịch: {error}
        </Text>
      )}

      {!loading && !error && sessions.length === 0 && (
        <Card withBorder>
          <Text c="dimmed" size="sm">
            Không có buổi học nào trong khoảng thời gian đã chọn.
          </Text>
        </Card>
      )}

      {!loading &&
        !error &&
        [...byBatch.values()].map(({ batch, rows }) => (
          <Card key={batch.id} withBorder>
            <Title
              order={6}
              mb="xs"
              style={{ cursor: 'pointer', color: 'var(--cmc-brand-hover)' }}
              onClick={() => goToClass(batch.id, 'sessions')}
              title="Mở lớp học"
            >
              {batch.code} — {batch.name}
            </Title>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Ngày</Table.Th>
                  <Table.Th>Giờ</Table.Th>
                  <Table.Th>Phòng</Table.Th>
                  <Table.Th>Trạng thái</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((s) => (
                  <Table.Tr
                    key={s.id}
                    data-testid={`schedule-session-${s.id}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onOpenSession(s)}
                  >
                    <Table.Td>{fmtDate(s.sessionDate)}</Table.Td>
                    <Table.Td>
                      {s.startTime} - {s.endTime}
                    </Table.Td>
                    <Table.Td>{s.roomName ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={STATUS_COLOR[s.status] ?? 'gray'}>
                        {s.status}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        ))}
    </Stack>
  );
}
