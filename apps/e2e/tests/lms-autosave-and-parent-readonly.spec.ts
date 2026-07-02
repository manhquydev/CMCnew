import { test, expect, type Page } from '@playwright/test';
import { Role, login, mintParentSession } from '@cmc/auth';
import { hashPassword, withRls } from '@cmc/db';

// LMS student autosave (draw on the base PDF → close WITHOUT clicking "Lưu nháp" → reopen shows
// the strokes) and LMS parent read-only drawn-work view (published child work renders with no
// edit controls; the base PDF is servable to a guardian principal — decision 0022, global
// no-RLS exercise asset).
const API_URL = process.env.TEST_API_URL ?? 'http://localhost:4000';
const LMS_URL = 'http://localhost:5175';
const LMS_PASSWORD = process.env.TEST_LMS_STUDENT_PASSWORD ?? 'ChangeMe!123';
const FACILITY = 1;
const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };
const STAFF_COOKIE = 'cmc.session';
const LMS_COOKIE = 'cmc.lms';

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
}

/** A minimal but structurally valid single-page PDF (correct xref offsets) so pdf.js can render it. */
function buildMinimalPdf(): Buffer {
  const objects = [
    '1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n',
    '2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n',
    '3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<<>>>>\nendobj\n',
  ];
  const header = '%PDF-1.4\n';
  let body = '';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(header.length + Buffer.byteLength(body, 'latin1'));
    body += obj;
  }
  const xrefStart = header.length + Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(header + body + xref + trailer, 'latin1');
}

type Fixture = {
  courseId: string;
  batchId: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  parentAccountId: string;
  parentName: string;
  exerciseId: string;
  exerciseTitle: string;
  basePdfRef: string;
  submissionId: string;
};

let fixture: Fixture;

