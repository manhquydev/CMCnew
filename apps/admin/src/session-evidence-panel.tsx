import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  API_URL,
  notifyError,
  notifySuccess,
  trpc,
  uploadSessionPhoto,
} from '@cmc/ui';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  Image,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
} from '@mantine/core';
import { IconPhoto, IconTrash } from '@tabler/icons-react';

type SessionEvidenceDetail = Awaited<ReturnType<typeof trpc.sessionEvidence.detailForStaff.query>>;
type CommentTemplate = Awaited<ReturnType<typeof trpc.sessionEvidence.commentTemplate.query>>;
type ParticipationValue = CommentTemplate['participation'][number];
type StrengthValue = CommentTemplate['strength'][number];
type NeedsImprovementValue = CommentTemplate['needsImprovement'][number];

type CommentDraft = {
  studentId: string;
  participation: ParticipationValue | null;
  strength: StrengthValue | null;
  needsImprovement: NeedsImprovementValue | null;
  teacherNote: string;
};

type PhotoDraft = {
  ref: string;
};

function hasCommentValue(row: CommentDraft): boolean {
  return Boolean(row.participation || row.strength || row.needsImprovement || row.teacherNote.trim());
}

function photoUrl(ref: string): string {
  return `${API_URL}/files/session-photo/${ref}`;
}

