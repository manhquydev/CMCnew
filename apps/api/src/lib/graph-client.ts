// Microsoft Graph email sender (M365 A1, decision: email-graph-integration). Sends through the
// Exchange Online Shared Mailboxes via POST /users/{mailbox}/sendMail, authenticated by the app's
// certificate (client-credentials OAuth2 — no passwords/secrets). Mirrors callio-client.ts: config
// comes from env and is null when unset, so the caller treats an unconfigured tenant as a no-op.
//
// Split into a config loader, a token half (mockable), and a send half (fetch, mockable) so the
// outbox worker is unit-testable without a live tenant. @azure/identity is imported lazily so the
// dependency never loads in the no-op / test path.

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

/** Sender mailbox keys → addresses. Filled from env; keys are the only values business code uses. */
export type MailboxKey = 'notify' | 'payroll' | 'hr';

export interface GraphMailerConfig {
  tenantId: string;
  clientId: string;
  certPath: string;
  certPassword?: string;
  senders: Record<MailboxKey, string>;
}

/** Thrown on HTTP 429 so the worker can back off without losing the row. */
export class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Graph sendMail rate-limited; retry after ${retryAfterSec}s`);
    this.name = 'RateLimitError';
  }
}

/**
 * Read Graph config from env; null when the minimum set is unset (caller then no-ops). A sender
 * address is required for each mailbox key — if any is missing we still return config but resolve
 * the address at send time (so a partially-configured tenant fails loudly only for the used mailbox).
 */
export function graphMailerFromEnv(): GraphMailerConfig | null {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const certPath = process.env.GRAPH_CERT_PATH;
  if (!tenantId || !clientId || !certPath) return null;
  return {
    tenantId,
    clientId,
    certPath,
    certPassword: process.env.GRAPH_CERT_PASSWORD || undefined,
    senders: {
      notify: process.env.GRAPH_SENDER_NOTIFY ?? '',
      payroll: process.env.GRAPH_SENDER_PAYROLL ?? '',
      hr: process.env.GRAPH_SENDER_HR ?? '',
    },
  };
}

/** Resolve a mailbox key to its from-address; throws if that mailbox was not configured. */
export function senderAddress(cfg: GraphMailerConfig, mailbox: string): string {
  const addr = cfg.senders[mailbox as MailboxKey];
  if (!addr) throw new Error(`Graph sender mailbox '${mailbox}' is not configured (GRAPH_SENDER_*)`);
  return addr;
}

export interface OutgoingEmail {
  mailbox: string; // sender key: notify|payroll|hr
  to: string;
  subject: string;
  html: string;
  attachment?: { name: string; contentType: string; bytes: Buffer };
}

type GetToken = (cfg: GraphMailerConfig) => Promise<string>;
type FetchLike = typeof fetch;

export interface SendDeps {
  getToken?: GetToken;
  fetchImpl?: FetchLike;
}

/** Default token acquisition via certificate (client-credentials). Lazy-imports @azure/identity. */
const defaultGetToken: GetToken = async (cfg) => {
  const { ClientCertificateCredential } = await import('@azure/identity');
  const credential = new ClientCertificateCredential(cfg.tenantId, cfg.clientId, {
    certificatePath: cfg.certPath,
    ...(cfg.certPassword ? { certificatePassword: cfg.certPassword } : {}),
  });
  const token = await credential.getToken(GRAPH_SCOPE);
  if (!token?.token) throw new Error('Graph token acquisition returned no token');
  return token.token;
};

/**
 * Send one email through Graph. Throws RateLimitError on 429 (worker backs off), and a plain Error
 * on any other non-2xx (worker counts the attempt). saveToSentItems:false keeps the shared mailbox
 * small (research §H.3 — retention is handled MS-side).
 */
export async function sendViaGraph(
  cfg: GraphMailerConfig,
  msg: OutgoingEmail,
  deps: SendDeps = {},
): Promise<void> {
  const getToken = deps.getToken ?? defaultGetToken;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const from = senderAddress(cfg, msg.mailbox);
  const token = await getToken(cfg);

  const body: Record<string, unknown> = {
    message: {
      subject: msg.subject,
      body: { contentType: 'HTML', content: msg.html },
      toRecipients: [{ emailAddress: { address: msg.to } }],
      ...(msg.attachment
        ? {
            attachments: [
              {
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: msg.attachment.name,
                contentType: msg.attachment.contentType,
                contentBytes: msg.attachment.bytes.toString('base64'),
              },
            ],
          }
        : {}),
    },
    saveToSentItems: false,
  };

  const res = await fetchImpl(`${GRAPH_BASE}/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '60');
    throw new RateLimitError(Number.isFinite(retryAfter) ? retryAfter : 60);
  }
  // sendMail returns 202 Accepted with no body on success.
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Graph sendMail HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}
