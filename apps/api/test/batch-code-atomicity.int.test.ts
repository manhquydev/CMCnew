import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';
import { nextBatchCode } from '../src/services/batch-code.js';

/**
 * Concurrency & atomicity test for batch code generation
 * ([FacilityCode]-[ProgramAbbrev]-[YY]-[NNNN]).
 *
 * Invariant: concurrent batch creations in the same (facility, program, year) MUST:
 * - produce UNIQUE codes (no duplicates)
 * - follow the format [FacilityCode]-[ProgramAbbrev]-[YY]-[NNNN]
 * - be contiguous/sequential (no gaps in sequence number)
 *
 * The service uses pg_advisory_xact_lock(facilityId, year*10+programIndex) to
 * serialize access. Without the lock, this test would fail with duplicates —
 * removing the lock would make concurrent calls race and produce collisions.
 */
describe('batch code atomicity (concurrent generation)', () => {
  const FACILITY = 1; // HQ (seeded)
  const FACILITY_CODE = 'HQ';
  const PROGRAM = 'UCREA';
  const CONCURRENT_COUNT = 15; // Race 15 concurrent generates
  const DIRECT_TX_YEAR = 3000; // Year for direct tx test
  const TRPC_YEAR = 3001; // Year for tRPC test
  const SEQUENTIAL_YEAR = 3002; // Year for sequential control test

  let courseId: string;
  const created = { courseIds: [] as string[], batchIds: [] as string[] };

  beforeAll(async () => {
    const courseCode = uniq('CRS_BATCH');
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: courseCode, name: 'Batch test course', program: 'UCREA' },
      });
      courseId = course.id;
      created.courseIds.push(course.id);
    });
  });

  afterAll(async () => {
    // Clean up all created batches and reset the counters
    await withRls(SUPER, async (tx) => {
      await tx.classBatch.deleteMany({ where: { id: { in: created.batchIds } } });
      // Reset counters for all years used in tests
      await tx.batchCodeCounter.delete({
        where: { facilityId_program_year: { facilityId: FACILITY, program: PROGRAM, year: DIRECT_TX_YEAR } },
      }).catch(() => {});
      await tx.batchCodeCounter.delete({
        where: { facilityId_program_year: { facilityId: FACILITY, program: PROGRAM, year: TRPC_YEAR } },
      }).catch(() => {});
      await tx.batchCodeCounter.delete({
        where: { facilityId_program_year: { facilityId: FACILITY, program: PROGRAM, year: SEQUENTIAL_YEAR } },
      }).catch(() => {});
      await tx.course.deleteMany({ where: { id: { in: created.courseIds } } });
    });
  });

  it('concurrent nextBatchCode calls via direct tx produce unique, sequential codes', async () => {
    // Test the nextBatchCode function directly via raw Prisma transactions,
    // bypassing tRPC to isolate the advisory lock behavior.
    const codes: string[] = [];

    // Fire N concurrent direct calls to nextBatchCode via withRls.
    const promises = Array.from({ length: CONCURRENT_COUNT }, (_, i) =>
      withRls(SUPER, async (tx) => {
        try {
          const code = await nextBatchCode(tx, FACILITY, FACILITY_CODE, PROGRAM, DIRECT_TX_YEAR);
          return { code, index: i };
        } catch (err) {
          console.log(`nextBatchCode ${i} failed:`, (err as Error).message);
          return null;
        }
      }),
    );

    const results = await Promise.all(promises);
    const successful = results.filter((r) => r !== null);

    // Collect codes from successful results.
    successful.forEach((result) => {
      if (result) codes.push(result.code);
    });

    // With proper advisory locking, all concurrent calls should succeed (lock serializes them).
    // If some fail, the lock is not preventing duplicate sequence numbers.
    expect(codes.length).toBe(CONCURRENT_COUNT);

    // 1. All codes must be UNIQUE.
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(CONCURRENT_COUNT);

    // 2. All codes must follow the [FacilityCode]-[ProgramAbbrev]-[YY]-[NNNN] format.
    const formatRegex = /^HQ-UCR-\d{2}-\d{4}$/;
    const expectedYY = String(DIRECT_TX_YEAR).slice(-2).padStart(2, '0');
    codes.forEach((code) => {
      expect(code).toMatch(formatRegex);
      const parts = code.split('-');
      expect(parts[0]).toBe('HQ');
      expect(parts[1]).toBe('UCR');
      expect(parts[2]).toBe(expectedYY);
    });

    // 3. Sequence numbers must be contiguous (1 through CONCURRENT_COUNT).
    const sequences = codes.map((code) => {
      const match = code.match(/-(\d{4})$/);
      return parseInt(match![1]);
    }).sort((a, b) => a - b);

    expect(sequences[0]).toBe(1);
    expect(sequences[CONCURRENT_COUNT - 1]).toBe(CONCURRENT_COUNT);
    for (let i = 0; i < sequences.length - 1; i++) {
      expect(sequences[i + 1]).toBe(sequences[i] + 1);
    }

    // 4. Verify the counter.
    const counter = await withRls(SUPER, (tx) =>
      tx.batchCodeCounter.findUnique({
        where: { facilityId_program_year: { facilityId: FACILITY, program: PROGRAM, year: DIRECT_TX_YEAR } },
      }),
    );
    expect(counter).toBeDefined();
    expect(counter?.lastSeq).toBe(CONCURRENT_COUNT);
  });

  it('concurrent batch creates via tRPC produce unique, sequential, formatted codes', async () => {
    const caller = await staffCaller();

    // Fire N concurrent batch creations for the same facility+year via tRPC.
    // Each call goes through classBatchRouter.create → nextBatchCode,
    // which acquires a transaction-scoped advisory lock to prevent collisions.
    const promises = Array.from({ length: CONCURRENT_COUNT }, (_, i) =>
      caller.classBatch.create({
        facilityId: FACILITY,
        courseId,
        name: `Batch ${i} at ${new Date().toISOString()}`,
        startDate: `${TRPC_YEAR}-01-15`,
        endDate: `${TRPC_YEAR}-12-31`,
        capacity: 30 + i,
      }).catch((err) => {
        // If errors occur, collect them for analysis
        console.log(`tRPC Batch ${i} failed:`, err.message);
        return null;
      }),
    );

    const results = await Promise.all(promises);
    const successful = results.filter((r) => r !== null);

    // With proper locking, all concurrent tRPC calls should succeed.
    expect(successful.length).toBe(CONCURRENT_COUNT);
    successful.forEach((batch) => {
      expect(batch).toBeDefined();
      expect(batch.id).toBeTruthy();
      created.batchIds.push(batch.id);
    });

    // Extract codes from successful results.
    const codes = successful.map((batch) => batch.code);

    // 1. All codes must be UNIQUE.
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(CONCURRENT_COUNT);

    // 2. All codes must follow the [FacilityCode]-[ProgramAbbrev]-[YY]-[NNNN] format.
    const formatRegex = /^HQ-UCR-\d{2}-\d{4}$/;
    const expectedYY = String(TRPC_YEAR).slice(-2).padStart(2, '0');
    codes.forEach((code) => {
      expect(code).toMatch(formatRegex);
      const parts = code.split('-');
      expect(parts[0]).toBe('HQ');
      expect(parts[1]).toBe('UCR');
      expect(parts[2]).toBe(expectedYY);
    });

    // 3. Sequence numbers must be contiguous.
    const sequences = codes.map((code) => {
      const match = code.match(/-(\d{4})$/);
      return parseInt(match![1]);
    }).sort((a, b) => a - b);

    expect(sequences[0]).toBe(1);
    expect(sequences[CONCURRENT_COUNT - 1]).toBe(CONCURRENT_COUNT);
    for (let i = 0; i < sequences.length - 1; i++) {
      expect(sequences[i + 1]).toBe(sequences[i] + 1);
    }

    // 4. Verify the counter.
    const counter = await withRls(SUPER, (tx) =>
      tx.batchCodeCounter.findUnique({
        where: { facilityId_program_year: { facilityId: FACILITY, program: PROGRAM, year: TRPC_YEAR } },
      }),
    );
    expect(counter).toBeDefined();
    expect(counter?.lastSeq).toBe(CONCURRENT_COUNT);
  });

  it('sequential batch creates produce incrementing codes (baseline control)', async () => {
    const caller = await staffCaller();

    // Create batches sequentially (not raced), one by one.
    const codes: string[] = [];
    const batchIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const batch = await caller.classBatch.create({
        facilityId: FACILITY,
        courseId,
        name: `Sequential batch ${i}`,
        startDate: `${SEQUENTIAL_YEAR}-01-15`,
        endDate: `${SEQUENTIAL_YEAR}-12-31`,
        capacity: 25,
      });
      codes.push(batch.code);
      batchIds.push(batch.id);
      created.batchIds.push(batch.id);
    }

    // Sequential codes should be HQ-UCR-YY-0001, HQ-UCR-YY-0002, ..., HQ-UCR-YY-0005.
    const yy = String(SEQUENTIAL_YEAR).slice(-2).padStart(2, '0');
    expect(codes).toEqual([
      `HQ-UCR-${yy}-0001`,
      `HQ-UCR-${yy}-0002`,
      `HQ-UCR-${yy}-0003`,
      `HQ-UCR-${yy}-0004`,
      `HQ-UCR-${yy}-0005`,
    ]);
  });
});
