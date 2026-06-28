# Prod Deployment — Completion Report (CMCnew)

Date: 2026-06-28 · Branch: develop · Server: 152.42.167.189 (Ubuntu 24.04, 2 vCPU / 7.8 GB / 154 GB)

## LIVE + VERIFIED (real evidence, no claims without proof)

| Check | Evidence |
| --- | --- |
| https://erp.cmcvn.edu.vn (admin) | HTTP 200, `<title>CMC Admin</title>` (through Cloudflare) |
| https://hoc.cmcvn.edu.vn (lms) | HTTP 200, `<title>CMC LMS</title>` (through Cloudflare) |
| Break-glass login (public, via CF) | 200 + Secure `cmc.session` cookie; returns super_admin |
| Wrong password (negative) | 401 "Sai email hoặc mật khẩu" |
| SSO init `/api/auth/sso/login` | 302 → login.microsoftonline.com, correct tenant + `redirect_uri=https://erp.cmcvn.edu.vn/api/auth/sso/callback` |
| api `/health` | `{"ok":true}` |
| 80 → 443 redirect | 301 |
| Seeded accounts (DB) | admin@cmcvn.edu.vn=super_admin, nhungdt@cmcvn.edu.vn=giam_doc_kinh_doanh, hongltn@cmcvn.edu.vn=giam_doc_dao_tao (SSO-only) |
| api runtime logs | no errors/warnings; clean startup |
| Containers | 7 up (postgres/redis/api healthy, admin/lms/nginx/certbot up) |

## Architecture (decisions)
- **Docker Compose on the single VPS — NOT k8s.** 2 vCPU / single node / one ERP → k8s is pure overhead. KISS.
- Two-domain nginx: `erp`→admin, `hoc`→lms, shared `/api`. LMS rebuilt at root (`VITE_BASE_URL=/`).
- **Behind Cloudflare proxy** (domains resolve to CF IPs, origin = the VPS). Edge TLS = Cloudflare.
  Origin uses a **self-signed SAN cert** which CF "Full" mode accepts (verified: public 200). cmc_app
  password rotated post-migrate; `COOKIE_SECURE=true` (Secure cookie verified).
- Secrets: SSO/Graph creds reused from the org app; DB/JWT/seed secrets freshly minted; never printed.

## DevOps / hardening (done)
- ufw active: 22/80/443 only.
- Daily DB backup cron (02:30, 14-day retention) — test dump verified (18 KB).
- certbot service runs (no-op renew on the self-signed; swap to a real cert → it renews).
- Repo on server at `/root/cmcnew`; deploy via `scripts/prod-server-deploy.sh` (idempotent-ish).

## CI/CD — Jenkins (artifacts committed; container being brought up)
- `Jenkinsfile`: checkout → lint/typecheck → (develop/main) integration tests → build+deploy compose
  via host docker socket → migrate → smoke. `disableConcurrentBuilds` for the 2 vCPU box; e2e deferred.
- `docker/Dockerfile.jenkins` + `docker-compose.jenkins.yml` (jenkins:lts-jdk17 + docker CLI, 1.5 vCPU /
  3 GB cap, bound to 127.0.0.1:8080, prod .env mounted read-only) + plugins.txt + JCasC.
- Research: `plans/reports/researcher-260628-0147-jenkins-cicd-single-vps-design-report.md`.

## YOU need to do (cannot be done from here)
1. **Entra: register the prod redirect URI** `https://erp.cmcvn.edu.vn/api/auth/sso/callback` in the app
   registration (client_id bf0f8dc1-…). SSO init already redirects correctly, but Microsoft will reject the
   callback until this exact URI is registered (you previously only added the localhost one). This is the
   one thing blocking a *completed* SSO round-trip; everything else works.
2. **Break-glass password**: stored in `/root/cmcnew/.env.production` (`SEED_SUPERADMIN_PASSWORD`). Retrieve
   via SSH; not printed anywhere. The directors log in via SSO (no password).
3. **Cloudflare (recommended hardening)**: set SSL mode to **Full (strict)** and install a **Cloudflare
   Origin Certificate** at `/etc/letsencrypt/live/erp.cmcvn.edu.vn/` (replacing the self-signed). Works
   today under "Full"; strict is the secure target.
4. **Jenkins one-time**: unlock with `docker exec cmcnew-jenkins cat /var/jenkins_home/secrets/initialAdminPassword`,
   add a GitHub credential (private repo), create a pipeline job → this repo's `Jenkinsfile`, add the
   webhook (`/github-webhook/`) or SCM poll. Expose 8080 via a `ci.` vhost or SSH tunnel (it holds deploy rights).

## Open questions
- Cloudflare SSL mode target (Full vs Full-strict) — affects whether to install the CF Origin Cert now.
- Jenkins reachability: ci subdomain vhost vs SSH-tunnel-only?
