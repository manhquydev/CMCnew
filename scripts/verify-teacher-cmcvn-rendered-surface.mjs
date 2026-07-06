import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const origin = process.env.TEACHER_SURFACE_URL ?? 'https://teacher.cmcvn.edu.vn/';
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: 'networkidle', timeout: 30_000 });

  const title = await page.title();
  const bodyText = await page.locator('body').innerText({ timeout: 10_000 });

  if (!title.includes('CMC Teacher')) {
    throw new Error(`Expected rendered title to include "CMC Teacher", got "${title}"`);
  }
  if (!bodyText.includes('CMC Teacher')) {
    throw new Error('Expected rendered body to include "CMC Teacher"');
  }
  if (bodyText.includes('CMC Staff Portal')) {
    throw new Error('Teacher surface still renders the generic staff/ERP login portal');
  }

  console.log(JSON.stringify({
    url: origin,
    title,
    hasTeacherBrand: bodyText.includes('CMC Teacher'),
    status: 'pass',
  }, null, 2));
} finally {
  await browser.close();
}
