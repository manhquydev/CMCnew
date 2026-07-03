import { useCallback, useEffect, useMemo, useState } from 'react';
import { trpc, notifyError, EmptyState, InitialsAvatar } from '@cmc/ui';
import { Button, Card, Group, Skeleton, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconAddressBook } from '@tabler/icons-react';

type Contact = Awaited<ReturnType<typeof trpc.crm.contactList.query>>[number];

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function ContactDirectoryPanel({
  facilityId,
  refreshKey,
}: {
  facilityId: number | null;
  /** Bump this (e.g. after creating a contact/opportunity elsewhere) to force a reload. */
  refreshKey?: number;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!facilityId) return;
    setLoading(true);
    setError(null);
    trpc.crm.contactList
      .query({ facilityId })
      .then(setContacts)
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Không tải được danh bạ');
        notifyError(e, 'Không tải được danh bạ');
      })
      .finally(() => setLoading(false));
  }, [facilityId]);

  useEffect(load, [load, refreshKey]);

  const filtered = useMemo(() => {
    const needle = normalizeSearch(query);
    if (!needle) return contacts;
    return contacts.filter((contact) =>
      normalizeSearch(`${contact.fullName} ${contact.phone} ${contact.email ?? ''}`).includes(needle),
    );
  }, [contacts, query]);

  return (
    <Card withBorder>
      <Group justify="space-between" align="flex-end" mb="sm">
        <Stack gap={2}>
          <Title order={5}>Danh bạ liên hệ</Title>
          <Text size="sm" c="dimmed">
            {filtered.length}/{contacts.length} liên hệ
          </Text>
        </Stack>
        <Group align="flex-end">
          <TextInput
            label="Tìm theo tên hoặc SĐT"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={260}
          />
          <Button variant="subtle" onClick={load} disabled={!facilityId || loading}>
            Làm mới
          </Button>
        </Group>
      </Group>

      {loading ? (
        <Skeleton height={120} radius="md" />
      ) : error ? (
        <Stack gap="xs" align="center" py="md">
          <Text size="sm" c="red">
            {error}
          </Text>
          <Button size="xs" variant="subtle" onClick={load}>
            Thử lại
          </Button>
        </Stack>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<IconAddressBook size={28} stroke={1.5} />}
          title={query ? 'Không tìm thấy liên hệ' : 'Chưa có liên hệ'}
          description="Danh bạ hiển thị các liên hệ CRM của cơ sở đang chọn."
        />
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Liên hệ</Table.Th>
                <Table.Th>SĐT</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Nguồn</Table.Th>
                <Table.Th>Chiến dịch</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((contact) => (
                <Table.Tr key={contact.id}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <InitialsAvatar name={contact.fullName} size={22} />
                      <Text size="sm" lineClamp={1}>{contact.fullName}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>{contact.phone}</Table.Td>
                  <Table.Td>{contact.email ?? '—'}</Table.Td>
                  <Table.Td>{contact.medium || contact.source || '—'}</Table.Td>
                  <Table.Td>{contact.campaign ?? '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}
