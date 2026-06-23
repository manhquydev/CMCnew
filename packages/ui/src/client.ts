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
