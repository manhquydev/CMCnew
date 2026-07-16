import { createTRPCClient, httpBatchLink, type TRPCClient } from '@trpc/client';
import type { AppRouter } from '@cmc/api/router';

/** API origin (no trailing /trpc). Exported for non-tRPC transports e.g. the SSE stream. */
export const API_URL =
  (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:4000';

/** Shared typed tRPC client. credentials:'include' so the session cookie flows. */
export const trpc: TRPCClient<AppRouter> = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      fetch: (url, opts) => fetch(url, { ...opts, credentials: 'include' }),
    }),
  ],
});

export type { AppRouter };

/** Upload an exercise base PDF (staff session). Returns its content-address ref for basePdfRef. */
export async function uploadExercisePdf(file: File): Promise<string> {
  const res = await fetch(`${API_URL}/upload/exercise-pdf`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  });
  if (!res.ok) throw new Error(`Tải đề PDF thất bại (${res.status}): ${await res.text()}`);
  const { ref } = (await res.json()) as { ref: string };
  return ref;
}

/** Upload a session evidence photo (staff session). Returns its content-address photo ref. */
export async function uploadSessionPhoto(file: File): Promise<string> {
  const res = await fetch(`${API_URL}/upload/session-photo`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error(`Tải ảnh buổi học thất bại (${res.status}): ${await res.text()}`);
  const { ref } = (await res.json()) as { ref: string };
  return ref;
}

/** Upload a gift catalog photo (staff session, `rewards.giftCreate` gated server-side).
 * Returns its content-address ref for `Gift.imageUrl`. */
export async function uploadGiftPhoto(file: File): Promise<string> {
  const res = await fetch(`${API_URL}/upload/gift-photo`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error(`Tải ảnh quà thất bại (${res.status}): ${await res.text()}`);
  const { ref } = (await res.json()) as { ref: string };
  return ref;
}

const GIFT_PHOTO_REF_PATTERN = /^[a-f0-9]{64}$/;

/** Resolve a Gift.imageUrl into a displayable image src. `imageUrl` may be a content-address
 * ref (uploaded via the gift-photo store) or a legacy http(s) URL (the pre-upload "external
 * image URL" field) — both are supported side by side. Returns null when there is nothing to
 * show, so callers fall back to a placeholder icon. */
export function giftImageSrc(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (GIFT_PHOTO_REF_PATTERN.test(imageUrl)) return `${API_URL}/files/gift-photo/${imageUrl}`;
  if (imageUrl.startsWith('http')) return imageUrl;
  return null;
}
