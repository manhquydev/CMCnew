import { useEffect, useMemo, useState } from 'react';
import { Card, Center, Group, Loader, Select, Stack, Text, Title } from '@mantine/core';
import { IconBook } from '@tabler/icons-react';
import { FacilityPicker, notifyError, trpc } from '@cmc/ui';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type ClassBatch = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];

interface GradingClassPickerProps {
  facilityId: number | null;
  onSelectBatch: (batchId: string) => void;
}

export function GradingClassPicker({ facilityId: initialFacilityId, onSelectBatch }: GradingClassPickerProps) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [batches, setBatches] = useState<ClassBatch[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(initialFacilityId);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpc.facility.list.query().then(setFacilities).catch((e) => notifyError(e, 'Không tải được cơ sở'));
    setLoading(true);
    trpc.classBatch.list
      .query()
      .then(setBatches)
      .catch((e) => notifyError(e, 'Không tải được danh sách lớp'))
      .finally(() => setLoading(false));
  }, []);

  const activeBatches = useMemo(
    () => batches.filter((b) => b.status !== 'cancelled' && (!facilityId || b.facilityId === facilityId)),
    [batches, facilityId],
  );

  return (
    <Stack p="md" gap="md">
      <Title order={4}>Chấm bài</Title>
      <Group>
        <FacilityPicker
          facilities={facilities}
          value={facilityId}
          onChange={setFacilityId}
          clearable
          w={220}
        />
      </Group>
      {loading ? (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      ) : activeBatches.length === 0 ? (
        <Card withBorder p="xl" radius="md">
          <Center>
            <Stack align="center" gap="xs">
              <IconBook size={36} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Không có lớp nào để chấm bài</Text>
            </Stack>
          </Center>
        </Card>
      ) : (
        <Select
          label="Chọn lớp để chấm bài"
          searchable
          placeholder="Tìm theo tên hoặc mã lớp..."
          w={380}
          data={activeBatches.map((b) => ({ value: b.id, label: `${b.code} – ${b.name}` }))}
          onChange={(v) => v && onSelectBatch(v)}
        />
      )}
    </Stack>
  );
}
