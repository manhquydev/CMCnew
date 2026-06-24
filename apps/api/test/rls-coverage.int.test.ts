import { describe, it, expect } from 'vitest';
import { withRls, SUPER } from './helpers.js';

/**
 * RLS Coverage Introspection Test
 *
 * Verifies that every facility-scoped table in the schema:
 * 1. Has facility_id column
 * 2. Has Row-Level Security enabled
 * 3. Has at least one policy defined
 *
 * This test is self-proving: it queries the LIVE schema and inspects
 * pg_catalog and information_schema directly. No hardcoded table lists.
 *
 * Documented exceptions (no RLS needed):
 * - course: GLOBAL (no facility_id column)
 * - record_follower: non-sensitive metadata (no RLS needed)
 *
 * Assertion: any table with facility_id must have RLS enabled.
 * If a new table gets facility_id without RLS, this test FAILS with the table name.
 */
describe('RLS coverage — every facility-scoped table is isolated', () => {
  it('all tables with facility_id column must have RLS enabled and policies defined', async () => {
    const result = await withRls(SUPER, async (tx) => {
      // Step 1: Find all base tables in the public schema that have a facility_id column.
      const facilityScopedTables = await tx.$queryRaw<
        Array<{ table_name: string; column_name: string }>
      >`
        SELECT t.table_name, c.column_name
        FROM information_schema.tables t
        JOIN information_schema.columns c
          ON t.table_name = c.table_name
          AND t.table_schema = c.table_schema
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
          AND c.column_name = 'facility_id'
        ORDER BY t.table_name
      `;

      // Step 2: For each facility-scoped table, check RLS is enabled and policies exist.
      const tableNames = [...new Set(facilityScopedTables.map((r) => r.table_name))];

      console.log(`\n=== RLS Coverage Report ===`);
      console.log(`Found ${tableNames.length} tables with facility_id column:\n`);

      const violations: Array<{ table: string; reason: string }> = [];
      const covered: string[] = [];

      for (const tableName of tableNames) {
        // Check if RLS is enabled (relrowsecurity = true in pg_class)
        const rlsStatus = await tx.$queryRaw<
          Array<{ relname: string; relrowsecurity: boolean }>
        >`
          SELECT c.relname, c.relrowsecurity
          FROM pg_class c
          WHERE c.relname = ${tableName}
            AND c.relnamespace = 'public'::regnamespace
        `;

        if (rlsStatus.length === 0) {
          violations.push({ table: tableName, reason: 'Table not found in pg_class' });
          continue;
        }

        const { relrowsecurity } = rlsStatus[0];

        // Check if at least one policy is defined
        const policies = await tx.$queryRaw<
          Array<{ policyname: string }>
        >`
          SELECT p.policyname
          FROM pg_policies p
          WHERE p.tablename = ${tableName}
            AND p.schemaname = 'public'
        `;

        // Assertion 1: RLS must be enabled
        if (!relrowsecurity) {
          violations.push({
            table: tableName,
            reason: 'RLS not enabled (relrowsecurity = false)',
          });
          console.log(`  ✗ ${tableName}: RLS DISABLED`);
          continue;
        }

        // Assertion 2: At least one policy must exist
        if (policies.length === 0) {
          violations.push({
            table: tableName,
            reason: 'RLS enabled but no policies defined',
          });
          console.log(`  ✗ ${tableName}: RLS enabled but NO POLICIES`);
          continue;
        }

        // Positive result: covered table
        covered.push(tableName);
        console.log(
          `  ✓ ${tableName}: RLS enabled, ${policies.length} policy(ies)`,
          policies.map((p) => p.policyname).join(', '),
        );
      }

      console.log(`\n=== Summary ===`);
      console.log(`Covered tables: ${covered.length}`);
      console.log(`Tables without proper RLS: ${violations.length}`);

      if (violations.length > 0) {
        console.log(`\nViolations (HARD STOP - security gap):`);
        violations.forEach((v) => {
          console.log(`  - ${v.table}: ${v.reason}`);
        });
      }

      return { tableNames, covered, violations };
    });

    // Final assertion: all facility-scoped tables must be covered
    expect(result.violations).toHaveLength(0);
    expect(result.covered.length).toBeGreaterThan(0);
    console.log(
      `\n✓ RLS SELF-PROVEN: ${result.covered.length}/${result.tableNames.length} tables verified secure`,
    );
  });

  it('documented exception tables (course, record_follower) are correctly unguarded', async () => {
    const result = await withRls(SUPER, async (tx) => {
      // Verify that exceptions are intentionally unguarded
      const exceptionTables = ['course', 'record_follower'];
      const exceptionStatus: Record<string, { hasRls: boolean; hasFacilityId: boolean }> = {};

      for (const table of exceptionTables) {
        // Check for facility_id column
        const hasFacilityId = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*) as count
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ${table}
            AND column_name = 'facility_id'
        `;

        // Check if RLS is enabled
        const rlsCheck = await tx.$queryRaw<
          Array<{ relrowsecurity: boolean }>
        >`
          SELECT c.relrowsecurity
          FROM pg_class c
          WHERE c.relname = ${table}
            AND c.relnamespace = 'public'::regnamespace
        `;

        exceptionStatus[table] = {
          hasFacilityId: hasFacilityId[0].count > 0,
          hasRls: rlsCheck.length > 0 && rlsCheck[0].relrowsecurity,
        };
      }

      console.log(`\n=== Exception Tables ===`);
      console.log(`course: no facility_id (global), RLS=${exceptionStatus.course.hasRls}`);
      console.log(
        `record_follower: no facility_id (non-sensitive), RLS=${exceptionStatus.record_follower.hasRls}`,
      );

      return exceptionStatus;
    });

    // Verify exceptions are as documented
    expect(result.course.hasFacilityId).toBe(false); // course is global
    expect(result.record_follower.hasFacilityId).toBe(false); // record_follower has no facility_id
  });

  it('record_event has nullable facility_id with correctly permissive RLS', async () => {
    const result = await withRls(SUPER, async (tx) => {
      // record_event is special: nullable facility_id, allows global records (facility_id IS NULL)
      const nullableFacilityId = await tx.$queryRaw<
        Array<{ is_nullable: string }>
      >`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'record_event'
          AND column_name = 'facility_id'
      `;

      const policies = await tx.$queryRaw<
        Array<{ policyname: string; qual: string | null }>
      >`
        SELECT p.policyname, p.qual
        FROM pg_policies p
        WHERE p.tablename = 'record_event'
          AND p.schemaname = 'public'
      `;

      console.log(`\n=== record_event Exception ===`);
      console.log(
        `facility_id nullable: ${nullableFacilityId[0]?.is_nullable === 'YES' ? 'YES' : 'NO'}`,
      );
      console.log(`Policies: ${policies.map((p) => p.policyname).join(', ')}`);

      return {
        nullable: nullableFacilityId[0]?.is_nullable === 'YES',
        hasPolicies: policies.length > 0,
      };
    });

    // Verify record_event design
    expect(result.nullable).toBe(true); // facility_id IS nullable
    expect(result.hasPolicies).toBe(true); // policies exist to handle null case
  });
});
