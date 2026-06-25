// Callio (Phonenet) call-metrics client (decision 0010). Polls GET {base}/call for a period and
// reduces the CDR stream to per-agent valid-call tallies. A "valid" KPI call = outbound AND talk
// time (billDuration) > 5s. Auth = header `token` (env). Token unset → caller treats as no-op.
//
// Split into a network half (fetchPeriodCdrs — mockable via fetchImpl) and a pure half
// (aggregateValidCalls) so the business rule is unit-testable without a live dialer.

/** Minimum talk seconds for a call to count toward KPI (user rule: > 5s of real conversation). */
export const VALID_MIN_TALK_SEC = 5;
const PAGE_SIZE = 100;
const MAX_PAGES = 500; // backstop against a runaway pager

export interface CallioConfig {
  base: string;
  token: string;
}

/** A normalized call record — only the fields KPI needs, lifted from the raw Phonenet CDR. */
export interface CdrRecord {
  direction: string; // "outbound" | "inbound"
  billDuration: number; // talk seconds (excludes ringing); the ">5s" rule keys on this
  fromExt: string | null; // dialer extension — maps to EmploymentProfile.callioExt
  startTime: number; // epoch ms
}

export interface AgentCallTally {
  validCalls: number;
  totalCalls: number;
  totalTalkSec: number;
}

/** Read Callio config from env; null when unset (caller then records zero metrics, no error). */
export function callioConfigFromEnv(): CallioConfig | null {
  const base = process.env.CALLIO_API_BASE;
  const token = process.env.CALLIO_API_TOKEN;
  if (!base || !token) return null;
  return { base, token };
}

type FetchLike = typeof fetch;

/** Map one raw Phonenet CDR doc to the fields we keep. Defensive: tolerate missing fields. */
function normalize(doc: Record<string, unknown>): CdrRecord {
  return {
    direction: typeof doc.direction === 'string' ? doc.direction : '',
    billDuration: typeof doc.billDuration === 'number' ? doc.billDuration : 0,
    fromExt: typeof doc.fromExt === 'string' ? doc.fromExt : null,
    startTime: typeof doc.startTime === 'number' ? doc.startTime : 0,
  };
}

/** Fetch every CDR whose time falls in [fromMs, toMs), paging until exhausted. The server filters
 *  by from/to; we page with pageSize=100 and follow hasNextPage. fetchImpl is injectable for tests. */
export async function fetchPeriodCdrs(
  cfg: CallioConfig,
  fromMs: number,
  toMs: number,
  fetchImpl: FetchLike = fetch,
): Promise<CdrRecord[]> {
  const out: CdrRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${cfg.base}/call?from=${fromMs}&to=${toMs}&page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetchImpl(url, { headers: { token: cfg.token, 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`Callio /call HTTP ${res.status}`);
    const body = (await res.json()) as { docs?: unknown[]; hasNextPage?: boolean };
    const docs = Array.isArray(body.docs) ? body.docs : [];
    for (const d of docs) out.push(normalize(d as Record<string, unknown>));
    if (!body.hasNextPage || docs.length === 0) break;
  }
  return out;
}

/** Pure reducer: CDR list → per-extension tally. Valid = outbound & billDuration > 5s. Records
 *  with no fromExt are skipped (can't be attributed to a staff member). */
export function aggregateValidCalls(records: CdrRecord[]): Map<string, AgentCallTally> {
  const byExt = new Map<string, AgentCallTally>();
  for (const r of records) {
    if (!r.fromExt) continue;
    const tally = byExt.get(r.fromExt) ?? { validCalls: 0, totalCalls: 0, totalTalkSec: 0 };
    tally.totalCalls += 1;
    if (r.direction === 'outbound' && r.billDuration > VALID_MIN_TALK_SEC) {
      tally.validCalls += 1;
      tally.totalTalkSec += r.billDuration;
    }
    byExt.set(r.fromExt, tally);
  }
  return byExt;
}
