#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const requireFromE2e = createRequire(new URL('../apps/e2e/package.json', import.meta.url));
const { chromium, expect } = requireFromE2e('@playwright/test');

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`
Usage:
  pnpm --filter @cmc/e2e exec node ../../scripts/verify-teacher-cmcvn-interactive-sso.mjs

Environment:
  SSO_ORIGIN=https://teacher.cmcvn.edu.vn    Single staff host to verify.
  SSO_ORIGINS=https://teacher.cmcvn.edu.vn,https://erp.cmcvn.edu.vn
                                             Comma-separated staff hosts to verify.
  SSO_TIMEOUT_MS=900000                      Wait time for operator login/MFA per host.
  SSO_KEEP_PROFILE=1                         Keep temporary browser profile for debugging.

The script opens a headed browser. Complete Microsoft login/MFA manually when prompted.
It passes only after the browser returns to each selected staff host with a host-scoped
cmc.session cookie and the authenticated staff shell is visible on that host.
`);
  process.exit(0);
}

const originEnv = process.env.SSO_ORIGINS ?? process.env.SSO_ORIGIN ?? 'https://teacher.cmcvn.edu.vn';
const origins = originEnv
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const timeoutMs = Number(process.env.SSO_TIMEOUT_MS ?? 15 * 60 * 1000);
const keepProfile = process.env.SSO_KEEP_PROFILE === '1';
const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmc-teacher-sso-'));

if (origins.length === 0) {
  throw new Error('No SSO origin configured. Set SSO_ORIGIN or SSO_ORIGINS.');
}

function isStaffOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

async function verifyOrigin(context, page, origin) {
  console.log(`\nInteractive SSO smoke for ${origin}`);
  console.log('Complete Microsoft login/MFA manually if the browser asks.');

  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });

  const microsoftButton = page.getByRole('button', { name: /Microsoft/i });
  if (await microsoftButton.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await microsoftButton.click();
  }

  await page.waitForURL((url) => isStaffOrigin(url.toString(), origin) && !url.searchParams.has('sso_error'), {
    timeout: timeoutMs,
  });

  await expect(page.getByRole('button', { name: /Tài khoản|Đăng xuất/i }).first()).toBeVisible({
    timeout: 30_000,
  });

  const cookies = await context.cookies(origin);
  const sessionCookie = cookies.find((cookie) => cookie.name === 'cmc.session');
  if (!sessionCookie) {
    throw new Error(`Missing cmc.session cookie for ${origin}`);
  }
  if (sessionCookie.domain.startsWith('.')) {
    throw new Error(`cmc.session must be host-scoped, got domain=${sessionCookie.domain}`);
  }

  const result = {
    status: 'pass',
    origin,
    finalUrl: page.url(),
    sessionCookieDomain: sessionCookie.domain,
    sessionCookieHostOnly: !sessionCookie.domain.startsWith('.'),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function run() {
  console.log(`Interactive SSO smoke for ${origins.join(', ')}`);
  console.log('A headed browser will open. Complete Microsoft login/MFA manually.');
  console.log(`Timeout: ${timeoutMs}ms per host`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1366, height: 900 },
  });
  const page = context.pages()[0] ?? await context.newPage();

  try {
    const results = [];
    for (const origin of origins) {
      results.push(await verifyOrigin(context, page, origin));
      await page.goto('about:blank');
    }
    console.log(JSON.stringify({
      status: 'pass',
      verifiedOrigins: results,
    }, null, 2));
  } finally {
    await context.close();
  }
}

try {
  await run();
} finally {
  if (!keepProfile) {
    await fs.rm(profileDir, { recursive: true, force: true });
  } else {
    console.log(`Kept browser profile: ${profileDir}`);
  }
}
