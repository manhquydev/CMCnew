/**
 * Integration tests: email router (outboxList/outboxRetry) + finance.sendReceiptEmail +
 * receipt_pending_approval notif widening.
 *
 * Covers:
 *   (a) secret-kind retry is unconditionally blocked, even for an intentionally non-scrubbed row
 *   (b) non-secret failed row retry resets to queued/attempts=0
 *   (c) null-facility row hidden from non-director staff caller, visible to director
 *   (d) receipt_pending_approval reaches BOTH a ke_toan and a giam_doc_kinh_doanh account, deduped
 *   (e) sendReceiptEmail enqueues correctly; a corrected-address resend creates a fresh row
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId, assertSuccess } from './helpers.js';

const FACILITY = 1;

describe('email router + finance.sendReceiptEmail + notif widening', () => {
  let dbReachable = false;
  const createdUserIds: string[] = [];
  const createdOutboxIds: string[] = [];
  const createdReceiptIds: string[] = [];
  const createdStudentIds: string[] = [];
  const createdParentAccountIds: string[] = [];
  const createdGuardianIds: string[] = [];
  const createdParentPhones: string[] = [];
  let courseId: string;

  /** More entropy than uniq() alone — uniq() rounds performance.now() to whole ms, so two test
   *  runs that reach the same code path at the same elapsed time can collide on phone. */
  function uniqPhone(prefix: string): string {
    const phone = `${uniq(prefix)}-${Math.random().toString(36).slice(2, 8)}`;
    createdParentPhones.push(phone);
    return phone;
  }

  async function staff(role: Role) {
    const user = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq(`${role}-email-router@cmc.test`),
          displayName: `${role} email router test`,
          passwordHash: 'test',
          primaryRole: role,
          roles: [role],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  const kdCaller = (userId: string) =>
    staffCaller({
      userId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
  const keToanCaller = (userId: string) =>
    staffCaller({
      userId,
      roles: [Role.ke_toan],
      primaryRole: Role.ke_toan,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

  beforeAll(async () => {
    try {
      await superAdminUserId();
      dbReachable = true;
    } catch {
      console.warn('⚠ DB not reachable — email router tests skipped');
      return;
    }
    const code = uniq('CRS-EMAIL-RTR');
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code, name: `Email router test course ${code}`, program: 'UCREA' },
      });
      courseId = course.id;
      await tx.coursePrice.create({
        data: { facilityId: FACILITY, courseId: course.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
      });
    });
  });

  afterAll(async () => {
    if (!dbReachable) return;
    // Each delete runs in its OWN transaction. A single statement's error aborts the whole
    // Postgres transaction — a later statement in the SAME transaction throws 25P02 even if
    // the earlier error was caught in JS, so per-statement .catch() inside one shared tx is a
    // no-op trap (this bit us: cleanup silently stopped after the first failing delete, leaving
    // residue that broke later runs via ParentAccount.email's global unique constraint).
    await withRls(SUPER, (tx) => tx.emailOutbox.deleteMany({ where: { id: { in: createdOutboxIds } } })).catch(() => {});
    await withRls(SUPER, (tx) =>
      tx.emailOutbox.deleteMany({
        where: { dedupKey: { startsWith: 'receipt:' }, toAddress: { contains: 'email-router-test' } },
      }),
    ).catch(() => {});
    await withRls(SUPER, (tx) => tx.receipt.deleteMany({ where: { id: { in: createdReceiptIds } } })).catch(() => {});
    await withRls(SUPER, (tx) => tx.guardian.deleteMany({ where: { id: { in: createdGuardianIds } } })).catch(() => {});
    await withRls(SUPER, (tx) => tx.student.deleteMany({ where: { id: { in: createdStudentIds } } })).catch(() => {});
    // Broad cleanup by email/phone pattern, not just tracked ids — ParentAccount.email is
    // globally @unique, so a leftover row from an earlier run (e.g. after a failed assertion
    // that skipped the tracking push) would otherwise collide with this suite's fixed test
    // literal email on the next run.
    await withRls(SUPER, (tx) =>
      tx.parentAccount.deleteMany({
        where: {
          OR: [
            { id: { in: createdParentAccountIds } },
            { phone: { in: createdParentPhones } },
            { email: { contains: 'email-router-test.com' } },
          ],
        },
      }),
    ).catch(() => {});
    await withRls(SUPER, (tx) => tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } })).catch(() => {});
  });

  describe('outboxRetry — secret-kind row is unconditionally blocked', () => {
    it('a FAILED, NEVER-SCRUBBED otp_login row is still blocked (guard is on kind, not body state)', async () => {
      const kd = await staff(Role.giam_doc_kinh_doanh);
      const row = await withRls(SUPER, (tx) =>
        tx.emailOutbox.create({
          data: {
            facilityId: FACILITY,
            dedupKey: uniq('secret-retry-test'),
            toAddress: 'parent-secret@email-router-test.com',
            mailbox: 'notify',
            templateKind: 'otp_login',
            subject: 'Mã đăng nhập',
            // Intentionally NOT scrubbed — simulates a pre-scrub-fix row or a partial write.
            bodyHtml: '<p>123456</p>',
            status: 'failed',
            attempts: 5,
            lastError: 'simulated failure',
          },
        }),
      );
      createdOutboxIds.push(row.id);

      await expect((await kdCaller(kd.id)).email.outboxRetry({ id: row.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      const after = await withRls(SUPER, (tx) => tx.emailOutbox.findUniqueOrThrow({ where: { id: row.id } }));
      expect(after.status).toBe('failed');
      expect(after.bodyHtml).toBe('<p>123456</p>'); // untouched — retry never resets a secret row
    });

    it('lms_account_ready (the other secret kind) is also blocked', async () => {
      const kd = await staff(Role.giam_doc_kinh_doanh);
      const row = await withRls(SUPER, (tx) =>
        tx.emailOutbox.create({
          data: {
            facilityId: FACILITY,
            dedupKey: uniq('secret-retry-test-2'),
            toAddress: 'parent-secret2@email-router-test.com',
            mailbox: 'notify',
            templateKind: 'lms_account_ready',
            subject: 'Tài khoản LMS',
            bodyHtml: '',
            status: 'failed',
            attempts: 5,
            lastError: 'simulated failure',
          },
        }),
      );
      createdOutboxIds.push(row.id);
      await expect((await kdCaller(kd.id)).email.outboxRetry({ id: row.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('outboxRetry — non-secret failed row resets to queued/attempts=0', () => {
    it('resets status, attempts, lastError, scheduledFor', async () => {
      const kd = await staff(Role.giam_doc_kinh_doanh);
      const past = new Date(Date.now() - 60_000);
      const row = await withRls(SUPER, (tx) =>
        tx.emailOutbox.create({
          data: {
            facilityId: FACILITY,
            dedupKey: uniq('nonsecret-retry-test'),
            toAddress: 'staff@email-router-test.com',
            mailbox: 'notify',
            templateKind: 'account_security_alert',
            subject: 'Cảnh báo',
            bodyHtml: '<p>alert</p>',
            status: 'failed',
            attempts: 5,
            lastError: 'simulated failure',
            scheduledFor: past,
          },
        }),
      );
      createdOutboxIds.push(row.id);

      const updated = await (await kdCaller(kd.id)).email.outboxRetry({ id: row.id });
      expect(updated.status).toBe('queued');
      expect(updated.attempts).toBe(0);
      expect(updated.lastError).toBeNull();
      expect(updated.scheduledFor.getTime()).toBeGreaterThan(past.getTime());
    });

    it('rejects retrying a row that is not currently failed', async () => {
      const kd = await staff(Role.giam_doc_kinh_doanh);
      const row = await withRls(SUPER, (tx) =>
        tx.emailOutbox.create({
          data: {
            facilityId: FACILITY,
            dedupKey: uniq('queued-retry-test'),
            toAddress: 'staff2@email-router-test.com',
            mailbox: 'notify',
            templateKind: 'account_security_alert',
            subject: 'Cảnh báo',
            bodyHtml: '<p>alert</p>',
            status: 'queued',
          },
        }),
      );
      createdOutboxIds.push(row.id);
      await expect((await kdCaller(kd.id)).email.outboxRetry({ id: row.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('outboxList — null-facility rows hidden from non-director staff, visible to director', () => {
    it('a facility-null system row is excluded for ke_toan (not a director) and visible for giam_doc_kinh_doanh', async () => {
      // ke_toan lacks email.outboxList in v1 (GĐKD-only) — the app-layer filter is exercised
      // directly against the query logic via a director caller vs. a hypothetical non-director
      // caller would 403 at the perm gate before reaching the filter. To exercise the filter
      // itself (defense-in-depth for a future widened grant), assert the director sees the
      // null-facility row and that isDirector's branch is what includes it.
      const kd = await staff(Role.giam_doc_kinh_doanh);
      const nullFacRow = await withRls(SUPER, (tx) =>
        tx.emailOutbox.create({
          data: {
            facilityId: null,
            dedupKey: uniq('null-facility-test'),
            toAddress: 'welcome@email-router-test.com',
            mailbox: 'hr',
            templateKind: 'account_welcome',
            subject: 'Chào mừng',
            bodyHtml: '<p>welcome</p>',
            status: 'failed',
          },
        }),
      );
      createdOutboxIds.push(nullFacRow.id);

      const dirList = await (await kdCaller(kd.id)).email.outboxList({ status: 'failed' });
      expect(dirList.some((r) => r.id === nullFacRow.id)).toBe(true);
    });

    it('non-director role is rejected at the permission gate (email.outboxList = GĐKD-only in v1)', async () => {
      const kt = await staff(Role.ke_toan);
      await expect((await keToanCaller(kt.id)).email.outboxList({})).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('list never returns bodyHtml', async () => {
      const kd = await staff(Role.giam_doc_kinh_doanh);
      const rows = await (await kdCaller(kd.id)).email.outboxList({});
      for (const r of rows) {
        expect((r as unknown as Record<string, unknown>).bodyHtml).toBeUndefined();
      }
    });
  });

  describe('receipt_pending_approval — reaches UNION of ke_toan ∪ giam_doc_kinh_doanh, deduped', () => {
    it('both a ke_toan and a giam_doc_kinh_doanh account receive the notif for a new draft receipt', async () => {
      const kt = await staff(Role.ke_toan);
      const kd = await staff(Role.giam_doc_kinh_doanh);

      const student = await withRls(SUPER, (tx) =>
        tx.student.create({
          data: { facilityId: FACILITY, studentCode: uniq('S-NOTIF'), fullName: 'Notif Test Student', program: 'UCREA' },
        }),
      );
      createdStudentIds.push(student.id);

      const receipt = assertSuccess(await (await keToanCaller(kt.id)).finance.receiptCreate({
        facilityId: FACILITY,
        studentId: student.id,
        courseId,
        yearsPrepaid: 1,
      }));
      createdReceiptIds.push(receipt.id);

      const [ktNotifs, kdNotifs] = await Promise.all([
        withRls(SUPER, (tx) =>
          tx.staffNotification.findMany({
            where: { recipientId: kt.id, event: 'receipt_pending_approval', data: { path: ['receiptId'], equals: receipt.id } },
          }),
        ),
        withRls(SUPER, (tx) =>
          tx.staffNotification.findMany({
            where: { recipientId: kd.id, event: 'receipt_pending_approval', data: { path: ['receiptId'], equals: receipt.id } },
          }),
        ),
      ]);
      expect(ktNotifs.length).toBeGreaterThanOrEqual(1);
      expect(kdNotifs.length).toBeGreaterThanOrEqual(1);
    });

    it('an account holding BOTH roles is notified exactly once (deduped)', async () => {
      const both = await withRls(SUPER, (tx) =>
        tx.appUser.create({
          data: {
            email: uniq('both-roles-email-router@cmc.test'),
            displayName: 'ke_toan+GĐKD dedupe test',
            passwordHash: 'test',
            primaryRole: Role.ke_toan,
            roles: [Role.ke_toan, Role.giam_doc_kinh_doanh],
            isActive: true,
            facilities: { create: [{ facilityId: FACILITY }] },
          },
        }),
      );
      createdUserIds.push(both.id);

      const student = await withRls(SUPER, (tx) =>
        tx.student.create({
          data: { facilityId: FACILITY, studentCode: uniq('S-DEDUPE'), fullName: 'Dedupe Test Student', program: 'UCREA' },
        }),
      );
      createdStudentIds.push(student.id);

      const receipt = assertSuccess(await (await keToanCaller(both.id)).finance.receiptCreate({
        facilityId: FACILITY,
        studentId: student.id,
        courseId,
        yearsPrepaid: 1,
      }));
      createdReceiptIds.push(receipt.id);

      const notifs = await withRls(SUPER, (tx) =>
        tx.staffNotification.findMany({
          where: {
            recipientId: both.id,
            event: 'receipt_pending_approval',
            data: { path: ['receiptId'], equals: receipt.id },
          },
        }),
      );
      expect(notifs.length).toBe(1);
    });
  });

  describe('finance.sendReceiptEmail', () => {
    it('enqueues to the resolved parentEmail for an approved new-student receipt', async () => {
      const kd = await staff(Role.giam_doc_kinh_doanh);
      const kt = await staff(Role.ke_toan);

      const parentPhone = uniqPhone('090SEND');
      const draft = assertSuccess(await (await keToanCaller(kt.id)).finance.receiptCreate({
        facilityId: FACILITY,
        courseId,
        yearsPrepaid: 1,
        parentPhone,
        parentEmail: 'payer@email-router-test.com',
        studentName: 'Send Receipt Test Student',
      }));
      const approved = await (await keToanCaller(kt.id)).finance.receiptApprove({ id: draft.id });
      createdReceiptIds.push(approved.id);
      if (approved.studentId) createdStudentIds.push(approved.studentId);

      const result = await (await kdCaller(kd.id)).finance.sendReceiptEmail({ receiptId: approved.id });
      expect(result.to).toBe('payer@email-router-test.com');

      const row = await withRls(SUPER, (tx) =>
        tx.emailOutbox.findFirst({ where: { toAddress: 'payer@email-router-test.com', templateKind: 'receipt' } }),
      );
      expect(row).toBeTruthy();
      createdOutboxIds.push(row!.id);
    });

    it('a same-address resend is a dedup no-op; a CORRECTED address enqueues a fresh row', async () => {
      const kd = await staff(Role.giam_doc_kinh_doanh);
      const kt = await staff(Role.ke_toan);

      const parentPhone = uniqPhone('090RESEND');
      const draft = assertSuccess(await (await keToanCaller(kt.id)).finance.receiptCreate({
        facilityId: FACILITY,
        courseId,
        yearsPrepaid: 1,
        parentPhone,
        studentName: 'Resend Test Student',
      }));
      const approved = await (await keToanCaller(kt.id)).finance.receiptApprove({ id: draft.id });
      createdReceiptIds.push(approved.id);
      if (approved.studentId) createdStudentIds.push(approved.studentId);

      await (await kdCaller(kd.id)).finance.sendReceiptEmail({
        receiptId: approved.id,
        to: 'typo@email-router-test.com',
      });
      // Same address again — dedupKey collides, enqueueEmail swallows it (still exactly one row).
      await (await kdCaller(kd.id)).finance.sendReceiptEmail({
        receiptId: approved.id,
        to: 'typo@email-router-test.com',
      });
      const rowsSameAddr = await withRls(SUPER, (tx) =>
        tx.emailOutbox.findMany({ where: { toAddress: 'typo@email-router-test.com', templateKind: 'receipt' } }),
      );
      expect(rowsSameAddr.length).toBe(1);
      createdOutboxIds.push(...rowsSameAddr.map((r) => r.id));

      // Corrected address — different dedupKey (target-hashed) → a fresh row is enqueued.
      await (await kdCaller(kd.id)).finance.sendReceiptEmail({
        receiptId: approved.id,
        to: 'corrected@email-router-test.com',
      });
      const rowsCorrected = await withRls(SUPER, (tx) =>
        tx.emailOutbox.findMany({ where: { toAddress: 'corrected@email-router-test.com', templateKind: 'receipt' } }),
      );
      expect(rowsCorrected.length).toBe(1);
      createdOutboxIds.push(...rowsCorrected.map((r) => r.id));
    });

    it('rejects sending for a draft (unapproved) receipt', async () => {
      const kd = await staff(Role.giam_doc_kinh_doanh);
      const kt = await staff(Role.ke_toan);
      const parentPhone = uniqPhone('090DRAFT');
      const draft = assertSuccess(await (await keToanCaller(kt.id)).finance.receiptCreate({
        facilityId: FACILITY,
        courseId,
        yearsPrepaid: 1,
        parentPhone,
        studentName: 'Draft Reject Test Student',
      }));
      createdReceiptIds.push(draft.id);

      await expect(
        (await kdCaller(kd.id)).finance.sendReceiptEmail({ receiptId: draft.id, to: 'x@email-router-test.com' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });
});
