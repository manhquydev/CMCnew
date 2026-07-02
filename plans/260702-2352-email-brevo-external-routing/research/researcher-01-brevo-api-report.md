# Brevo Transactional Email API Research Report

**Date:** 2026-07-03  
**Task:** Evaluate Brevo as secondary transport for external email recipients (parents/guardians)  
**Scope:** API contract, rate limits, domain verification requirements

---

## 1. Brevo REST API — Request/Response Contract

### Endpoint
```
POST https://api.brevo.com/v3/smtp/email
```

### Request Payload
Required fields (JSON):
- **sender** (object): `{ name: string, email: string }`
- **to** (array): `[{ email: string, name?: string }]`
- **subject** (string)
- **htmlContent** OR **textContent** OR **templateId** (choose one)
- **headers** (optional object): `{ "X-Mailin-custom": "string", "charset": "string", ... }`

### Authentication Header
```
api-key: xkeysib-{YOUR_API_KEY}
```
No Bearer prefix; API key goes directly in `api-key` header.

### Success Response
- **HTTP 201** with JSON body:
  ```json
  { "messageId": "<uuid@relay.domain.com>" }
  ```
- `messageId` is stable identifier for bounce/delivery tracking.

### Error Response Codes (per Brevo docs)
- **401/403**: Invalid/missing API key → authentication failure
- **400**: Invalid sender domain (unregistered/unverified) → rejected
- **429**: Rate limit exceeded → transient, retry-able
- **422**: Invalid payload (malformed recipients, missing required fields)

---

## 2. Rate Limits & High-Volume Strategy

### Standard Rate Limits
- **Base plan**: 1,000 requests/sec (RPS)
- **Pro plan**: 2,000 RPS
- **Enterprise plan**: 6,000 RPS
- **Daily limit**: None (unlimited for paid plans)

### Rate Limit Headers
Brevo includes `X-RateLimit-*` headers in all responses; monitor these to anticipate 429s. On 429, implement exponential backoff (min 2s, cap at 60s).

### High-Volume Strategies
1. **Batch via messageVersions**: Single POST call with up to 1,000 personalized emails in `messageVersions` array → reduces API call count by ~1,000x vs. individual sends.
2. **Batch endpoint**: `POST /v3/smtp/email/batch` — max 5 calls/min = ~30k emails/hour.
3. **Even distribution**: Spread requests evenly across available rate-limit quota to avoid spike rejection.

---

## 3. Sender Domain Verification Requirements

### Critical Finding
**Sender domain verification is REQUIRED per sender email address** — not account-wide. Each sender (`from:` email) must be verified individually in the Brevo dashboard before use.

### Verification Process
1. Add sender email in Brevo account → Brevo sends verification email to that address
2. Click verification link → Brevo provides DNS records for domain authentication
3. Add records to your domain DNS:
   - **DKIM record** (mandatory): Provided by Brevo; publish to DNS
   - **Brevo verification code** (mandatory): TXT record, one-time DNS verification
   - **SPF record** (optional for Brevo): Not required on shared IPs; Brevo manages envelope-sender
   - **DMARC record** (recommended): Single DMARC policy with `rua` tag to receive reports

### Implications for Existing Domain
- If domain was verified on old system (e.g., admin@cmc.local verified elsewhere), it does **NOT** automatically work in Brevo
- Each Brevo account requires its own DKIM setup per sender
- If reusing the same domain, redeploy DKIM records for Brevo's nameservers; old DNS records don't transfer
- **Risk**: Two different DKIM records on same domain → deliverability issues → start fresh verification in Brevo

### Non-Compliance Behavior
Without prior verification, Brevo replaces sender address with a Brevo-owned address → recipients don't recognize sender → spam flagging risk → damage to sender reputation.

---

## 4. Comparison: MS Graph vs Brevo

| Factor | MS Graph (@company.com) | Brevo (external parents) |
|--------|------------------------|--------------------------|
| **Auth** | Delegated OAuth | API key (stateless) |
| **Rate limit** | 500/min per-tenant | 1k–6k RPS (plan-dependent) |
| **Domain verify** | M365 org.com built-in | Per-sender in Brevo dashboard |
| **Cost** | Zero (license) | $20–200+/month |
| **Bounce handling** | Graph webhooks | Brevo event webhook |

---

## Key Recommendations for Plan

1. **Pre-flight checklist**: Before shipping Brevo route, verify all sender addresses (e.g., `noreply@cmc.local`, `support@cmc.local`) are registered in Brevo dashboard + DKIM records deployed.

2. **Rate limit headroom**: With 1,000 RPS base, system can handle ~86M emails/day; likely sufficient for parents-only audience. Monitor via X-RateLimit headers; log 429s.

3. **Retry strategy**: Implement exponential backoff (starting 2s) for 429s. Do NOT immediately retry 401 (auth failure) or 400 (sender not verified).

4. **Fallback**: If Brevo 429 or 5xx, route back to Graph (internal staff notified) or queue for manual resend (low volume).

5. **Testing**: Use Brevo sandbox/test API key before prod; verify DKIM/SPF in real-world email header inspection (mail-tester.com or similar).

---

## Sources

- [Brevo API: Send Transactional Email](https://developers.brevo.com/docs/send-a-transactional-email)
- [Brevo Rate Limits & API Limits](https://developers.brevo.com/docs/api-limits)
- [Brevo Domain Authentication (DKIM/DMARC)](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC)
- [Gmail/Yahoo/Microsoft Compliance for Brevo Senders](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)
- [Brevo vs Sendinblue: SPF, DKIM Setup](https://easydmarc.com/blog/brevo-ex-sendinblue-spf-dkim-setup/)

---

## Unresolved Questions

1. **Webhook auth format**: Does Brevo sign webhooks? If so, which header + algorithm (HMAC-SHA256)?
2. **Bounce categorization**: Does Brevo's bounce webhook distinguish soft vs. hard bounce, or does it require parsing event type?
3. **Cost scale**: Does Brevo bill per-email or fixed monthly for volume tier? (affects budget planning for high volume.)
