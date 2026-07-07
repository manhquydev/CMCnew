import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconRefresh } from '@tabler/icons-react';
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

  useEffect(() => {
    load();
  }, [load]);

  const filteredBatches = useMemo(
    () => batches.filter((batch) => !facilityId || batch.facilityId === facilityId),
    [batches, facilityId],
  );

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
      notifySuccess('Đã tạo học viên và gửi email LMS cho phụ huynh.', 'Teacher Lite');
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
      <Card withBorder>
        <Text c="dimmed" size="sm">Tài khoản này chưa có quyền tiếp nhận học viên trên Teacher Lite.</Text>
      </Card>
    );
  }

  return (
    <Stack>
      <TeacherLiteClassControlPanel onChanged={load} />
      <Card withBorder>
        <Group justify="space-between" mb="md">
          <Title order={5}>Tiếp nhận học viên</Title>
          <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={load}>
            Tải lại
          </Button>
        </Group>
        <Stack>
          <Group grow align="flex-end">
            <Select
              label="Cơ sở"
              withAsterisk
              searchable
              data={facilities.map((facility) => ({
                value: String(facility.id),
                label: `${facility.code} - ${facility.name}`,
              }))}
              value={facilityId ? String(facilityId) : null}
              onChange={(value: string | null) => {
                setFacilityId(value ? Number(value) : null);
                setClassBatchId(null);
              }}
            />
            <Select
              label="Lớp"
              withAsterisk
              searchable
              data={filteredBatches.map((batch) => ({
                value: batch.id,
                label: `${batch.code} - ${batch.name}`,
              }))}
              value={classBatchId}
              onChange={setClassBatchId}
            />
            <Select
              label="Chương trình"
              withAsterisk
              data={PROGRAMS}
              value={program}
              onChange={(value) => value && setProgram(value as Program)}
              allowDeselect={false}
            />
          </Group>
          <Group grow align="flex-end">
            <TextInput label="Tên phụ huynh" withAsterisk value={parentName} onChange={(e) => setParentName(e.currentTarget.value)} />
            <TextInput label="Email phụ huynh" withAsterisk type="email" value={parentEmail} onChange={(e) => setParentEmail(e.currentTarget.value)} />
            <TextInput label="SĐT phụ huynh" withAsterisk value={parentPhone} onChange={(e) => setParentPhone(e.currentTarget.value)} />
          </Group>
          <Group grow align="flex-end">
            <TextInput label="Tên học sinh" withAsterisk value={studentName} onChange={(e) => setStudentName(e.currentTarget.value)} />
            <DateInput
              label="Ngày sinh"
              clearable
              valueFormat="DD/MM/YYYY"
              value={parseApiDate(studentDob)}
              onChange={(date) => setStudentDob(toApiDate(date) ?? '')}
            />
          </Group>
          {created && (
            <Alert color="green" variant="light">
              <Stack gap={2}>
                <Text size="sm">Phone LMS: {created.familyPhone}</Text>
                <Text size="sm">Mã dự phòng: {created.loginCode}</Text>
                <Text size="sm">Mật khẩu mặc định: {created.tempPassword}</Text>
              </Stack>
            </Alert>
          )}
          <Group>
            <Button onClick={submit} loading={busy}>Tạo học viên</Button>
            <Button variant="subtle" onClick={resetStudentFields}>Xóa form</Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
