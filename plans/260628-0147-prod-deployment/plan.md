# Prod Deployment — CMCnew (erp + hoc .cmcvn.edu.vn)

Status: DEPLOYED + VERIFIED (Jenkins bring-up + user to-dos remain) · Lane: high-risk · Branch: develop · 2026-06-28

## Result (verified live)
- https://erp.cmcvn.edu.vn → 200 (admin) · https://hoc.cmcvn.edu.vn → 200 (lms), both via Cloudflare.
- Break-glass login (admin@cmcvn.edu.vn) → 200 + Secure cmc.session; wrong password → 401.
- SSO init → 302 to login.microsoftonline.com (correct tenant + prod redirect_uri); not 503.
- Seeded: admin (super_admin), nhungdt (giam_doc_kinh_doanh), hongltn (giam_doc_dao_tao, SSO-only).
- Stack: 7 containers healthy. ufw on (22/80/443). Daily DB backup cron (14-day retention).
- Origin cert: self-signed (Cloudflare "Full" accepts it). cmc_app password rotated. COOKIE_SECURE=true.

## Target
- VPS 152.42.167.189 (Ubuntu 24.04, 2 vCPU / 7.8 GB / 154 GB, Docker 29 + Compose v5, ports 80/443 free).
- ERP (admin) → https://erp.cmcvn.edu.vn · LMS → https://hoc.cmcvn.edu.vn (DNS already A→IP).
- Jenkins CI/CD (GitHub Actions deferred — billing blocked).

## Architecture decision
Single-node **Docker Compose** (NOT k8s — overkill for 2 vCPU / one ERP). Adapt existing
`docker/docker-compose.prod.yml`. Two-domain nginx + Let's Encrypt TLS. Jenkins runs in Docker.

## Phases
1. **Prod config (repo)** — two-domain nginx+TLS, certbot service, lms root build, director seed,
   compose 443 wiring, `.env.production` generation (server-side, no secret exposure), deploy scripts.
2. **First deploy** — ship code to server (git archive→scp), obtain TLS certs (certbot), bring up
   stack (postgres→migrate→seed super_admin+directors→services), verify both domains over HTTPS.
3. **Jenkins CI/CD** — Jenkins-in-Docker + pipeline (build→test→deploy→migrate), webhook/poll.
4. **Harden** — COOKIE_SECURE=true, rotate cmc_app pw, ufw firewall, DB backup cron, log/monitor.
5. **Verify + report** — SSO config present, login flows, both apps reachable, CI green path.

## Acceptance
- https://erp.cmcvn.edu.vn + https://hoc.cmcvn.edu.vn serve over valid TLS.
- super_admin can log in (break-glass password); 2 directors seeded (SSO-only).
- SSO configured (503 only until owner adds prod redirect URI in Entra — flagged).
- Jenkins pipeline deploys on demand.
- Secrets never printed; prod uses fresh DB/JWT secrets.

## User to-dos (cannot be done from here)
- Register `https://erp.cmcvn.edu.vn/api/auth/sso/callback` as a Redirect URI in the Entra app.
- (Optional) GitHub webhook → Jenkins for push-triggered builds.

## Phase files
- phase-01-prod-config.md (TBD if needed)