export function SessionEvidencePanel({
  classSessionId,
  enabled,
}: {
  classSessionId: string;
  enabled: boolean;
}) {
  const [detail, setDetail] = useState<SessionEvidenceDetail | null>(null);
  const [template, setTemplate] = useState<CommentTemplate | null>(null);
  const [summary, setSummary] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [comments, setComments] = useState<Record<string, CommentDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const roster = useMemo(
    () => detail?.roster ?? [],
    [detail],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextDetail, nextTemplate] = await Promise.all([
        trpc.sessionEvidence.detailForStaff.query({ classSessionId }),
        trpc.sessionEvidence.commentTemplate.query(),
      ]);
      setDetail(nextDetail);
      setTemplate(nextTemplate);
      setSummary(nextDetail.session.evidence?.summary ?? '');
      setInternalNote(nextDetail.session.evidence?.internalNote ?? '');
      setPhotos(
        (nextDetail.session.evidence?.photos ?? [])
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((p) => ({ ref: p.photoRef })),
      );
      const byStudent: Record<string, CommentDraft> = {};
      for (const row of nextDetail.session.evidence?.comments ?? []) {
        byStudent[row.studentId] = {
          studentId: row.studentId,
          participation: row.participation as ParticipationValue | null,
          strength: row.strength as StrengthValue | null,
          needsImprovement: row.needsImprovement as NeedsImprovementValue | null,
          teacherNote: row.teacherNote ?? '',
        };
      }
      setComments(byStudent);
    } catch (e) {
      notifyError(e, 'Không tải được bằng chứng buổi học');
    } finally {
      setLoading(false);
    }
  }, [classSessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateComment(studentId: string, patch: Partial<CommentDraft>) {
    setComments((prev) => ({
      ...prev,
      [studentId]: {
        studentId,
        participation: null,
        strength: null,
        needsImprovement: null,
        teacherNote: '',
        ...prev[studentId],
        ...patch,
      },
    }));
  }

  async function uploadSelectedFiles() {
    if (files.length === 0) return photos;
    const uploaded: PhotoDraft[] = [];
    for (const file of files) {
      uploaded.push({ ref: await uploadSessionPhoto(file) });
    }
    const nextPhotos = [...photos, ...uploaded];
    setPhotos(nextPhotos);
    setFiles([]);
    return nextPhotos;
  }

  async function persistDraft() {
    const nextPhotos = await uploadSelectedFiles();
    const payloadComments = Object.values(comments)
      .filter(hasCommentValue)
      .map((row) => ({
        studentId: row.studentId,
        participation: row.participation ?? undefined,
        strength: row.strength ?? undefined,
        needsImprovement: row.needsImprovement ?? undefined,
        teacherNote: row.teacherNote.trim() || undefined,
      }));
    await trpc.sessionEvidence.upsertDraft.mutate({
      classSessionId,
      summary: summary.trim() || undefined,
      internalNote: internalNote.trim() || undefined,
      photos: nextPhotos.map((photo, index) => ({
        ref: photo.ref,
        sortOrder: index,
      })),
      comments: payloadComments,
    });
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await persistDraft();
      notifySuccess('Đã lưu nhận xét và ảnh buổi học');
      await load();
    } catch (e) {
      notifyError(e, 'Lưu bằng chứng buổi học thất bại');
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setSaving(true);
    try {
      await persistDraft();
      await trpc.sessionEvidence.publish.mutate({ classSessionId });
      notifySuccess('Đã publish ảnh và nhận xét lên LMS');
      await load();
    } catch (e) {
      notifyError(e, 'Publish LMS thất bại');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !detail || !template) {
    return <Loader size="sm" />;
  }

  const status = detail.session.evidence?.status ?? 'draft';
  const templateData = {
    participation: [...template.participation],
    strength: [...template.strength],
    needsImprovement: [...template.needsImprovement],
  };

  return (
    <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600}>Ảnh và nhận xét LMS</Text>
            <Text size="sm" c="dimmed">
              Lưu ảnh thật, nhận xét theo template chính thức, rồi publish cho PH/HS.
            </Text>
          </div>
          <Badge color={status === 'published' ? 'teal' : 'gray'} variant="light" radius="xl">
            {status === 'published' ? 'Đã publish' : 'Nháp'}
          </Badge>
        </Group>

        {!enabled && (
          <Text size="xs" c="dimmed">
            Buổi học chưa tới giai đoạn sau giờ học; GV vẫn xem được nháp hiện có.
          </Text>
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Textarea
            label="Tóm tắt gửi LMS"
            minRows={3}
            value={summary}
            onChange={(e) => setSummary(e.currentTarget.value)}
          />
          <Textarea
            label="Ghi chú nội bộ"
            minRows={3}
            value={internalNote}
            onChange={(e) => setInternalNote(e.currentTarget.value)}
          />
        </SimpleGrid>

        <Stack gap="xs">
          <FileInput
            label="Upload ảnh buổi học"
            placeholder="Chọn ảnh JPEG, PNG hoặc WebP"
            multiple
            value={files}
            onChange={(value) => setFiles(value ?? [])}
            leftSection={<IconPhoto size={16} />}
            accept="image/jpeg,image/png,image/webp"
            disabled={!enabled || saving}
          />
          {photos.length > 0 && (
            <SimpleGrid cols={{ base: 2, md: 4 }}>
              {photos.map((photo) => (
                <Card key={photo.ref} p="xs" withBorder radius="md">
                  <Stack gap={6}>
                    <Image src={photoUrl(photo.ref)} h={96} fit="cover" radius="sm" />
                    <Group justify="space-between" wrap="nowrap">
                      <Text size="xs" truncate>{photo.ref.slice(0, 12)}</Text>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        aria-label="Xóa ảnh"
                        disabled={!enabled || saving}
                        onClick={() => setPhotos((prev) => prev.filter((p) => p.ref !== photo.ref))}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          )}
        </Stack>

        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Học sinh</Table.Th>
                <Table.Th>Tham gia</Table.Th>
                <Table.Th>Điểm mạnh</Table.Th>
                <Table.Th>Cần rèn</Table.Th>
                <Table.Th>Ghi chú GV</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {roster.map((student) => {
                const row = comments[student.id] ?? {
                  studentId: student.id,
                  participation: null,
                  strength: null,
                  needsImprovement: null,
                  teacherNote: '',
                };
                return (
                  <Table.Tr key={student.id} data-testid={`session-comment-row-${student.studentCode}`}>
                    <Table.Td>
                      <Text size="sm" fw={600}>{student.fullName}</Text>
                      <Text size="xs" c="dimmed">{student.studentCode}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Select
                        data-testid={`session-comment-participation-${student.studentCode}`}
                        data={templateData.participation}
                        value={row.participation}
                        onChange={(v) => updateComment(student.id, { participation: v as ParticipationValue | null })}
                        clearable
                        disabled={!enabled || saving}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Select
                        data-testid={`session-comment-strength-${student.studentCode}`}
                        data={templateData.strength}
                        value={row.strength}
                        onChange={(v) => updateComment(student.id, { strength: v as StrengthValue | null })}
                        clearable
                        disabled={!enabled || saving}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Select
                        data-testid={`session-comment-needs-${student.studentCode}`}
                        data={templateData.needsImprovement}
                        value={row.needsImprovement}
                        onChange={(v) => updateComment(student.id, { needsImprovement: v as NeedsImprovementValue | null })}
                        clearable
                        disabled={!enabled || saving}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Textarea
                        data-testid={`session-comment-note-${student.studentCode}`}
                        minRows={1}
                        autosize
                        value={row.teacherNote}
                        onChange={(e) => updateComment(student.id, { teacherNote: e.currentTarget.value })}
                        disabled={!enabled || saving}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <Group justify="flex-end">
          <Button variant="light" onClick={saveDraft} loading={saving} disabled={!enabled}>
            Lưu nháp
          </Button>
          <Button color="teal" onClick={publish} loading={saving} disabled={!enabled}>
            Publish LMS
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
