import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 0 visual-verification harness for the ERP admin re-skin
 * (plans/260703-2351-erp-admin-reskin-core3). Not a gating test — no pixel-diff assertion.
 *
 * Captures full-page screenshots of the CURRENT (pre-reskin) admin + LMS screens into
 * apps/e2e/reskin-baseline/<section>.png. Compare each side-by-side against its wireframe
 * reference at apps/e2e/reskin-baseline/wireframes/<wireframeFolder>.png (copied in from
 * D:\Downloads\stitch_cmcnew\stitch_cmcnew\<wireframeFolder>\screen.png — gitignored, not
 * committed, source lives outside the repo). Later re-skin phases re-run this spec against
 * the same routes and eyeball the diff (human or code-reviewer).
 *
 * The admin app has no URL router (SPA, section state only) — screens are reached by
 * logging in then clicking the matching sidebar nav item, same pattern as
 * admin-meeting-set-schedule.spec.ts's loginAdmin() helper.
 *
 * Run against a locally running admin dev server (or let Playwright's own webServer
 * config in playwright.config.ts start api+admin+lms for you):
 *   pnpm --filter admin dev
 *   pnpm --filter e2e reskin:capture
 *
 * The cockpit-crm capture needs STAFF_PASSWORD_LOGIN=true on the api dev server (decision
 * 0031: non-super_admin staff password login is opt-in, off by default) — export it before
 * `pnpm --filter api dev` when you need that one screenshot; the other captures work with
 * either setting since they use the super_admin break-glass login.
 */

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';
// The executive-cockpit nav item only renders for a single-role giam_doc_kinh_doanh
// account (apps/admin/src/shell.tsx buildNavGroups → isBizDirectorOnly); super_admin does
// not qualify, so the cockpit-crm capture needs this separate seed account (see
// STAFF_PASSWORD_LOGIN note above — this login is FORBIDDEN unless that flag is set).
const COCKPIT_EMAIL = process.env.TEST_COCKPIT_EMAIL ?? 'quanly@cmc.local';
const COCKPIT_PASSWORD = process.env.TEST_COCKPIT_PASSWORD ?? 'ChangeMe!123';

const OUT_DIR = 'reskin-baseline';

async function loginAdmin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('nav')).toBeVisible({ timeout: 10_000 });
}

async function captureNavSection(
  page: Page,
  navLabel: string,
  section: string,
  headerTitle: string,
): Promise<void> {
  await page.locator('nav a').filter({ hasText: navLabel }).click();
  // The admin app is a client-side SPA (section state, no URL nav) — networkidle resolves
  // almost immediately since no real navigation occurs, racing ahead of the section's
  // re-render/data fetch. Wait for the topbar section title (shell.tsx AppShell.Header) to
  // reflect the new section, then give the panel's tRPC query effect a beat to start before
  // waiting for it to settle — otherwise the screenshot can catch the panel's loading spinner.
  await expect(page.locator('header').getByText(headerTitle, { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT_DIR}/${section}.png`, fullPage: true });
}

test.describe('reskin visual capture — admin (baseURL :5173)', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('login — screen: login, wireframe: ng_nh_p_cmc_edu_1', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${OUT_DIR}/login.png`, fullPage: true });
  });

  test('super_admin sections: attendance-report, meetings, crm-kanban, students-list, schedule', async ({ page }) => {
    await loginAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // wireframe: b_o_c_o_xu_h_ng_i_m_danh_cmc_erp
    await captureNavSection(page, 'Báo cáo điểm danh', 'attendance-report', 'Báo cáo điểm danh');
    // wireframe: l_ch_h_p_ph_huynh
    await captureNavSection(page, 'Họp PH', 'meetings', 'Họp phụ huynh');
    // wireframe: template_kanban_erp_vietnamese_core
    await captureNavSection(page, 'CRM', 'crm-kanban', 'CRM');
    // wireframe: template_danh_s_ch_erp_vietnamese_core (list/table screen)
    await captureNavSection(page, 'Học sinh', 'students-list', 'Học sinh');
    // wireframe: template_l_ch_erp_vietnamese_core (calendar/schedule screen)
    await captureNavSection(page, 'Lịch dạy', 'schedule', 'Lịch dạy');
  });

  test('giam_doc_kinh_doanh-only cockpit — screen: cockpit-crm, wireframe: cockpit_i_u_h_nh_crm', async ({ page }) => {
    await loginAdmin(page, COCKPIT_EMAIL, COCKPIT_PASSWORD);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${OUT_DIR}/cockpit-crm.png`, fullPage: true });
  });
});

test.describe('reskin visual capture — LMS regression guard (baseURL :5175)', () => {
  test.use({ baseURL: 'http://localhost:5175' });

  // LMS is out of scope for the re-skin (kid-friendly theme, .lms-app-root scoped) — this
  // capture is the "must stay visually identical" baseline for later phases' LMS-untouched
  // acceptance criterion. No wireframe counterpart; capture only.
  test('lms-regression-guard — LMS login gate stays untouched by the re-skin', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Học tập cùng CMC/i })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${OUT_DIR}/lms-regression-guard.png`, fullPage: true });
  });
});
