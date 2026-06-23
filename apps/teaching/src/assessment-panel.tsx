import { useCallback, useEffect, useState } from 'react';
import { trpc } from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';

type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type FinalResult = Awaited<ReturnType<typeof trpc.assessment.computeFinalGrade.mutate>>;

const PERIODS = [
  { value: 'MONTHLY', label: 'Hàng tháng' },
  { value: 'END_LEVEL', label: 'Cuối cấp độ' },
] as const;
type Period = (typeof PERIODS)[number]['value'];

const PROGRAM_LABEL: Record<string, string> = {
  UCREA: 'UCREA',
  BRIGHT_IG: 'Bright I.G',
  BLACK_HOLE: 'Black Hole',
};

function StudentAssessment({ student }: { student: StudentT }) {
  const [pillars, setPillars] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, number | string>>({});
  const [narrative, setNarrative] = useState('');
  const [period, setPeriod] = useState<Period>('MONTHLY');
  const [periodKey, setPeriodKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [result, setResult] = useState<FinalResult | null>(null);

  // Pillars are driven by the program's configured rubric template, not hardcoded.
  useEffect(() => {
    setResult(null);
    setMsg(null);
    trpc.assessment.template
      .query({ program: student.program })
      .then((t) => {
        setPillars(t.pillars);
        setScores(Object.fromEntries(t.pillars.map((p) => [p, ''])));
      })
      .catch(() => setPillars([]));
  }, [student.program, student.id]);

  const criteriaPayload = useCallback(() => {
    const out: Record<string, number> = {};
    for (const p of pillars) {
      const v = scores[p];
      if (typeof v === 'number') out[p] = v;
    }
    return out;
  }, [pillars, scores]);

  async function saveQualitative() {
    if (!periodKey.trim()) {
      setMsg({ kind: 'err', text: 'Nhập kỳ đánh giá (ví dụ 2026-06 hoặc L1).' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await trpc.assessment.upsertQualitative.mutate({
        studentId: student.id,
        period,
        periodKey: periodKey.trim(),
        criteria: criteriaPayload(),
        narrative: narrative.trim() || undefined,
        program: student.program,
      });
      setMsg({ kind: 'ok', text: 'Đã lưu đánh giá định tính.' });
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    } finally {
      setBusy(false);
    }
  }

  async function computeFinal() {
    if (!periodKey.trim()) {
      setMsg({ kind: 'err', text: 'Nhập kỳ đánh giá trước khi tổng kết.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await trpc.assessment.computeFinalGrade.mutate({
        studentId: student.id,
        program: student.program,
        periodKey: periodKey.trim(),
      });
      setResult(r);
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <div>
            <Title order={5}>{student.fullName}</Title>
            <Text size="sm" c="dimmed">
              {student.studentCode} · {PROGRAM_LABEL[student.program] ?? student.program}
            </Text>
          </div>
        </Group>
        <Group grow align="flex-end">
          <Select
            label="Kỳ"
            data={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            value={period}
            onChange={(v) => v && setPeriod(v as Period)}
            allowDeselect={false}
          />
          <TextInput
            label="Mã kỳ"
            placeholder="2026-06 hoặc L1"
            value={periodKey}
            onChange={(e) => setPeriodKey(e.currentTarget.value)}
          />
        </Group>
      </Card>

      <Card withBorder>
        <Title order={6} mb="sm">
          Đánh giá định tính (0–10 mỗi tiêu chí)
        </Title>
        {pillars.length > 0 ? (
          <Stack gap="xs">
            {pillars.map((p) => (
              <Group key={p} justify="space-between">
                <Text size="sm" tt="capitalize">
                  {p}
                </Text>
                <NumberInput
                  w={120}
                  min={0}
                  max={10}
                  step={0.5}
                  value={scores[p]}
                  onChange={(v) => setScores((s) => ({ ...s, [p]: v }))}
                />
              </Group>
            ))}
          </Stack>
        ) : (
          <Text c="dimmed" size="sm">
            Chương trình này chưa cấu hình tiêu chí (GradingTemplate).
          </Text>
        )}
        <Textarea
          label="Nhận xét"
          mt="sm"
          autosize
          minRows={2}
          value={narrative}
          onChange={(e) => setNarrative(e.currentTarget.value)}
        />
        <Group mt="md">
          <Button onClick={saveQualitative} loading={busy} disabled={pillars.length === 0}>
            Lưu đánh giá
          </Button>
          <Button variant="light" onClick={computeFinal} loading={busy}>
            Tổng kết điểm
          </Button>
        </Group>
      </Card>

      {msg && (
        <Alert color={msg.kind === 'ok' ? 'green' : 'red'} withCloseButton onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      {result && (
        <Card withBorder>
          <Title order={6} mb="xs">
            Kết quả tổng kết
          </Title>
          <Group>
            <Text>
              Điểm tổng kết: <b>{result.finalScore == null ? '—' : result.finalScore.toFixed(1)}</b>
            </Text>
            {!result.complete ? (
              <Badge color="gray">Chưa đủ dữ liệu</Badge>
            ) : (
              <Badge color={result.passed ? 'teal' : 'red'}>{result.passed ? 'Đạt' : 'Chưa đạt'}</Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            Đã lưu vào học bạ — phụ huynh thấy ở cổng LMS.
          </Text>
        </Card>
      )}
    </Stack>
  );
}

export function AssessmentPanel() {
  const [students, setStudents] = useState<StudentT[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    trpc.student.list.query().then(setStudents).catch(() => setStudents([]));
  }, []);

  const selected = students.find((s) => s.id === studentId) ?? null;

  return (
    <Stack>
      <Select
        label="Học sinh"
        w={360}
        searchable
        placeholder={students.length ? 'Chọn học sinh' : 'Chưa có học sinh'}
        data={students.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
        value={studentId}
        onChange={setStudentId}
      />
      {selected ? (
        <StudentAssessment key={selected.id} student={selected} />
      ) : (
        <Card withBorder>
          <Text c="dimmed">Chọn học sinh để chấm định tính và tổng kết học bạ.</Text>
        </Card>
      )}
    </Stack>
  );
}
