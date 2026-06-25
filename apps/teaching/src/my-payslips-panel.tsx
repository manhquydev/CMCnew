import { useEffect, useState } from 'react';
import { trpc, notifyError } from '@cmc/ui';
import { Badge, Card, Stack, Table, Text, Title } from '@mantine/core';

type MyPayslip = Awaited<ReturnType<typeof trpc.payroll.myPayslips.query>>[number];

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

const ST: Record<string, { label: string; color: string }> = {
  finalized: { label: 'Đã chốt', color: 'blue' },
  paid: { label: 'Đã trả', color: 'teal' },
};

export function MyPayslipsPanel() {
  const [slips, setSlips] = useState<MyPayslip[]>([]);

  useEffect(() => {
    trpc.payroll.myPayslips
      .query()
      .then(setSlips)
      .catch((e) => notifyError(e, 'Không tải được phiếu lương của bạn'));
  }, []);

  return (
    <Stack>
      <Card withBorder>
        <Title order={5} mb="sm">
          Phiếu lương của tôi
        </Title>
        {slips.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có phiếu lương.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Kỳ</Table.Th>
                <Table.Th>Lương gộp</Table.Th>
                <Table.Th>Thuế TNCN</Table.Th>
                <Table.Th>Thực lĩnh</Table.Th>
                <Table.Th>Trạng thái</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {slips.map((s) => {
                const st = ST[s.status] ?? { label: s.status, color: 'gray' };
                return (
                  <Table.Tr key={s.id}>
                    <Table.Td>{s.periodKey}</Table.Td>
                    <Table.Td>{vnd(s.grossIncome)}</Table.Td>
                    <Table.Td>{vnd(s.pitAmount)}</Table.Td>
                    <Table.Td>{vnd(s.netIncome)}</Table.Td>
                    <Table.Td>
                      <Badge color={st.color}>{st.label}</Badge>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
