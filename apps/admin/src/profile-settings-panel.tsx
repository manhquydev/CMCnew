// Profile/settings page (finding #19) — reachable via the avatar dropdown menu, not the sidebar.
// Bespoke form, NOT RecordDetailPanel (see phase-01 finding #3): RecordDetailField has no
// password field type, and RecordDetailPanel's save model is one full-form onSave(data) patch —
// "change login method" and "log out" are actions, not editable field state, so neither fits the
// field-grid primitive.
//
// Scope is intentionally bounded by what the backend actually supports for a staff member's OWN
// account:
//   - Personal info is READ-ONLY display. `auth.me` (useSession) carries no email/phone, and
//     `user.updateProfile` is super_admin-only (apps/api/src/routers/user.ts) — there is no
//     self-service edit endpoint, so this section never claims to let you edit what it can't save.
//   - Login method is an informational notice, not a change-password form. `user.setPassword` is
//     superAdminProcedure only (decision 0031: STAFF_PASSWORD_LOGIN runs permanently alongside
//     SSO, but a staff member cannot reset their own password — only an admin can). Building a
//     "change password" form with nowhere to submit it would be fake UI.
//   - Notification preference is a genuine client-side browser Notification permission toggle,
//     persisted to localStorage — no backend exists for server-side notification preferences
//     (YAGNI), so this stays a real, working, narrowly-scoped feature rather than fake toggles
//     that silently do nothing.
//   - Logout reuses the same `logout()` already wired in shell.tsx.

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Skeleton, Stack, Switch, Text, Title } from '@mantine/core';
import { IconLogout } from '@tabler/icons-react';
import { trpc, useSession, notifyError, InitialsAvatar, StatusBadge } from '@cmc/ui';
import { ROLE_LABEL } from '@cmc/auth/permissions';

const NOTIF_PREF_KEY = 'notif-pref:desktop';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];

function readNotifPref(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(NOTIF_PREF_KEY) === 'true';
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card radius="sm" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
      <Stack gap="sm">
        <Group gap="xs" wrap="nowrap" align="center">
          <span
            aria-hidden="true"
            style={{ display: 'inline-block', width: 4, height: 20, borderRadius: 2, background: 'var(--cmc-brand)' }}
          />
          <Text fw={600} style={{ fontSize: 'var(--cmc-form-group-title)', color: 'var(--cmc-text)' }}>{title}</Text>
        </Group>
        {children}
      </Stack>
    </Card>
  );
}

