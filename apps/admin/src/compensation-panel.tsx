import { useCallback, useEffect, useState } from 'react';
import { trpc } from '@cmc/ui';
import { Alert, Badge, Button, Card, Group, JsonInput, Stack, Table, Text, TextInput, Title } from '@mantine/core';

// Minimal shape the list view needs — avoids inferring the deep params JSON type (TS2589).
type Policy = { id: string; effectiveFrom: string | Date; note: string | null; createdAt: string | Date; params: unknown };

// The compensation procedures carry a deep Zod-inferred params type that blows tsc's instantiation
// depth (TS2589) at every call site. Re-type the client surface loosely; the SERVER still validates.
const compensationApi = trpc.compensation as unknown as {
  list: { query: () => Promise<Policy[]> };
  defaults: { query: () => Promise<unknown> };
  create: { mutate: (input: { effectiveFrom: string; params: unknown; note?: string }) => Promise<unknown> };
};

const todayISO = () => new Date().toISOString().slice(0, 10);

export function CompensationConfigPanel() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [paramsText, setParamsText] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadList = useCallback(() => {
    compensationApi.list.query().then(setPolicies).catch(() => setPolicies([]));
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
    setMsg(null);
    try {
      const d = await compensationApi.defaults.query();
      setParamsText(JSON.stringify(d, null, 2));
      setMsg({ kind: 'ok', text: 'Đã nạp tham số mặc định (PA2 + Đào tạo). Sửa rồi tạo phiên bản mới.' });
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi: ' + (e instanceof Error ? e.message : '') });
    }
  }

  async function createVersion() {
    setMsg(null);
    let params: unknown;
    try {
      params = JSON.parse(paramsText);
    } catch {
      return setMsg({ kind: 'err', text: 'JSON không hợp lệ — kiểm tra lại.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      return setMsg({ kind: 'err', text: 'Ngày hiệu lực phải dạng YYYY-MM-DD.' });
    }
    setBusy(true);
    try {
      // Server re-validates params against the Zod schema; an invalid shape throws here.
      await compensationApi.create.mutate({ effectiveFrom, params: params as never, note: note || undefined });
      setMsg({ kind: 'ok', text: `Đã tạo chính sách hiệu lực từ ${effectiveFrom} (áp dụng kỳ sau, không đổi lương đã chốt).` });
      setNote('');
      loadList();
    } catch (e) {
      setMsg({ kind: 'err', text: 'Lỗi (tham số không hợp lệ?): ' + (e instanceof Error ? e.message : '') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack>
      <Alert color="blue" variant="light">
        Cơ cấu thu nhập (bậc %, hoa hồng, KPI, vượt giờ, thuế). Mỗi lần lưu tạo <b>một phiên bản có ngày
        hiệu lực</b>; phiếu lương khi tính dùng bản hiệu lực tại kỳ đó. Sửa ở đây <b>chỉ áp dụng về sau</b> —
        lương các kỳ đã chốt không đổi. Chỉ super_admin truy cập.
      </Alert>

      {msg && (
        <Alert color={msg.kind === 'ok' ? 'green' : 'red'} withCloseButton onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      <Card withBorder>
        <Title order={6} mb="sm">Tạo phiên bản chính sách mới</Title>
        <Group grow mb="sm" align="flex-end">
          <TextInput label="Hiệu lực từ" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.currentTarget.value)} placeholder="YYYY-MM-DD" />
          <TextInput label="Ghi chú" value={note} onChange={(e) => setNote(e.currentTarget.value)} placeholder="vd: điều chỉnh hoa hồng Q3" />
          <Button variant="default" onClick={loadDefaults}>Nạp mặc định</Button>
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
        <Group justify="flex-end" mt="sm">
          <Button onClick={createVersion} loading={busy}>Tạo phiên bản</Button>
        </Group>
      </Card>

      <Card withBorder>
        <Title order={6} mb="sm">Các phiên bản đã ban hành</Title>
        {policies.length === 0 ? (
          <Text c="dimmed" size="sm">Chưa có phiên bản nào — hệ thống đang dùng tham số mặc định (PA2 + Đào tạo).</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Hiệu lực từ</Table.Th><Table.Th>Ghi chú</Table.Th><Table.Th>Tạo lúc</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {policies.map((p, i) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    <Group gap="xs">
                      {new Date(p.effectiveFrom).toLocaleDateString('vi-VN')}
                      {i === 0 && <Badge size="xs" color="teal">mới nhất</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td>{p.note ?? ''}</Table.Td>
                  <Table.Td>{new Date(p.createdAt).toLocaleString('vi-VN')}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
