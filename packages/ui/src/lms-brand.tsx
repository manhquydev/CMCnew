import { Anchor, Group, Stack, Text } from '@mantine/core';

/**
 * Canonical CMC EDU brand facts for the LMS surface — sourced from the public website
 * (D:\project\CMC), not invented. Used by the login gate and footers so parents/students
 * always see real contact info. Assets live in the LMS app's public/brand/.
 */
export const CMC_BRAND = {
  name: 'CMC EDU',
  fullName: 'Học viện phát triển Tư duy & Năng lực số CMC',
  tagline: 'Tò mò là khởi nguồn của trí tuệ',
  hotline: '0856 636 398',
  email: 'contact@cmcvn.edu.vn',
  address: 'Khu đô thị Tây Nam Linh Đàm, Hoàng Mai, Hà Nội',
  website: 'cmcvn.edu.vn',
  websiteUrl: 'https://cmcvn.edu.vn',
  facebook: 'https://www.facebook.com/share/14fVk5g2DiT/',
  zalo: 'https://zaloapp.com/qr/p/1boqvt2eg3ndl',
  logo: '/brand/cmc-logo.jpg',
} as const;

/** Compact, friendly footer for public LMS surfaces (login). Real contact info only.
 *  Sits on a translucent surface so the text stays legible over the brand gradient. */
export function LmsFooter() {
  return (
    <Stack
      gap={5}
      align="center"
      maw={440}
      style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 14, padding: '12px 18px' }}
    >
      <Text size="xs" fw={700} style={{ color: 'var(--cmc-text)' }} ta="center">
        {CMC_BRAND.fullName}
      </Text>
      <Group gap={6} justify="center" wrap="wrap">
        <Text size="xs" style={{ color: 'var(--cmc-text-2)' }}>Hotline {CMC_BRAND.hotline}</Text>
        <Text size="xs" style={{ color: 'var(--cmc-text-2)' }}>·</Text>
        <Anchor size="xs" href={`mailto:${CMC_BRAND.email}`} c="cmc.7">{CMC_BRAND.email}</Anchor>
        <Text size="xs" style={{ color: 'var(--cmc-text-2)' }}>·</Text>
        <Anchor size="xs" href={CMC_BRAND.websiteUrl} target="_blank" c="cmc.7">{CMC_BRAND.website}</Anchor>
      </Group>
      <Text size="xs" style={{ color: 'var(--cmc-text-2)' }} ta="center">{CMC_BRAND.address}</Text>
      <Group gap={10} justify="center" mt={2}>
        {[
          { label: 'UCREA', color: '#FF7B2E' },
          { label: 'BRIGHT I.G', color: '#1B98E0' },
          { label: 'BlackHole', color: '#7950F2' },
        ].map((p) => (
          <Group key={p.label} gap={5} wrap="nowrap">
            <span style={{ width: 8, height: 8, borderRadius: 999, background: p.color, display: 'inline-block' }} />
            <Text size="xs" fw={600} style={{ color: 'var(--cmc-text-2)' }}>{p.label}</Text>
          </Group>
        ))}
      </Group>
      <Group gap="md" justify="center" mt={2}>
        <Anchor size="xs" href={CMC_BRAND.facebook} target="_blank" c="cmc.7">Facebook</Anchor>
        <Anchor size="xs" href={CMC_BRAND.zalo} target="_blank" c="cmc.7">Zalo</Anchor>
      </Group>
      <Text size="xs" style={{ color: 'var(--cmc-text-2)' }} mt={2} ta="center">
        © {new Date().getFullYear()} {CMC_BRAND.name} · {CMC_BRAND.tagline}
      </Text>
    </Stack>
  );
}
