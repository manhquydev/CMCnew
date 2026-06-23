import { createTRPCClient, httpBatchLink, type TRPCClient } from '@trpc/client';
import type { AppRouter } from '@cmc/api/router';

const API_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:4000';

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
