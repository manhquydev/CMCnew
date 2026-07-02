import React, { useCallback, useEffect, useState } from 'react';
import { notifyError, notifySuccess } from '@cmc/ui';
import { Badge, Button, Card, Group, JsonInput, Stack, Table, Text, TextInput } from '@mantine/core';
import { compensationApi, type CompensationPolicyRow } from './shallow-trpc';

const todayISO = () => new Date().toISOString().slice(0, 10);

export function CompensationConfigPanel() {
  const [policies, setPolicies] = useState<CompensationPolicyRow[]>([]);
  const [paramsText, setParamsText] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => {
    compensationApi.list
      .query()
      .then(setPolicies)
      .catch((e) => notifyError(e, 'Không tải được danh sách chính sách'));
  }, []);
  useEffect(loadList, [loadList]);

  // Prefill the editor from the latest version's params, else the seed defaults.
  useEffect(() => {
    (async () => {
      try {
        const list = await compensationApi.list.query();
        const base = list[0]?.params ?? (await compensationApi.defaults.query());
        setParamsText(JSON.stringify(base, null, 2));
      } catch {
        /* leave empty */
      }
    })();
  }, []);

  async function loadDefaults() {
    try {
      const d = await compensationApi.defaults.query();
      setParamsText(JSON.stringify(d, null, 2));
      notifySuccess('Đã nạp tham số mặc định (PA2 + Đào tạo). Sửa rồi tạo phiên bản mới.');
    } catch (e) {
      notifyError(e, 'Không tải được tham số mặc định');
    }
  }

  async function createVersion() {
    let params: unknown;
    try {
      params = JSON.parse(paramsText);
    } catch {
      notifyError('JSON không hợp lệ — kiểm tra lại.', 'Lỗi định dạng');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      notifyError('Ngày hiệu lực phải dạng YYYY-MM-DD.', 'Lỗi ngày');
      return;
    }
    setBusy(true);
    try {
      // Server re-validates params against the Zod schema; an invalid shape throws here.
      await compensationApi.create.mutate({ effectiveFrom, params, note: note || undefined });
      notifySuccess(`Đã tạo chính sách hiệu lực từ ${effectiveFrom} (áp dụng kỳ sau, không đổi lương đã chốt).`);
      setNote('');
      loadList();
    } catch (e) {
      notifyError(e, 'Tạo chính sách thất bại (tham số không hợp lệ?)');
    } finally {
      setBusy(false);
    }
  }

  const TH_STYLE: React.CSSProperties = {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--cmc-text-muted)',
    fontWeight: 600,
  };

  return (
    <Stack>
      <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)', backgroundColor: 'var(--cmc-info-bg)' }}>
        <Text size="sm" style={{ color: 'var(--cmc-info-text)' }}>
          Cơ cấu thu nhập (bậc %, hoa hồng, KPI, vượt giờ, thuế). Mỗi lần lưu tạo <b>một phiên bản có ngày
          hiệu lực</b>; phiếu lương khi tính dùng bản hiệu lực tại kỳ đó. Sửa ở đây <b>chỉ áp dụng về sau</b> —
          lương các kỳ đã chốt không đổi. Chỉ super_admin truy cập.
        </Text>
      </Card>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">Tạo phiên bản chính sách mới</Text>
        <Group grow mb="sm" align="flex-end">
          <TextInput label="Hiệu lực từ" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.currentTarget.value)} placeholder="YYYY-MM-DD" />
          <TextInput label="Ghi chú" value={note} onChange={(e) => setNote(e.currentTarget.value)} placeholder="vd: điều chỉnh hoa hồng Q3" />
          <Button variant="subtle" onClick={loadDefaults}>Nạp mặc định</Button>
        </Group>
        <JsonInput
          label="Tham số (JSON)"
          value={paramsText}
          onChange={setParamsText}
          formatOnBlur
          autosize
          minRows={12}
          maxRows={28}
          validationError="JSON không hợp lệ"
          styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="filled" radius={9999} onClick={createVersion} loading={busy}>Tạo phiên bản</Button>
        </Group>
      </Card>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">Các phiên bản đã ban hành</Text>
        {policies.length === 0 ? (
          <Text c="dimmed" size="sm">Chưa có phiên bản nào — hệ thống đang dùng tham số mặc định (PA2 + Đào tạo).</Text>
        ) : (
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Hiệu lực từ</Table.Th>
                <Table.Th style={TH_STYLE}>Ghi chú</Table.Th>
                <Table.Th style={TH_STYLE}>Tạo lúc</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {policies.map((p, i) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm">{new Date(p.effectiveFrom).toLocaleDateString('vi-VN')}</Text>
                      {i === 0 && <Badge size="xs" color="teal" variant="light" radius="xl">mới nhất</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm">{p.note ?? ''}</Text></Table.Td>
                  <Table.Td><Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>{new Date(p.createdAt).toLocaleString('vi-VN')}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
