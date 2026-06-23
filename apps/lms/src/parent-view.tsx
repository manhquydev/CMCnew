import { useCallback, useEffect, useState } from 'react';
import { trpc, type LmsPrincipal } from '@cmc/ui';
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';

type Submission = Awaited<ReturnType<typeof trpc.submission.forStudent.query>>[number];

const STATUS_LABEL: Record<Submission['status'], string> = {
  draft: 'Nháp',
  submitted: 'Đã nộp',
  graded: 'Đã chấm',
};
const STATUS_COLOR: Record<Submission['status'], string> = {
  draft: 'gray',
  submitted: 'blue',
  graded: 'teal',
};

function fmtDateTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** Newest first: submitted ones by submittedAt desc, drafts (no submittedAt) sink to the bottom. */
function sortNewestFirst(rows: Submission[]): Submission[] {
  return [...rows].sort((a, b) => {
    const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    return tb - ta;
  });
}

function ChildDashboard({ childId }: { childId: string }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    setBalance(null);
    setSubmissions(null);
    Promise.all([
      trpc.rewards.balance.query({ studentId: childId }),
      trpc.submission.forStudent.query({ studentId: childId }),
    ])
      .then(([bal, subs]) => {
        setBalance(bal);
        setSubmissions(sortNewestFirst(subs));
      })
      .catch((e) => {
        setError('Không tải được dữ liệu: ' + (e instanceof Error ? e.message : ''));
      })
      .finally(() => setLoading(false));
  }, [childId]);

  // Reload whenever the selected child changes.
  useEffect(load, [load]);

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" mt="md">
        {error}
      </Alert>
    );
  }

  return (
    <Stack mt="md">
      <Card withBorder>
        <Text size="sm" c="dimmed">
          Số sao tích lũy
        </Text>
        <Title order={3} c="cmc.7">
          ⭐ {balance ?? 0} sao
        </Title>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">
          Bài tập &amp; kết quả ({submissions?.length ?? 0})
        </Title>
        {submissions && submissions.length > 0 ? (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Bài tập</Table.Th>
                <Table.Th>Trạng thái</Table.Th>
                <Table.Th>Điểm</Table.Th>
                <Table.Th>Nhận xét</Table.Th>
                <Table.Th>Thời gian nộp</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {submissions.map((s) => {
                const published = s.grade && s.grade.isPublished;
                return (
                  <Table.Tr key={s.id}>
                    <Table.Td>{s.exercise.title}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={STATUS_COLOR[s.status]}>
                        {STATUS_LABEL[s.status]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {published ? `${s.grade!.score}/${s.grade!.maxScore}` : '—'}
                    </Table.Td>
                    <Table.Td>
                      {published && s.grade!.feedback ? (
                        s.grade!.feedback
                      ) : (
                        <Text c="dimmed" span>
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{fmtDateTime(s.submittedAt)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed" size="sm">
            Chưa có bài tập nào cho học sinh này.
          </Text>
        )}
      </Card>
    </Stack>
  );
}

export function ParentView({ principal }: { principal: LmsPrincipal }) {
  const students = principal.students;
  const [childId, setChildId] = useState<string | null>(students[0]?.id ?? null);

  if (students.length === 0) {
    return (
      <Card withBorder maw={520}>
        <Title order={5} mb="xs">
          Theo dõi học tập
        </Title>
        <Text c="dimmed" size="sm">
          Chưa có học sinh được liên kết với tài khoản này.
        </Text>
      </Card>
    );
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={4}>Theo dõi học tập</Title>
          <Text c="dimmed" size="sm">
            Xin chào {principal.displayName}.
          </Text>
        </div>
        <Select
          label="Học sinh"
          w={260}
          allowDeselect={false}
          data={students.map((s) => ({ value: s.id, label: s.fullName }))}
          value={childId}
          onChange={(v) => v && setChildId(v)}
        />
      </Group>

      {childId && <ChildDashboard key={childId} childId={childId} />}
    </Stack>
  );
}