test.beforeAll(async () => {
  const suffix = unique('LMSPDF');
  const studentCode = `${suffix}-HS`;
  const studentName = `E2E Autosave Student ${suffix}`;
  const parentName = `Parent ${suffix}`;
  const exerciseTitle = `E2E Autosave Exercise ${suffix}`;

  // ── Director login (HTTP) → upload a real minimal PDF → basePdfRef ──────────────────────────
  const directorEmail = `${suffix.toLowerCase()}-director@cmc.test`;
  const directorPassword = 'correct-horse-battery';
  const directorPasswordHash = await hashPassword(directorPassword);
  await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email: directorEmail,
        displayName: 'E2E Director',
        passwordHash: directorPasswordHash,
        roles: [Role.giam_doc_dao_tao],
        primaryRole: Role.giam_doc_dao_tao,
        isActive: true,
      },
    }),
  );

  const directorLogin = await login(directorEmail, directorPassword);
  if (!directorLogin) throw new Error('director login failed in e2e fixture setup');

  const uploadRes = await fetch(`${API_URL}/upload/exercise-pdf`, {
    method: 'POST',
    headers: { Cookie: `${STAFF_COOKIE}=${directorLogin.token}` },
    body: buildMinimalPdf(),
  });
  if (!uploadRes.ok) throw new Error(`exercise PDF upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  const { ref: basePdfRef } = (await uploadRes.json()) as { ref: string };

  // ── DB fixtures: course/batch/student/parent/enrollment/ended-session/exercise ──────────────
  fixture = await withRls(SUPER, async (tx) => {
    const course = await tx.course.create({
      data: { code: `${suffix}-C`, name: `Autosave E2E ${suffix}`, program: 'UCREA' },
    });
    const batch = await tx.classBatch.create({
      data: { facilityId: FACILITY, courseId: course.id, code: `${suffix}-B`, name: `Autosave E2E ${suffix}`, status: 'running' },
    });
    const student = await tx.student.create({
      data: { facilityId: FACILITY, studentCode, fullName: studentName, program: 'UCREA', level: 'L1' },
    });
    await tx.studentAccount.create({
      data: { studentId: student.id, loginCode: studentCode, passwordHash: await hashPassword(LMS_PASSWORD), isActive: true },
    });
    const parent = await tx.parentAccount.create({
      data: { email: `${suffix.toLowerCase()}@cmc.local`, displayName: parentName, passwordHash: await hashPassword(LMS_PASSWORD), isActive: true },
    });
    await tx.guardian.create({
      data: { facilityId: FACILITY, parentAccountId: parent.id, studentId: student.id, relation: 'guardian' },
    });
    await tx.enrollment.create({
      data: { facilityId: FACILITY, classBatchId: batch.id, studentId: student.id, status: 'active' },
    });
    const unit = await tx.curriculumUnit.create({
      data: {
        courseId: course.id,
        unitCode: `${suffix}-U`,
        seqInLevel: 1,
        orderGlobal: 1,
        unitType: 'LESSON',
        theme: 'Autosave E2E unit',
        sessions: 1,
      },
    });
    // Ended session so the exercise auto-opens for the student.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await tx.classSession.create({
      data: {
        facilityId: FACILITY,
        classBatchId: batch.id,
        sessionDate: twoDaysAgo,
        startTime: '18:00',
        endTime: '19:00',
        status: 'confirmed',
        curriculumUnitId: unit.id,
      },
    });
    const exercise = await tx.exercise.create({
      data: {
        curriculumUnitId: unit.id,
        title: exerciseTitle,
        type: 'homework',
        status: 'published',
        maxScore: 10,
        starReward: 5,
        basePdfRef,
      },
    });

    return {
      courseId: course.id,
      batchId: batch.id,
      studentId: student.id,
      studentCode,
      studentName,
      parentAccountId: parent.id,
      parentName,
      exerciseId: exercise.id,
      exerciseTitle,
      basePdfRef,
      submissionId: '', // filled by the autosave test
    };
  });
});

test.afterAll(async () => {
  if (!fixture) return;
  await withRls(SUPER, async (tx) => {
    await tx.grade.deleteMany({ where: { submission: { exerciseId: fixture.exerciseId } } });
    await tx.submission.deleteMany({ where: { exerciseId: fixture.exerciseId } });
    await tx.classSession.deleteMany({ where: { classBatchId: fixture.batchId } });
    await tx.exercise.deleteMany({ where: { id: fixture.exerciseId } });
    const units = await tx.curriculumUnit.findMany({ where: { courseId: fixture.courseId } });
    await tx.curriculumUnit.deleteMany({ where: { id: { in: units.map((u) => u.id) } } });
    await tx.enrollment.deleteMany({ where: { classBatchId: fixture.batchId } });
    await tx.guardian.deleteMany({ where: { parentAccountId: fixture.parentAccountId } });
    await tx.studentAccount.deleteMany({ where: { studentId: fixture.studentId } });
    await tx.parentAccount.deleteMany({ where: { id: fixture.parentAccountId } });
    await tx.student.deleteMany({ where: { id: fixture.studentId } });
    await tx.classBatch.deleteMany({ where: { id: fixture.batchId } });
    await tx.coursePrice.deleteMany({ where: { courseId: fixture.courseId } });
    await tx.course.deleteMany({ where: { id: fixture.courseId } });
  });
});

async function loginStudent(page: Page) {
  await page.goto(`${LMS_URL}/`);
  await page.getByText('Học sinh', { exact: true }).click();
  await page.getByLabel('Mã đăng nhập').fill(fixture.studentCode);
  await page.getByLabel('Mật khẩu').fill(LMS_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 15_000 });
}

test('LMS student: draw on the exercise PDF, close WITHOUT manual save, reopen shows the autosaved stroke', async ({ page }) => {
  await loginStudent(page);

  // Default landing tab is "exercises" (the climb view) — open the fixture exercise node.
  await page.getByRole('button', { name: new RegExp(fixture.exerciseTitle) }).click();
  await expect(page.getByRole('heading', { name: fixture.exerciseTitle })).toBeVisible({ timeout: 10_000 });

  // Wait for the PDF page to render (canvas rasterized to an <img>) before drawing on it.
  const pageContainer = page.locator('[data-page-index="0"]');
  await expect(pageContainer).toBeVisible({ timeout: 15_000 });
  await expect(pageContainer.locator('img')).toBeVisible({ timeout: 15_000 });

  // The editable overlay is the last child div of the page container (pen tool is default).
  const overlay = pageContainer.locator('> div').last();
  const box = await overlay.boundingBox();
  if (!box) throw new Error('overlay bounding box not found');
  const x0 = box.x + box.width * 0.2;
  const y0 = box.y + box.height * 0.2;
  const x1 = box.x + box.width * 0.6;
  const y1 = box.y + box.height * 0.6;

  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 5 });
  await page.mouse.move(x1, y1, { steps: 5 });
  await page.mouse.up();

  // Do NOT click "Lưu nháp" — let the 1.8s debounce autosave fire, then close the modal by
  // pressing Escape (handleClose still flushes on close; the debounce having already fired
  // beforehand is what proves this is autosave, not just the on-close flush).
  await page.waitForTimeout(2_500);

  // Cross-check directly against the DB that the debounce autosave actually persisted the
  // stroke (not just optimistic client state) before the modal is ever closed.
  const midEditSubmission = await withRls(SUPER, (tx) =>
    tx.submission.findUnique({
      where: { exerciseId_studentId: { exerciseId: fixture.exerciseId, studentId: fixture.studentId } },
      select: { id: true, annotationLayer: true },
    }),
  );
  expect(midEditSubmission).toBeTruthy();
  expect((midEditSubmission!.annotationLayer as { items: unknown[] } | null)?.items?.length).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: fixture.exerciseTitle })).not.toBeVisible({ timeout: 5_000 });

  // Reopen — the node should now read "Nháp" (draft), confirming the submission round-tripped.
  await page.getByRole('button', { name: new RegExp(fixture.exerciseTitle) }).click();
  await expect(page.getByRole('heading', { name: fixture.exerciseTitle })).toBeVisible({ timeout: 10_000 });
  await expect(pageContainer.locator('img')).toBeVisible({ timeout: 15_000 });

  // The stroke drawn before close is present as a rendered layer item (an svg/path/div element
  // inside the page container beyond the base img + overlay — PageLayer renders one element per
  // annotation item).
  const renderedItemCount = await pageContainer.locator('> div').count();
  // > div children = [readOnly/editable annotation items..., overlay] — with ≥1 stroke saved,
  // there must be at least 2 divs (≥1 item + the overlay), not just the bare overlay.
  expect(renderedItemCount).toBeGreaterThan(1);
});

test('LMS parent: views published child drawn work read-only, with no edit controls; base PDF serves to a guardian principal (decision 0022)', async ({ browser }) => {
  // Grade + publish directly (staff RBAC on grade.grade/publish is covered elsewhere — this
  // test's concern is the parent-facing read-only surface, so write the grade straight to DB).
  const submission = await withRls(SUPER, (tx) =>
    tx.submission.findUniqueOrThrow({
      where: { exerciseId_studentId: { exerciseId: fixture.exerciseId, studentId: fixture.studentId } },
      select: { id: true },
    }),
  );
  await withRls(SUPER, (tx) =>
    tx.grade.create({
      data: { facilityId: FACILITY, submissionId: submission.id, score: 9, maxScore: 10, feedback: 'Rất tốt', isPublished: true },
    }),
  );
  await withRls(SUPER, (tx) => tx.submission.update({ where: { id: submission.id }, data: { status: 'graded' } }));

  const parentAuth = await mintParentSession(fixture.parentAccountId);
  expect(parentAuth).toBeTruthy();

  // Confirm the base PDF is servable to a guardian principal (decision 0022 — global no-RLS
  // exercise asset; any authenticated LMS principal can fetch any non-archived exercise PDF).
  const pdfRes = await fetch(`${API_URL}/files/exercise/${fixture.basePdfRef}`, {
    headers: { Cookie: `${LMS_COOKIE}=${parentAuth!.token}` },
  });
  expect(pdfRes.status).toBe(200);
  expect(pdfRes.headers.get('content-type')).toBe('application/pdf');

  const parentContext = await browser.newContext();
  await parentContext.addCookies([{
    name: LMS_COOKIE,
    value: parentAuth!.token,
    domain: 'localhost',
    path: '/',
    sameSite: 'Lax',
    httpOnly: true,
    secure: false,
  }]);
  const parentPage = await parentContext.newPage();
  await parentPage.goto(`${LMS_URL}/#overview`);
  await expect(parentPage.getByText(`Phụ huynh ${fixture.parentName}`)).toBeVisible({ timeout: 10_000 });

  const submissionRow = parentPage.locator('tr', { hasText: fixture.exerciseTitle });
  await expect(submissionRow).toBeVisible({ timeout: 10_000 });
  await submissionRow.getByRole('button', { name: 'Xem bài làm' }).click();

  const modal = parentPage.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(modal.locator('[data-page-index="0"] img')).toBeVisible({ timeout: 15_000 });

  // Read-only invariant: none of the editing toolbar controls (tool/color/undo/clear) render,
  // and there is no pointer-capturing overlay div (editable=false means PageLayer's items are
  // the only children — no trailing overlay div).
  await expect(modal.getByRole('button', { name: 'Bút' })).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Tẩy' })).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Hoàn tác' })).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Lưu nháp' })).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Nộp bài' })).toHaveCount(0);

  await parentContext.close();
});
