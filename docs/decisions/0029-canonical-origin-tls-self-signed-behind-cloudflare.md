# 0029 Canonical origin TLS: self-signed cert behind Cloudflare Full

Date: 2026-07-03

## Status

Accepted

## Context

Two mutually exclusive manual cert-bootstrap procedures wrote to the same
`cmcnew-prod_letsencrypt` volume: `scripts/prod-tls-bootstrap.sh` (real Let's
Encrypt via `certbot certonly --standalone`) and `scripts/prod-server-deploy.sh`
(self-signed SAN cert, "accepted by Cloudflare Full mode"). Jenkins's deploy
stage only ensured the volume existed — it never generated or verified a cert,
so a fresh volume silently broke nginx startup with no actionable signal.

Live-VPS verification (2026-07-03, prior to this change landing) confirmed the
currently-deployed cert is self-signed (`issuer=CN=erp.cmcvn.edu.vn`,
`subject=CN=erp.cmcvn.edu.vn`), and both `erp.cmcvn.edu.vn` and
`hoc.cmcvn.edu.vn` serve `200` over HTTPS through Cloudflare with that cert —
confirming the live Cloudflare zone is NOT in "Full (strict)" mode (a
self-signed cert would be rejected at Cloudflare's edge with Error 526 under
strict mode).

## Decision

Canonical origin-TLS strategy is a **self-signed origin SAN cert
(erp.cmcvn.edu.vn + teacher.cmcvn.edu.vn + hoc.cmcvn.edu.vn + dev staff/LMS
hosts, RSA-2048, 10y) behind Cloudflare "Full" mode**, self-provisioned and
verified on every deploy by the new
`scripts/ensure-origin-cert.sh` helper (idempotent: verify-first, generate
only if absent, fail loud on corrupt/invalid).

Reasoning:

- Cloudflare already owns the browser-trusted edge cert. The origin cert only
  secures the Cloudflare↔origin hop and does not need public trust.
- Self-signed is generatable fully offline inside the deploy — no DNS, no
  port-80 exposure, no Let's Encrypt rate limits, no renewal-failure surface.
  On a single 2-vCPU box with no staging environment, fewer moving parts means
  fewer unattended failure modes. This makes the Jenkins deploy hermetic and
  self-healing.
- Let's Encrypt (HTTP-01) cannot be embedded in an idempotent deploy — it
  needs the box publicly reachable on port 80 with nginx stopped, which
  conflicts with a running prod stack. It stays a deliberate manual procedure.

Trade-off accepted: origin traffic is encrypted but not authenticated
(Cloudflare "Full", not "Full (strict)"). Acceptable because Cloudflare's
proxy is the actual trust boundary and the box is single-tenant.

## Alternatives Considered

1. Real Let's Encrypt cert via `certbot certonly --standalone`, kept as the
   canonical path with an in-compose renewal loop. Rejected as the default
   because it cannot be made idempotent/self-healing inside a live-traffic
   deploy without a port-80/nginx-downtime window — kept as a documented
   ALTERNATE path (`scripts/prod-tls-bootstrap.sh`, start the stack with
   `--profile le` to re-enable the renewal container).
2. Cloudflare Origin CA certificate (15-year, Cloudflare-trusted) under "Full
   (strict)". Not adopted now — no `CF_API_TOKEN` exists in this repo/VPS to
   automate issuance, and it requires a human with Cloudflare dashboard
   access. Documented as the zero-code-change upgrade path: drop the cert at
   the same volume path, no script change needed.

## Consequences

Positive:

- Jenkins deploy self-provisions + verifies the origin cert with zero manual
  VPS pre-step; a fresh/empty volume self-heals instead of breaking nginx.
- A corrupt or invalid cert stops the deploy loudly with an actionable
  message instead of nginx failing to start with no clear cause.
- One fewer idle container on the 2-vCPU box: `certbot` is now gated behind a
  `le` compose profile and dormant by default (the 10-year self-signed cert
  needs no renewal loop).

Tradeoffs:

- Origin hop is encrypted-not-authenticated (accepted risk, see Decision).
- Anyone who later switches the Cloudflare zone to "Full (strict)" without
  first swapping in a CA-trusted origin cert will break the site (Error 526)
  — documented explicitly so this isn't rediscovered the hard way.

## Follow-Up

- If/when Cloudflare "Full (strict)" is desired, obtain a Cloudflare Origin
  CA certificate and place it at the same `cmcnew-prod_letsencrypt` volume
  path — `ensure-origin-cert.sh`'s verify step (presence/parse/SAN, not
  issuer identity) accepts either cert type unchanged.
- Re-verify the live Cloudflare SSL/TLS mode directly via dashboard/API if a
  `CF_API_TOKEN` is ever added to this repo, to replace this decision's
  indirect (HTTP-reachability) verification with a direct one.
