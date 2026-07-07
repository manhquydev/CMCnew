import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconCheck, IconUserPlus } from '@tabler/icons-react';
import {
  notifyError,
  notifySuccess,
  parseApiDate,
  toApiDate,
  trpc,
  useSession,
} from '@cmc/ui';
import { can } from '@cmc/auth/permissions';
import { TeacherLiteClassControlPanel } from './teacher-lite-class-control-panel';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type ClassBatch = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];
type Program = 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE';

const PROGRAMS: { value: Program; label: string }[] = [
  { value: 'UCREA', label: 'UCREA' },
  { value: 'BRIGHT_IG', label: 'Bright I.G' },
  { value: 'BLACK_HOLE', label: 'Black Hole' },
];

export function TeacherLiteIntakePanel() {
  const { me } = useSession();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [batches, setBatches] = useState<ClassBatch[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(me.facilityIds[0] ?? null);
  const [classBatchId, setClassBatchId] = useState<string | null>(null);
  const [program, setProgram] = useState<Program>('UCREA');
  const [parentName, setParentName] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentDob, setStudentDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    familyPhone: string;
    loginCode: string;
    tempPassword: string;
  } | null>(null);

  const canCreate = can(me.roles, me.isSuperAdmin, 'teacherLite', 'createFamilyStudentAndEnroll');

  const load = useCallback(() => {
    trpc.facility.list
      .query()
      .then(setFacilities)
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
    trpc.classBatch.list
      .query()
      .then(setBatches)
      .catch((e) => notifyError(e, 'Không tải được danh sách lớp'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredBatches = useMemo(
    () => batches.filter((b) => !facilityId || b.facilityId === facilityId),
    [batches, facilityId],
  );
  const activeBatches = filteredBatches.filter((b) => b.status !== 'cancelled');

  function resetStudentFields() {
    setParentName('');
    setParentEmail('');
    setParentPhone('');
    setStudentName('');
    setStudentDob('');
    setCreated(null);
  }

  async function submit() {
    if (!facilityId || !classBatchId || !parentName.trim() || !parentEmail.trim() || !parentPhone.trim() || !studentName.trim()) {
      notifyError('Vui lòng điền đủ cơ sở, lớp, phụ huynh và học sinh.', 'Thiếu thông tin');
      return;
    }
    setBusy(true);
    setCreated(null);
    try {
      const result = await trpc.teacherLite.createFamilyStudentAndEnroll.mutate({
        facilityId,
        classBatchId,
        parentName: parentName.trim(),
        parentEmail: parentEmail.trim(),
        parentPhone: parentPhone.trim(),
        studentName: studentName.trim(),
        studentDob: parseApiDate(studentDob) ?? undefined,
        program,
      });
      setCreated(result.lmsAccount);
      notifySuccess('Đã tạo học viên và gửi email LMS cho phụ huynh.', 'Thành công');
      setStudentName('');
      setStudentDob('');
    } catch (e) {
      notifyError(e, 'Không tạo được học viên');
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) {
    return (
      <Card withBorder p="lg">
        <Text c="dimmed" size="sm">
          Tài khoản này chưa có quyền tiếp nhận học viên trên Teacher Lite.
        </Text>
      </Card>
    );
  }

  return (
    <Stack gap="lg">
      <TeacherLiteClassControlPanel onChanged={load} />

      <Card withBorder radius="md" p="lg">
        <Group gap="xs" mb="lg">
          <IconUserPlus size={18} />
          <Title order={5}>Thêm học sinh mới</Title>
        </Group>

        <Grid gutter="md">
          {/* Left: class + program selection */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="sm">
              <Text size="sm" fw={600} c="dimmed">
                Lớp học
              </Text>
              <Select
                label="Cơ sở"
                withAsterisk
                searchable
                data={facilities.map((f) => ({
                  value: String(f.id),
                  label: `${f.code} – ${f.name}`,
                }))}
                value={facilityId ? String(facilityId) : null}
                onChange={(v) => {
                  setFacilityId(v ? Number(v) : null);
                  setClassBatchId(null);
                }}
              />
              <Select
                label="Lớp"
                withAsterisk
                searchable
                data={activeBatches.map((b) => ({
                  value: b.id,
                  label: `${b.code} – ${b.name}`,
                }))}
                value={classBatchId}
                onChange={setClassBatchId}
              />
              <Select
                label="Chương trình"
                withAsterisk
                data={PROGRAMS}
                value={program}
                onChange={(v) => v && setProgram(v as Program)}
                allowDeselect={false}
              />
            </Stack>
          </Grid.Col>

          {/* Center: parent info */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="sm">
              <Text size="sm" fw={600} c="dimmed">
                Thông tin phụ huynh
              </Text>
              <TextInput
                label="Họ tên"
                withAsterisk
                value={parentName}
                onChange={(e) => setParentName(e.currentTarget.value)}
              />
              <TextInput
                label="Số điện thoại"
                withAsterisk
                placeholder="09xxxxxxxx"
                value={parentPhone}
                onChange={(e) => setParentPhone(e.currentTarget.value)}
              />
              <TextInput
                label="Email"
                withAsterisk
                type="email"
                placeholder="email@example.com"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.currentTarget.value)}
              />
            </Stack>
          </Grid.Col>

          {/* Right: student info */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="sm">
              <Text size="sm" fw={600} c="dimmed">
                Thông tin học sinh
              </Text>
              <TextInput
                label="Họ tên"
                withAsterisk
                value={studentName}
                onChange={(e) => setStudentName(e.currentTarget.value)}
              />
              <DateInput
                label="Ngày sinh"
                clearable
                valueFormat="DD/MM/YYYY"
                value={parseApiDate(studentDob)}
                onChange={(d) => setStudentDob(toApiDate(d) ?? '')}
              />
            </Stack>
          </Grid.Col>
        </Grid>

        {created && (
          <Alert
            icon={<IconCheck size={16} />}
            color="green"
            variant="light"
            mt="md"
            title="Đã tạo tài khoản LMS"
          >
            <Stack gap={4}>
              <Group gap="xs">
                <Badge size="sm" variant="outline" color="green">SĐT</Badge>
                <Text size="sm">{created.familyPhone}</Text>
              </Group>
              <Group gap="xs">
                <Badge size="sm" variant="outline" color="blue">Mã dự phòng</Badge>
                <Text size="sm">{created.loginCode}</Text>
              </Group>
              <Group gap="xs">
                <Badge size="sm" variant="outline" color="orange">Mật khẩu mặc định</Badge>
                <Text size="sm">{created.tempPassword}</Text>
              </Group>
            </Stack>
          </Alert>
        )}

        <Group mt="md">
          <Button
            loading={busy}
            leftSection={<IconUserPlus size={14} />}
            onClick={submit}
          >
            Thêm học sinh &amp; gửi email PH
          </Button>
          <Button variant="subtle" onClick={resetStudentFields}>
            Xóa form
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}
