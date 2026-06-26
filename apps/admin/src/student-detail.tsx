import { useEffect, useState } from 'react';
import { trpc, notifyError } from '@cmc/ui';
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';

type DetailT = Awaited<ReturnType<typeof trpc.student.detail.query>>;

const LIFECYCLE_COLOR: Record<string, string> = {
  admitted: 'blue',
  active: 'teal',
  on_hold: 'yellow',
  transferred: 'orange',
  withdrawn: 'red',
  completed: 'green',
};

const LIFECYCLE_LABEL: Record<string, string> = {
  admitted: 'Đã nhận',
  active: 'Đang học',
  on_hold: 'Tạm dừng',
  transferred: 'Chuyển',
  withdrawn: 'Nghỉ',
  completed: 'Hoàn thành',
};

const RECEIPT_STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp',
  approved: 'Đã duyệt',
  sent: 'Đã gửi',
  reconciled: 'Đã đối soát',
  cancelled: 'Đã huỷ',
};

const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  active: 'Đang học',
  completed: 'Hoàn thành',
  reserved: 'Dự trữ',
  transferred: 'Chuyển',
  withdrawn: 'Nghỉ',
};

const OPP_STAGE_LABEL: Record<string, string> = {
  O1_LEAD: 'O1 Lead',
  O2_CONTACTED: 'O2 Liên hệ',
  O3_TEST_SCHEDULED: 'O3 Lên lịch test',
  O4_TESTED: 'O4 Đã test',
  O5_ENROLLED: 'O5 Đã ghi danh',
};

const RELATION_LABEL: Record<string, string> = {
  father: 'Bố',
  mother: 'Mẹ',
  guardian: 'Người giám hộ',
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('vi-VN');
}

function fmtCurrency(n: number): string {
  return n.toLocaleString('vi-VN') + ' ₫';
}

// ─── Tab: Thông tin học sinh ─────────────────────────────────────────────────

function InfoTab({ s }: { s: DetailT }) {
  const dob = s.dateOfBirth ? new Date(s.dateOfBirth).toISOString().slice(0, 10) : '—';
  const lcLabel = LIFECYCLE_LABEL[s.lifecycle ?? ''] ?? s.lifecycle ?? '—';
  const lcColor = LIFECYCLE_COLOR[s.lifecycle ?? ''] ?? 'gray';

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="xs">
        <Group>
          <Text size="sm" fw={600} w={130}>Mã học sinh</Text>
          <Text size="sm">{s.studentCode}</Text>
        </Group>
        <Group>
          <Text size="sm" fw={600} w={130}>Họ tên</Text>
          <Text size="sm">{s.fullName}</Text>
        </Group>
        <Group>
          <Text size="sm" fw={600} w={130}>Ngày sinh</Text>
          <Text size="sm">{dob}</Text>
        </Group>
        <Group>
          <Text size="sm" fw={600} w={130}>Chương trình</Text>
          <Badge size="sm" variant="light">{s.program}</Badge>
        </Group>
        <Group>
          <Text size="sm" fw={600} w={130}>Cấp độ</Text>
          <Text size="sm">{s.level ?? '—'}</Text>
        </Group>
        <Group>
          <Text size="sm" fw={600} w={130}>Vòng đời</Text>
          <Badge size="sm" variant="dot" color={lcColor}>{lcLabel}</Badge>
        </Group>
        <Group>
          <Text size="sm" fw={600} w={130}>Ngày tạo</Text>
          <Text size="sm">{fmtDate(s.createdAt)}</Text>
        </Group>
      </Stack>
    </Card>
  );
}

// ─── Tab: Phụ huynh ──────────────────────────────────────────────────────────

