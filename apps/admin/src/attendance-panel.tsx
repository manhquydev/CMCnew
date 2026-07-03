import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, notifyError, FacilityPicker, StatusBadge, type StatusDef } from '@cmc/ui';
import { Card, Group, Loader, Select, Stack, Text } from '@mantine/core';
import { AttendanceRoster } from './attendance-roster.js';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type MySession = Awaited<ReturnType<typeof trpc.schedule.mySessions.query>>[number];

// Display-only status chip for the selected session header (same tone mapping as schedule-panel.tsx).
const SESSION_STATUS_DEF: Record<string, StatusDef> = {
  planned: { label: 'planned', tone: 'draft' },
  open: { label: 'open', tone: 'info' },
  running: { label: 'running', tone: 'active' },
  closed: { label: 'closed', tone: 'inactive' },
  cancelled: { label: 'cancelled', tone: 'rejected' },
};

/**
 * Cross-class attendance panel — fetches today's sessions for the active facility,
 * lets the user pick one, then delegates roster marking to AttendanceRoster.
 * Only sessions where the caller is the teacher (giao_vien) or all sessions
 * (giam_doc_dao_tao) are shown, matching the mySessions router authz.
 */
export function AttendancePanel() {
  const today = dayjs().format('YYYY-MM-DD');
  const todayLabel = dayjs().format('DD/MM/YYYY');

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [sessions, setSessions] = useState<MySession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
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

  // Reload today's sessions when facility changes
  useEffect(() => {
    if (!facilityId) return;
    setLoading(true);
    setError('');
    setSessionId(null);
    setSessions([]);
    trpc.schedule.mySessions
      .query({ facilityId, from: today, to: today })
      .then(setSessions)
      .catch((e: Error) => {
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [facilityId, today]);

  const selectedSession = sessions.find((s) => s.id === sessionId);

  return (
    <Stack>
      <FacilityPicker
        facilities={facilities}
        w={220}
        placeholder={facilitiesLoading ? 'Đang tải...' : undefined}
        disabled={facilitiesLoading}
        clearable={false}
        value={facilityId}
        onChange={setFacilityId}
      />

      {loading && <Loader size="sm" />}

      {error && (
        <Text c="red" size="sm">
          Lỗi tải buổi học: {error}
        </Text>
      )}

      {!loading && !error && (
        <Select
          label={`Buổi học hôm nay (${todayLabel})`}
          placeholder={
            sessions.length
              ? 'Chọn buổi để điểm danh'
              : 'Không có buổi học nào hôm nay'
          }
          data={sessions.map((s) => ({
            value: s.id,
            label: `${s.batch.code} — ${s.batch.name}  ${s.startTime}–${s.endTime}${s.roomName ? ` (${s.roomName})` : ''}`,
          }))}
          value={sessionId}
          onChange={setSessionId}
          disabled={sessions.length === 0}
        />
      )}

      {sessionId && selectedSession && facilityId && (
        <Card withBorder>
          <Group justify="space-between" wrap="wrap" mb="xs">
            <Text fw={600}>
              Điểm danh: {selectedSession.batch.code} — {selectedSession.batch.name}
              {'  '}
              {dayjs(selectedSession.sessionDate).format('DD/MM/YYYY')} {selectedSession.startTime}
            </Text>
            <StatusBadge status={selectedSession.status} map={SESSION_STATUS_DEF} size="sm" />
          </Group>
          {/* key forces re-mount when session changes so marks reload cleanly */}
          <AttendanceRoster
            key={sessionId}
            classSessionId={sessionId}
            batchId={selectedSession.classBatchId}
            facilityId={facilityId}
          />
        </Card>
      )}
    </Stack>
  );
}
