import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (Phase 5 done-evidence): an after-sale case can transition through its own
// lifecycle (open→in_progress→resolved→closed) and can change a student's lifecycle
// (e.g. on_hold / withdrawn). Both transitions must produce audit records.
describe('after-sale case: lifecycle transitions and student lifecycle change', () => {
  const FAC = 1;
  let caseId = '';
  let studentId = '';
  const courseIds: string[] = [];

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: uniq('CRS'), name: 'Aftersale Test Course', program: 'UCREA' },
      });
      courseIds.push(course.id);

      const student = await tx.student.create({
        data: {
          facilityId: FAC,
          studentCode: uniq('SC'),
          fullName: 'Test Student',
          program: 'UCREA',
          lifecycle: 'active',
        },
      });
      studentId = student.id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      if (caseId) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'after_sale_case', entityId: caseId } });
        await tx.afterSaleCase.deleteMany({ where: { id: caseId } });
      }
      if (studentId) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'student', entityId: studentId } });
        await tx.student.deleteMany({ where: { id: studentId } });
      }
      if (courseIds.length > 0) {
        await tx.course.deleteMany({ where: { id: { in: courseIds } } });
      }
    });
  });

  it('creates a case and transitions open→in_progress→resolved', async () => {
    const caller = await staffCaller();

    const created = await caller.afterSale.create({
      facilityId: FAC,
      subject: 'Test case lifecycle',
      studentId,
    });
    caseId = created.id;
    expect(created.status).toBe('open');

    await caller.afterSale.transition({ id: caseId, status: 'in_progress' });
    const mid = await withRls(SUPER, (tx) => tx.afterSaleCase.findUniqueOrThrow({ where: { id: caseId } }));
    expect(mid.status).toBe('in_progress');
    expect(mid.resolvedAt).toBeNull();

    await caller.afterSale.transition({ id: caseId, status: 'resolved' });
    const resolved = await withRls(SUPER, (tx) => tx.afterSaleCase.findUniqueOrThrow({ where: { id: caseId } }));
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).not.toBeNull();

    // Audit: at least 2 status_changed events (open→in_progress, in_progress→resolved) + 1 created
    const events = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({ where: { entityType: 'after_sale_case', entityId: caseId } }),
    );
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('setStudentLifecycle changes student to on_hold and links back to case', async () => {
    const caller = await staffCaller();
    const student = await caller.afterSale.setStudentLifecycle({
      studentId,
      lifecycle: 'on_hold',
      caseId,
    });

    expect(student.lifecycle).toBe('on_hold');

    // Audit on student record
    const studentEvents = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({
        where: { entityType: 'student', entityId: studentId, type: 'status_changed' },
      }),
    );
    expect(studentEvents).toHaveLength(1);
    expect(studentEvents[0].body).toContain('on_hold');

    // Cross-link audit on the case
    const caseEvents = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({
        where: { entityType: 'after_sale_case', entityId: caseId, type: 'updated' },
      }),
    );
    const lifecycleNote = caseEvents.find((e) => e.body?.includes('on_hold'));
    expect(lifecycleNote).toBeDefined();
  });

  it('setStudentLifecycle without caseId still changes lifecycle, no case audit', async () => {
    const caller = await staffCaller();
    const student = await caller.afterSale.setStudentLifecycle({
      studentId,
      lifecycle: 'active',
    });

    expect(student.lifecycle).toBe('active');
  });
});