/** Two-column read-only field row — matches @cmc/ui's record-detail.tsx label conventions
 *  (160px right-aligned label) used across the other detail panels. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group wrap="nowrap" gap="md" align="center">
      <Text
        size="sm"
        style={{
          width: 'var(--cmc-form-label-w)',
          minWidth: 'var(--cmc-form-label-w)',
          flexShrink: 0,
          textAlign: 'right',
          fontSize: 'var(--cmc-form-label-font)',
          color: 'var(--cmc-form-label-color)',
        }}
      >
        {label}
      </Text>
      <Text size="sm" style={{ flex: 1, minWidth: 0 }}>{value}</Text>
    </Group>
  );
}

export function ProfileSettingsPanel() {
  const { me, logout } = useSession();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(me.facilityIds.length > 0);
  const [notifEnabled, setNotifEnabled] = useState(readNotifPref);
  const [notifBusy, setNotifBusy] = useState(false);

  // facility.list is protectedProcedure (RLS-scoped to the caller's own facilities) — every
  // staff member can resolve their own facility names, unlike user.list which is permission-gated.
  useEffect(() => {
    if (me.facilityIds.length === 0) return;
    setLoadingFacilities(true);
    trpc.facility.list.query()
      .then(setFacilities)
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'))
      .finally(() => setLoadingFacilities(false));
  }, [me.facilityIds.length]);

  const myFacilities = facilities.filter((f) => me.facilityIds.includes(f.id));

  async function toggleNotif(next: boolean) {
    setNotifBusy(true);
    try {
      if (next && typeof Notification !== 'undefined') {
        if (Notification.permission === 'denied') {
          // Browser permission was denied outside this app (or previously) — the switch would show
          // "on" while notifications are silently dropped. Don't persist a state we can't honor.
          notifyError(
            new Error('Trình duyệt đã chặn thông báo'),
            'Vào cài đặt trình duyệt để cho phép thông báo cho trang này, sau đó thử lại.',
          );
          setNotifEnabled(false);
          try { localStorage.setItem(NOTIF_PREF_KEY, 'false'); } catch { /* ignore quota/private mode */ }
          return;
        }
        if (Notification.permission === 'default') {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') {
            // User declined the browser permission — don't persist an "enabled" state we can't honor.
            setNotifEnabled(false);
            try { localStorage.setItem(NOTIF_PREF_KEY, 'false'); } catch { /* ignore quota/private mode */ }
            return;
          }
        }
      }
      setNotifEnabled(next);
      try { localStorage.setItem(NOTIF_PREF_KEY, String(next)); } catch { /* ignore quota/private mode */ }
    } finally {
      setNotifBusy(false);
    }
  }

  const notifSupported = typeof Notification !== 'undefined';

  return (
    <Stack>
      <Group gap="md" wrap="nowrap" align="center">
        <InitialsAvatar name={me.displayName} size={64} />
        <div>
          <Title order={4} style={{ color: 'var(--cmc-text)' }}>Hồ sơ cá nhân</Title>
          <Text size="sm" c="dimmed">{me.displayName}</Text>
        </div>
      </Group>

      <SectionCard title="Thông tin cá nhân">
        <Field label="Tên hiển thị" value={me.displayName} />
        <div>
          <Text size="sm" c="dimmed" mb={4}>Vai trò</Text>
          <Group gap="xs">
            {me.roles.map((r) => (
              <StatusBadge
                key={r}
                status={r}
                tone="info"
                pill
                label={`${ROLE_LABEL[r] ?? r}${r === me.primaryRole ? ' ★' : ''}`}
              />
            ))}
          </Group>
        </div>
        <div>
          <Text size="sm" c="dimmed" mb={4}>Cơ sở được truy cập</Text>
          {loadingFacilities ? (
            <Skeleton height={20} width={160} radius="sm" />
          ) : myFacilities.length === 0 ? (
            <Text size="sm" c="dimmed">—</Text>
          ) : (
            <Group gap="xs">
              {myFacilities.map((f) => (
                <Badge key={f.id} variant="outline" radius="xl">{f.code} — {f.name}</Badge>
              ))}
            </Group>
          )}
        </div>
        <Text size="xs" c="dimmed">
          Email và số điện thoại được quản lý bởi quản trị viên — liên hệ quản trị viên để cập nhật.
        </Text>
      </SectionCard>

      <SectionCard title="Đăng nhập">
        <Text size="sm">
          Tài khoản đăng nhập bằng SSO Microsoft (tài khoản CMC EDU). Một số tài khoản có thể đăng
          nhập thêm bằng mật khẩu do quản trị viên cấp.
        </Text>
        <Text size="xs" c="dimmed">
          Việc đặt/đổi mật khẩu do quản trị viên thực hiện — không có thao tác tự đổi mật khẩu
          trong trang này.
        </Text>
      </SectionCard>

      <SectionCard title="Thông báo">
        {notifSupported ? (
          <Switch
            label="Cho phép thông báo trên trình duyệt"
            description="Yêu cầu quyền thông báo của trình duyệt cho ứng dụng này."
            checked={notifEnabled}
            disabled={notifBusy}
            onChange={(e) => toggleNotif(e.currentTarget.checked)}
          />
        ) : (
          <Text size="sm" c="dimmed">Trình duyệt hiện tại không hỗ trợ thông báo.</Text>
        )}
      </SectionCard>

      <SectionCard title="Phiên đăng nhập">
        <Text size="sm" c="dimmed">Đăng xuất khỏi phiên làm việc hiện tại trên thiết bị này.</Text>
        <Group>
          <Button variant="light" color="red" leftSection={<IconLogout size={14} />} onClick={logout}>
            Đăng xuất
          </Button>
        </Group>
      </SectionCard>
    </Stack>
  );
}
