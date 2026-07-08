import React, { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess, StatusBadge, InitialsAvatar } from '@cmc/ui';
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';

type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type ParentT = Awaited<ReturnType<typeof trpc.guardian.parentList.query>>[number];
type GuardianT = Awaited<ReturnType<typeof trpc.guardian.listForStudent.query>>[number];
type LinkRequestT = Awaited<ReturnType<typeof trpc.guardian.linkRequestList.query>>[number];

const RELATIONS = [
  { value: 'father', label: 'Bố' },
  { value: 'mother', label: 'Mẹ' },
  { value: 'guardian', label: 'Người giám hộ' },
];
const RELATION_LABEL: Record<string, string> = { father: 'Bố', mother: 'Mẹ', guardian: 'Người giám hộ' };

/**
 * Staff review queue for parent self-link requests (anti-takeover design — approve is the only
 * path that creates a Guardian row for a parent-initiated request). Ambiguous rows (no
 * matched student resolved at request time) carry `candidates`; staff must pick one explicitly.
 */
function LinkRequestQueue() {
  const [requests, setRequests] = useState<LinkRequestT[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    trpc.guardian.linkRequestList
      .query()
      .then(setRequests)
      .catch((e) => notifyError(e, 'Không tải được hàng chờ yêu cầu liên kết'));
  }, []);
  useEffect(load, [load]);

  async function review(r: LinkRequestT, decision: 'approved' | 'rejected') {
    const studentId = r.matchedStudentId ?? picked[r.id];
    if (decision === 'approved' && !studentId) {
      notifyError(new Error('Chọn học sinh trước khi duyệt.'), 'Thiếu học sinh');
      return;
    }
    setBusyId(r.id);
    try {
      await trpc.guardian.linkRequestReview.mutate({
        id: r.id,
        decision,
        studentId: studentId ?? undefined,
        relation: 'guardian',
      });
      notifySuccess(decision === 'approved' ? 'Đã duyệt liên kết' : 'Đã từ chối yêu cầu');
      load();
    } catch (e) {
      notifyError(e, 'Xử lý yêu cầu thất bại');
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) return null;

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">
        Yêu cầu tự liên kết từ phụ huynh ({requests.length})
      </Text>
      <Stack gap="sm">
        {requests.map((r) => (
          <Group key={r.id} align="flex-end" wrap="nowrap" gap="sm">
            <div style={{ flex: 1 }}>
              <Group gap={6} wrap="nowrap">
                <InitialsAvatar name={r.requestedBy.displayName} size={22} />
                <Text size="sm" fw={600}>{r.requestedBy.displayName}</Text>
              </Group>
              <Text size="sm" c="dimmed">
                {r.requestedBy.email ?? r.requestedBy.phone ?? '—'} · Tra cứu: {r.studentCode ?? r.studentPhone}
              </Text>
              {r.matchedStudentId ? (
                <Box mt={4}>
                  <StatusBadge status="matched" label="Đã khớp 1 học sinh" tone="active" pill />
                </Box>
              ) : r.candidates.length > 0 ? (
                <Select
                  mt={4}
                  size="xs"
                  w={300}
                  placeholder="Chọn học sinh trùng khớp"
                  data={r.candidates.map((c) => ({ value: c.id, label: `${c.studentCode} — ${c.fullName}` }))}
                  value={picked[r.id] ?? null}
                  onChange={(v) => setPicked((m) => ({ ...m, [r.id]: v ?? '' }))}
                />
              ) : (
                <Box mt={4}>
                  <StatusBadge status="unmatched" label="Không tìm thấy học sinh khớp" tone="inactive" pill />
                </Box>
              )}
            </div>
            <Button
              size="compact-sm"
              variant="filled"
              radius={9999}
              loading={busyId === r.id}
              disabled={busyId !== null}
              onClick={() => review(r, 'approved')}
            >
              Duyệt
            </Button>
            <Button
              size="compact-sm"
              variant="subtle"
              color="red"
              radius={9999}
              loading={busyId === r.id}
              disabled={busyId !== null}
              onClick={() => review(r, 'rejected')}
            >
              Từ chối
            </Button>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

/**
 * Family login (parent phone + Cmc2026@) reset — the PRIMARY student-login credential
 * (decision 0033). Confirm-only; no input field since the password is a known constant.
 */
function ParentPasswordResetCard({ parents }: { parents: ParentT[] }) {
  const [parentId, setParentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function reset() {
    if (!parentId) return;
    if (!confirm('Đặt lại mật khẩu đăng nhập gia đình về mặc định. Tiếp tục?')) return;
    setBusy(true);
    setDone(false);
    try {
      await trpc.guardian.resetFamilyPassword.mutate({ parentAccountId: parentId });
      notifySuccess('Mật khẩu đã đặt lại về Cmc2026@');
      setDone(true);
    } catch (e) {
      notifyError(e, 'Đặt lại mật khẩu thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">
        Đặt lại mật khẩu đăng nhập gia đình
      </Text>
      <Text size="xs" c="dimmed" mb="sm">
        Học sinh đăng nhập bằng SĐT phụ huynh + mật khẩu chuẩn. Đặt lại ở đây khi phụ huynh quên
        mật khẩu đã đổi.
      </Text>
      <Group align="flex-end">
        <Select
          label="Phụ huynh"
          searchable
          w={320}
          placeholder="Chọn phụ huynh"
          disabled={busy}
          data={parents.map((p) => ({ value: p.id, label: `${p.displayName} (${p.phone ?? p.email ?? ''})` }))}
          value={parentId}
          onChange={(v) => { setParentId(v); setDone(false); }}
        />
        <Button variant="filled" radius={9999} loading={busy} disabled={!parentId} onClick={reset}>
          Đặt lại mật khẩu
        </Button>
      </Group>
      {done && (
        <Text size="xs" c="dimmed" mt="xs">Mật khẩu đã đặt lại về Cmc2026@.</Text>
      )}
    </Card>
  );
}

/** Sửa thông tin phụ huynh (tên/email/SĐT) — gọi guardian.parentUpdate (gate [KD,DT]). */
function ParentEditCard({ parents, onSaved }: { parents: ParentT[]; onSaved: () => void }) {
  const [parentId, setParentId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  function pick(id: string | null) {
    setParentId(id);
    const p = parents.find((x) => x.id === id);
    setName(p?.displayName ?? '');
    setEmail(p?.email ?? '');
    setPhone(p?.phone ?? '');
  }

  async function save() {
    if (!parentId || !name.trim()) {
      notifyError(new Error('Chọn phụ huynh và nhập tên.'), 'Thiếu thông tin');
      return;
    }
    setBusy(true);
    try {
      await trpc.guardian.parentUpdate.mutate({
        id: parentId,
        displayName: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      notifySuccess('Đã cập nhật phụ huynh');
      onSaved();
    } catch (e) {
      notifyError(e, 'Cập nhật phụ huynh thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">
        Sửa thông tin phụ huynh
      </Text>
      <Stack gap="sm">
        <Select
          label="Phụ huynh"
          searchable
          placeholder="Chọn phụ huynh"
          disabled={busy}
          data={parents.map((p) => ({ value: p.id, label: `${p.displayName} (${p.phone ?? p.email ?? ''})` }))}
          value={parentId}
          onChange={pick}
        />
        {parentId && (
          <>
            <TextInput label="Họ tên" value={name} onChange={(e) => setName(e.currentTarget.value)} disabled={busy} />
            <Group grow>
              <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} disabled={busy} />
              <TextInput label="SĐT" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} disabled={busy} />
            </Group>
            <Group justify="flex-end">
              <Button variant="filled" radius={9999} loading={busy} onClick={save}>
                Lưu thay đổi
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );
}

export function GuardiansPanel() {
  const [students, setStudents] = useState<StudentT[]>([]);
  const [parents, setParents] = useState<ParentT[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [guardians, setGuardians] = useState<GuardianT[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [relation, setRelation] = useState<string>('guardian');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const loadParents = useCallback(() => {
    trpc.guardian.parentList
      .query()
      .then(setParents)
      .catch((e) => notifyError(e, 'Không tải được danh sách phụ huynh'));
  }, []);
  useEffect(() => {
    trpc.student.list
      .query()
      .then(setStudents)
      .catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));
    loadParents();
  }, [loadParents]);

  const loadGuardians = useCallback(() => {
    if (!studentId) {
      setGuardians([]);
      return;
    }
    trpc.guardian.listForStudent
      .query({ studentId })
      .then(setGuardians)
      .catch((e) => notifyError(e, 'Không tải được phụ huynh của học sinh'));
  }, [studentId]);
  useEffect(loadGuardians, [loadGuardians]);

  async function createParent() {
    if (!name.trim() || !password.trim() || (!email.trim() && !phone.trim())) {
      notifyError(new Error('Nhập tên, mật khẩu và email hoặc SĐT.'), 'Thông tin chưa đủ');
      return;
    }
    setBusy(true);
    try {
      const p = await trpc.guardian.parentCreate.mutate({
        displayName: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password: password.trim(),
      });
      notifySuccess(`Đã tạo phụ huynh ${p.displayName}`);
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');
      loadParents();
      setParentId(p.id);
    } catch (e) {
      notifyError(e, 'Tạo phụ huynh thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    if (!studentId || !parentId) {
      notifyError(new Error('Chọn học sinh và phụ huynh.'), 'Liên kết thất bại');
      return;
    }
    try {
      await trpc.guardian.link.mutate({
        parentAccountId: parentId,
        studentId,
        relation: relation as 'father' | 'mother' | 'guardian',
      });
      notifySuccess('Đã liên kết phụ huynh với học sinh');
      loadGuardians();
    } catch (e) {
      notifyError(e, 'Liên kết thất bại');
    }
  }

  async function unlink(id: string) {
    try {
      await trpc.guardian.unlink.mutate({ id });
      notifySuccess('Đã gỡ liên kết');
      loadGuardians();
    } catch (e) {
      notifyError(e, 'Gỡ liên kết thất bại');
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
      <LinkRequestQueue />

      <ParentEditCard parents={parents} onSaved={loadParents} />
      <ParentPasswordResetCard parents={parents} />

      <Select
        label="Học sinh"
        w={360}
        searchable
        placeholder={students.length ? 'Chọn học sinh' : 'Chưa có học sinh'}
        data={students.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
        value={studentId}
        onChange={setStudentId}
      />

      {studentId && (
        <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
          <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">
            Phụ huynh của học sinh
          </Text>
          {guardians.length === 0 ? (
            <Text c="dimmed" size="sm">
              Chưa liên kết phụ huynh nào.
            </Text>
          ) : (
            <Table striped highlightOnHover withTableBorder={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={TH_STYLE}>Phụ huynh</Table.Th>
                  <Table.Th style={TH_STYLE}>Liên hệ</Table.Th>
                  <Table.Th style={TH_STYLE}>Quan hệ</Table.Th>
                  <Table.Th style={{ ...TH_STYLE, width: 80 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {guardians.map((g) => (
                  <Table.Tr key={g.id}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <InitialsAvatar name={g.parent.displayName} size={22} />
                        <Text size="sm">{g.parent.displayName}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>{g.parent.email ?? g.parent.phone ?? '—'}</Text></Table.Td>
                    <Table.Td>
                      <Badge variant="light" radius="xl" size="sm">{RELATION_LABEL[g.relation] ?? g.relation}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Button size="compact-xs" variant="subtle" color="red" onClick={() => unlink(g.id)}>
                        Gỡ
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Group align="flex-end" mt="md">
            <Select
              label="Liên kết phụ huynh có sẵn"
              searchable
              w={280}
              placeholder="Chọn phụ huynh"
              data={parents.map((p) => ({ value: p.id, label: `${p.displayName} (${p.email ?? p.phone ?? ''})` }))}
              value={parentId}
              onChange={setParentId}
            />
            <Select label="Quan hệ" w={150} data={RELATIONS} value={relation} onChange={(v) => v && setRelation(v)} allowDeselect={false} />
            <Button variant="filled" radius={9999} onClick={link}>Liên kết</Button>
          </Group>
        </Card>
      )}

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} style={{ color: 'var(--cmc-text)' }} mb="md">
          Tạo tài khoản phụ huynh mới
        </Text>
        <Group grow align="flex-end">
          <TextInput label="Họ tên" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        </Group>
        <Group grow align="flex-end" mt="sm">
          <TextInput label="Số điện thoại" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
          <PasswordInput label="Mật khẩu" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        </Group>
        <Group mt="md">
          <Button variant="filled" radius={9999} onClick={createParent} loading={busy}>
            Tạo phụ huynh
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}
