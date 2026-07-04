import React, { useEffect, useState } from 'react';
import { trpc, notifyError, StatusBadge, type StatusDef } from '@cmc/ui';
import { Card, Stack, Table, Text, Title } from '@mantine/core';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

type MyPayslip = Awaited<ReturnType<typeof trpc.payroll.myPayslips.query>>[number];

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

// Preserves original color semantics: blue→info, teal→active.
const ST: Record<string, StatusDef> = {
  finalized: { label: 'Đã chốt', tone: 'info' },
  paid: { label: 'Đã trả', tone: 'active' },
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
                <Table.Th style={TH_STYLE}>Kỳ</Table.Th>
                <Table.Th style={TH_STYLE}>Lương gộp</Table.Th>
                <Table.Th style={TH_STYLE}>Thuế TNCN</Table.Th>
                <Table.Th style={TH_STYLE}>Phạt công</Table.Th>
                <Table.Th style={TH_STYLE}>Thực lĩnh</Table.Th>
                <Table.Th style={TH_STYLE}>Trạng thái</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {slips.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>{s.periodKey}</Table.Td>
                  <Table.Td>{vnd(s.grossIncome)}</Table.Td>
                  <Table.Td>{vnd(s.pitAmount)}</Table.Td>
                  <Table.Td>{vnd(s.attendanceDeductionOverride ?? s.attendanceDeduction ?? 0)}</Table.Td>
                  <Table.Td>{vnd(s.netIncome)}</Table.Td>
                  <Table.Td>
                    <StatusBadge status={s.status} map={ST} pill />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