function GuardiansTab({ s }: { s: DetailT }) {
  if (s.guardians.length === 0) {
    return <Text c="dimmed" size="sm" ta="center" py="xl">Chưa có phụ huynh liên kết.</Text>;
  }

  return (
    <Card withBorder radius="md" p={0}>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Tên</Table.Th>
            <Table.Th>Quan hệ</Table.Th>
            <Table.Th>SĐT</Table.Th>
            <Table.Th>Email</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {s.guardians.map((g) => (
            <Table.Tr key={g.id}>
              <Table.Td>{g.parent.displayName}</Table.Td>
              <Table.Td>
                <Badge size="xs" variant="light">
                  {RELATION_LABEL[g.relation] ?? g.relation}
                </Badge>
              </Table.Td>
              <Table.Td>{g.parent.phone ?? '—'}</Table.Td>
              <Table.Td>{g.parent.email ?? '—'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

// ─── Tab: Ghi danh ───────────────────────────────────────────────────────────

function EnrollmentsTab({ s }: { s: DetailT }) {
  if (s.enrollments.length === 0) {
    return <Text c="dimmed" size="sm" ta="center" py="xl">Chưa có ghi danh nào.</Text>;
  }

  return (
    <Card withBorder radius="md" p={0}>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Lớp</Table.Th>
            <Table.Th>Khoá học</Table.Th>
            <Table.Th>Trạng thái</Table.Th>
            <Table.Th>Khai giảng</Table.Th>
            <Table.Th>Kết thúc</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {s.enrollments.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>
                <Text size="sm" fw={500}>{e.batch.code}</Text>
                <Text size="xs" c="dimmed">{e.batch.name}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{e.batch.course.name}</Text>
                <Badge size="xs" variant="light">{e.batch.course.program}</Badge>
              </Table.Td>
              <Table.Td>
                <Badge size="xs" variant="dot">
                  {ENROLLMENT_STATUS_LABEL[e.status] ?? e.status}
                </Badge>
              </Table.Td>
              <Table.Td>{fmtDate(e.batch.startDate)}</Table.Td>
              <Table.Td>{fmtDate(e.batch.endDate)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

// ─── Tab: Cơ hội (via receipts) ──────────────────────────────────────────────

function OpportunitiesTab({ s }: { s: DetailT }) {
  const opps = s.receipts
    .filter((r) => r.opportunity != null)
    .map((r) => r.opportunity!);

  // Deduplicate by opportunity id (a student may have multiple receipts on one opportunity)
  const seen = new Set<string>();
  const unique = opps.filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });

  if (unique.length === 0) {
    return <Text c="dimmed" size="sm" ta="center" py="xl">Không có cơ hội CRM liên kết.</Text>;
  }

  return (
    <Card withBorder radius="md" p={0}>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Giai đoạn</Table.Th>
            <Table.Th>Ngày tạo</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {unique.map((o) => (
            <Table.Tr key={o.id}>
              <Table.Td>
                <Badge size="sm" variant="light">
                  {OPP_STAGE_LABEL[o.stage] ?? o.stage}
                </Badge>
              </Table.Td>
              <Table.Td>{fmtDate(o.createdAt)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

// ─── Tab: Thanh toán / Receipt ────────────────────────────────────────────────

function ReceiptsTab({ s }: { s: DetailT }) {
  if (s.receipts.length === 0) {
    return <Text c="dimmed" size="sm" ta="center" py="xl">Chưa có phiếu thu nào.</Text>;
  }

  return (
    <Card withBorder radius="md" p={0}>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Mã PT</Table.Th>
            <Table.Th>Loại</Table.Th>
            <Table.Th>Thực thu</Table.Th>
            <Table.Th>Trạng thái</Table.Th>
            <Table.Th>Ngày duyệt</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {s.receipts.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                <Text size="sm" fw={500}>{r.code ?? '(nháp)'}</Text>
              </Table.Td>
              <Table.Td>
                {r.kind ? (
                  <Badge size="xs" variant="light" color={r.kind === 'new' ? 'blue' : 'teal'}>
                    {r.kind === 'new' ? 'Mới' : 'Tái tục'}
                  </Badge>
                ) : (
                  <Text size="xs" c="dimmed">—</Text>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="sm">{fmtCurrency(r.netAmount)}</Text>
                {r.grossAmount !== r.netAmount && (
                  <Text size="xs" c="dimmed" td="line-through">{fmtCurrency(r.grossAmount)}</Text>
                )}
              </Table.Td>
              <Table.Td>
                <Badge
                  size="xs"
                  variant="dot"
                  color={r.status === 'approved' || r.status === 'reconciled' ? 'green' :
                         r.status === 'cancelled' ? 'red' : 'gray'}
                >
                  {RECEIPT_STATUS_LABEL[r.status] ?? r.status}
                </Badge>
              </Table.Td>
              <Table.Td>{fmtDate(r.approvedAt)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

// ─── Tab: Điểm ───────────────────────────────────────────────────────────────

function GradesTab({ s }: { s: DetailT }) {
  if (s.finalGrades.length === 0) {
    return <Text c="dimmed" size="sm" ta="center" py="xl">Chưa có điểm tổng hợp nào.</Text>;
  }

  return (
    <Card withBorder radius="md" p={0}>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Kỳ</Table.Th>
            <Table.Th>Chương trình</Table.Th>
            <Table.Th>Cấp độ</Table.Th>
            <Table.Th>Điểm</Table.Th>
            <Table.Th>Kết quả</Table.Th>
            <Table.Th>Tính lúc</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {s.finalGrades.map((g) => (
            <Table.Tr key={g.id}>
              <Table.Td>
                <Text size="sm">{g.periodKey}</Text>
              </Table.Td>
              <Table.Td>
                <Badge size="xs" variant="light">{g.program}</Badge>
              </Table.Td>
              <Table.Td>{g.level ?? '—'}</Table.Td>
              <Table.Td>
                <Text size="sm" fw={500}>
                  {g.finalScore != null ? g.finalScore.toFixed(1) : '—'}
                </Text>
              </Table.Td>
              <Table.Td>
                {g.complete ? (
                  <Badge size="xs" variant="dot" color={g.passed ? 'green' : 'red'}>
                    {g.passed ? 'Đạt' : 'Chưa đạt'}
                  </Badge>
                ) : (
                  <Badge size="xs" variant="dot" color="gray">Tạm tính</Badge>
                )}
              </Table.Td>
              <Table.Td>{fmtDate(g.computedAt)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function StudentDetailPanel({
  studentId,
  onBack,
}: {
  studentId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<DetailT | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    trpc.student.detail
      .query({ studentId })
      .then((d) => {
        setDetail(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Lỗi tải chi tiết học sinh');
        setLoading(false);
        notifyError(e, 'Không tải được chi tiết học sinh');
      });
  }, [studentId]);

  return (
    <Stack>
      <Group>
        <ActionIcon variant="subtle" onClick={onBack} title="Quay lại danh sách">
          <IconArrowLeft size={18} />
        </ActionIcon>
        {detail ? (
          <Title order={5}>{detail.fullName} — {detail.studentCode}</Title>
        ) : (
          <Skeleton height={24} width={200} />
        )}
      </Group>

      {loading && (
        <Stack gap="xs">
          <Skeleton height={12} radius="xl" />
          <Skeleton height={12} radius="xl" />
          <Skeleton height={12} radius="xl" width="70%" />
        </Stack>
      )}

      {error && !loading && (
        <Text c="red" size="sm">{error}</Text>
      )}

      {detail && !loading && (
        <Tabs defaultValue="info" variant="outline">
          <Tabs.List>
            <Tabs.Tab value="info">Thông tin HS</Tabs.Tab>
            <Tabs.Tab value="guardians">
              Phụ huynh {detail.guardians.length > 0 && `(${detail.guardians.length})`}
            </Tabs.Tab>
            <Tabs.Tab value="enrollments">
              Ghi danh {detail.enrollments.length > 0 && `(${detail.enrollments.length})`}
            </Tabs.Tab>
            <Tabs.Tab value="opportunities">Cơ hội</Tabs.Tab>
            <Tabs.Tab value="receipts">
              Thanh toán {detail.receipts.length > 0 && `(${detail.receipts.length})`}
            </Tabs.Tab>
            <Tabs.Tab value="grades">
              Điểm {detail.finalGrades.length > 0 && `(${detail.finalGrades.length})`}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="info" pt="md">
            <InfoTab s={detail} />
          </Tabs.Panel>

          <Tabs.Panel value="guardians" pt="md">
            <GuardiansTab s={detail} />
          </Tabs.Panel>

          <Tabs.Panel value="enrollments" pt="md">
            <EnrollmentsTab s={detail} />
          </Tabs.Panel>

          <Tabs.Panel value="opportunities" pt="md">
            <OpportunitiesTab s={detail} />
          </Tabs.Panel>

          <Tabs.Panel value="receipts" pt="md">
            <ReceiptsTab s={detail} />
          </Tabs.Panel>

          <Tabs.Panel value="grades" pt="md">
            <GradesTab s={detail} />
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}
