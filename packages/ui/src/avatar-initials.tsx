import { Avatar, type MantineSize } from '@mantine/core';

/* InitialsAvatar — deterministic-color initials circle. Replaces ad-hoc
   `name.slice(0, 2)` avatars across the app (shell top-bar menu, tables). Falls
   back to initials whenever no photo `src` is given or the photo fails to load. */

const PALETTE = ['cmc', 'cmcGreen', 'cmcAmber', 'cmcRed', 'cmcGray'] as const;

/** Extracts 1-2 uppercase initials from a full name: first letter of the first word +
 *  first letter of the last word (handles Vietnamese multi-word names sensibly, e.g.
 *  "Nguyễn Thành Trung" -> "NT"). Single-word names just take the first letter. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  const last = words[words.length - 1] ?? first;
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

/** Deterministic palette pick: sums char codes of `name`, mods into PALETTE — same name
 *  always resolves to the same semantic color family. */
export function colorOf(name: string): (typeof PALETTE)[number] {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return PALETTE[sum % PALETTE.length] ?? PALETTE[0];
}

export interface InitialsAvatarProps {
  name: string;
  size?: MantineSize | number;
  /** Optional photo URL — falls back to initials if absent or fails to load. */
  src?: string;
}

export function InitialsAvatar({ name, size = 32, src }: InitialsAvatarProps) {
  return (
    <Avatar size={size} radius="xl" color={colorOf(name)} src={src} title={name} alt={name}>
      {initialsOf(name)}
    </Avatar>
  );
}
