# Automated KPI-Based Payroll System: Research Report

## Executive Summary

**Recommendation Rank:**
1. **Build a hybrid system:** Auto-calculate KPI from factual data sources (attendance, sales receipts, class metrics), but preserve manual override with full audit trail (maker-checker approval).
2. **Schema foundation:** PostgreSQL JSONB audit table + role-based approval workflow + integration with tRPC mutations via middleware logging.
3. **Vietnam compliance:** Implement PIT calculation rules (progressive 5-band structure), BHXH contribution caps (20× salary), Decree 73/2024 bonus tiers for teachers.

---

## Topic 1: Automated KPI for Teachers in Education Centers

### Data Sources & Calculation Patterns

**What HRIS platforms do (Bamboo HR, Workday, Odoo):**
- **Primary data:** Attendance, class session completion, student grades/performance metrics
- **Secondary metrics:** LMS logins, homework submission rates, student feedback scores
- **Odoo-specific:** KPI Management modules calculate from existing Odoo data without introducing new data sources; uses configurable rulesets with tolerance buffers

**Problem:** Neither Bamboo HR nor Workday have education-specific (teacher KPI) modules; most HRIS platforms are generic HR + payroll only. You must build your own calculation engine.

### Recommended Pattern: Composite Scoring Model

Define teacher KPI as **weighted sum** of measurable components:

```
Teacher_KPI(0-100) = 
  Attendance_Component × 0.25 +
  Class_Delivery_Component × 0.35 +
  Student_Engagement_Component × 0.25 +
  Bonus_Adjustments × 0.15
```

**Concrete Data Sources (in your LMS/attendance system):**

| Component | Source Data | Calculation | Notes |
|-----------|------------|-------------|-------|
| **Attendance** | Attendance logs | (Classes attended / Classes assigned) × 100, then normalized to 0-100 | Cap ceiling at 100; tolerance for approved absences |
| **Class Delivery** | Course session completion records | (Scheduled classes completed / Scheduled classes) × 100 | "Completed" = materials uploaded, students graded |
| **Student Engagement** | LMS metrics (logins, assignment submissions, quiz pass rate) | Average of (lesson views %, assignment completion %, avg quiz score %) | Aggregate per class, then average across teacher's classes |
| **Bonus Adjustments** | Manual override + flagged exceptions | Added/subtracted by HR with approval | Require maker-checker approval (see Topic 3) |

**Critical:** Store calculations at two levels:
1. **Component table** (monthly aggregate per teacher per component)
2. **KPI audit table** (full score history with calculation breakdown)

This enables auditors to trace which data sources fed which scores.

---

## Topic 2: Automated KPI for Sales Staff

### Standard Multi-Component KPI Beyond Quota

Sales platforms (Salesforce, HubSpot, Odoo CRM) auto-feed to commission payroll via:

**Primary Component: Revenue Target Attainment**
- Formula: `(Actual Sales / Sales Quota) × 100`
- Data source: Approved invoices/receipts (not orders)
- **Integration pattern:** CRM syncs closed deals → Payroll reads from `revenue_recognized` field only

**Secondary Components (Measurable, Non-Quota):**

| Component | Measurement | Weight | Source |
|-----------|-------------|--------|--------|
| Deal velocity | Days from opportunity → close | 10-15% | CRM activity log |
| Customer retention | Renewal rate in customer base | 10-15% | CRM contracts module |
| Pipeline health | Qualified pipeline / quota ratio | 10% | CRM opportunity stage |
| Win rate | Closed deals / total opportunities | 5-10% | CRM conversion stats |

**Formula (Vietnam education center context):**
```
Sales_KPI(0-100) = 
  (Revenue_Attainment / Quota) × 80 +
  (Pipeline_Health / Target) × 10 +
  (Renewal_Rate / Target) × 10
```

**Critical Integration Checkpoint:**
- **Never read:** Unconfirmed orders, pending approvals, customer refund reversals
- **Always read:** Approved receipts with invoice status = "paid" or "scheduled_payment"
- **Flag for review:** Sales > 150% quota (fraud indicator), sales with 0-day close cycle (data entry error)

### Commission Clawback Pattern

For education center (student refunds, contract cancellations):

```sql
-- Track reversal source
CREATE TABLE commission_reversals (
  id UUID PRIMARY KEY,
  sales_id UUID REFERENCES approved_sales(id),
  reversal_reason ENUM('customer_refund', 'contract_cancel', 'churn', 'fraud'),
  amount_reversed DECIMAL(12,2),
  original_commission DECIMAL(12,2),
  approved_by UUID REFERENCES employees(id),
  created_at TIMESTAMP,
  audit_trail JSONB  -- captures decision chain
);

-- Clawback applies in next payroll cycle
-- Automatic: if approval receipt is cancelled, remove commission
-- Manual: HR can trigger via maker-checker workflow
```

---

## Topic 3: Audit Trail Patterns for KPI Overrides

### Standard Audit Trail Schema (PostgreSQL)

**Minimal viable audit table:**

```sql
CREATE TABLE kpi_audit_log (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(50),  -- 'teacher_kpi', 'sales_kpi', 'overtime'
  entity_id UUID,
  change_type VARCHAR(20),  -- 'CREATED', 'MODIFIED', 'OVERRIDE'
  old_value JSONB,  -- full old record
  new_value JSONB,  -- full new record
  changed_by UUID REFERENCES employees(id),
  approved_by UUID REFERENCES employees(id),  -- null until approved
  approval_status ENUM('pending', 'approved', 'rejected'),
  reason_text TEXT,  -- "Student grades not finalized", "Absence approved by director"
  timestamp_created TIMESTAMP DEFAULT NOW(),
  timestamp_approved TIMESTAMP,
  ip_address INET,
  metadata JSONB  -- system context: app version, batch job ID, etc.
);

-- For tracking approval chain (not just final approver)
CREATE TABLE approval_workflow (
  id BIGSERIAL PRIMARY KEY,
  kpi_audit_id BIGINT REFERENCES kpi_audit_log(id),
  approver_role VARCHAR(50),  -- 'payroll_manager', 'finance_controller', 'director'
  status ENUM('pending', 'approved', 'rejected'),
  decision_reason TEXT,
  timestamp_decided TIMESTAMP,
  delegated_from UUID REFERENCES employees(id)  -- if delegated
);
```

**What to capture in `JSONB` old/new values:**

```json
{
  "kpi_score": 75,
  "components": {
    "attendance": 85,
    "delivery": 72,
    "engagement": 65
  },
  "calculation_method": "formula_v1",
  "data_sources": {
    "attendance_from": "2026-06-01",
    "attendance_to": "2026-06-30"
  }
}
```

### Maker-Checker Workflow (Standard Pattern)

**Role definitions:**
- **Maker:** Payroll specialist prepares KPI (auto-calculated or manual entry)
- **Checker 1:** Payroll manager reviews completeness (all fields filled)
- **Checker 2:** Finance controller approves amounts (audit trail must be complete before payment)
- **Escalation:** Director approves if override > threshold (e.g., KPI change > 20 points)

**Approval Rules:**
- Auto-calculated KPI: requires 1 approval (Checker 1) for release
- Manual override KPI: requires 2 approvals + reason text
- Override > 20 points: requires director approval
- Teacher bonus (Decree 73/2024): requires director approval (school policy)

**Lock mechanism:**
```sql
CREATE TABLE payroll_locks (
  period_id UUID,  -- June 2026, July 2026
  status ENUM('open', 'locked', 'released'),
  locked_by UUID REFERENCES employees(id),
  locked_at TIMESTAMP,
  released_by UUID REFERENCES employees(id),
  released_at TIMESTAMP
);
-- Before payroll run: INSERT INTO payroll_locks SELECT period_id, 'locked', ...
-- Prevents edits after "cut-off" date
```

---

## Topic 4: Overtime Auto-Calculation for Teachers

### Standard Hours vs. Actual Hours Pattern

**Define contractual baseline:**
```sql
CREATE TABLE teacher_contracts (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  contract_start DATE,
  contract_end DATE,
  standard_hours_per_month DECIMAL(5,2),  -- e.g., 80.0
  standard_hours_per_week DECIMAL(5,2),   -- e.g., 20.0
  standard_days_per_week INT,              -- e.g., 5
  overtime_rate_percent INT                -- e.g., 150 for 1.5x
);
```

**Calculate from attendance + class sessions:**

```sql
CREATE VIEW teacher_overtime_monthly AS
SELECT 
  e.id,
  DATE_TRUNC('month', c.session_date) AS period,
  SUM(c.session_hours) AS actual_hours_taught,
  tc.standard_hours_per_month,
  GREATEST(0, SUM(c.session_hours) - tc.standard_hours_per_month) 
    AS overtime_hours,
  GREATEST(0, SUM(c.session_hours) - tc.standard_hours_per_month) 
    * (tc.overtime_rate_percent / 100.0)
    AS overtime_amount
FROM employees e
JOIN teacher_contracts tc ON e.id = tc.employee_id
JOIN class_sessions c ON e.id = c.instructor_id
WHERE c.session_date >= tc.contract_start
  AND c.session_date < tc.contract_end
  AND c.status = 'completed'  -- Only count attended/completed sessions
GROUP BY e.id, DATE_TRUNC('month', c.session_date), tc.standard_hours_per_month, tc.overtime_rate_percent;
```

**Tolerance buffer (Odoo pattern, apply to overtime rules):**
- Small tolerance (0.5 hours/week) to avoid marginal overtime
- Approval required if tolerance exceeded
- Configure per contract type

---

## Topic 5: Vietnam-Specific Payroll Compliance

### PIT (Personal Income Tax) Calculation 2026

**Salary Structure:**
```
Gross Salary = Base + Allowances + Bonuses

Taxable Income = Gross - Personal Deduction - Dependent Deduction - Compulsory Insurance

Personal Deduction: 15,500,000 VND
Dependent Deduction: 6,200,000 VND × # dependents
Compulsory Insurance: 10.5% of gross
  - Social Insurance: 8%
  - Health Insurance: 1.5%
  - Unemployment Insurance: 1%
```

**Progressive Tax Bands:**
```
Up to 10,000,000 VND: 5%
10,000,001 - 30,000,000: 10%
30,000,001 - 60,000,000: 20%
60,000,001 - 100,000,000: 30%
> 100,000,000: 35%
```

**Implementation (PostgreSQL function):**
```sql
CREATE FUNCTION calculate_pit(gross_salary DECIMAL) RETURNS DECIMAL AS $$
  DECLARE
    personal_deduction CONSTANT DECIMAL := 15500000;
    compulsory_insurance DECIMAL := gross_salary * 0.105;
    taxable_income DECIMAL := gross_salary - personal_deduction - compulsory_insurance;
    pit_amount DECIMAL := 0;
  BEGIN
    IF taxable_income <= 0 THEN RETURN 0; END IF;
    
    IF taxable_income <= 10000000 THEN
      pit_amount := taxable_income * 0.05;
    ELSIF taxable_income <= 30000000 THEN
      pit_amount := 10000000 * 0.05 + (taxable_income - 10000000) * 0.10;
    ELSIF taxable_income <= 60000000 THEN
      pit_amount := 10000000 * 0.05 + 20000000 * 0.10 + (taxable_income - 30000000) * 0.20;
    -- ... continue for remaining bands
    END IF;
    
    RETURN pit_amount;
  END;
$$ LANGUAGE plpgsql;
```

### BHXH (Social Insurance) Integration

**Contribution Split (per month, based on contractual salary):**
- **Employee pays:** 10.5% (capped)
- **Employer pays:** 21.5% (17.5% SI + 3% HI + 1% UI)

**Caps (2026):**
- Salary cap for SI/HI: 20× basic salary = **46,800,000 VND/month**
- Salary cap for UI: 20× regional minimum wage

**Critical:** Only include BHXH deduction if employee is enrolled (check enrollment status table).

```sql
CREATE TABLE bhxh_enrollment (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  enrollment_date DATE,
  status ENUM('active', 'suspended', 'terminated'),
  contribution_base_salary DECIMAL(12,2),  -- capped at 20x minimum
  terminated_date DATE
);
```

### Decree 73/2024 Teacher Bonus Rules (Effective July 1, 2024)

**Bonus Fund Calculation:**
- Total fund = 10% of salary fund (excluding allowances)
- Allocation: Can vary per half-year (Jan-Jun, Jul-Dec)
- **3-tier performance system:**
  - Completing tasks (normal): 11,000,000+ VND/person (half-year)
  - Completing well: 13,800,000+ VND/person
  - Excellent: 16,000,000+ VND/person

**Key Constraint:** Contract teachers ≠ tenured teachers
- Tenured: eligible for full bonus (budget allocated)
- Contract: schools must balance budget themselves (lower amounts)

**Implementation:**

```sql
CREATE TABLE teacher_bonuses_decree73 (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  performance_tier ENUM('normal', 'good', 'excellent'),
  period_start DATE,  -- 2026-01-01 or 2026-07-01
  period_end DATE,
  bonus_amount DECIMAL(12,2),
  approved_by UUID REFERENCES employees(id),
  approval_timestamp TIMESTAMP,
  budget_allocation_id UUID,  -- link to school budget decision
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Red Flags & Pitfalls (Implementation Warnings)

### 1. **Data Quality + Automation Mismatch**
**Pitfall:** Auto-calculate KPI from incomplete or inconsistent data (e.g., attendance marked "present" but teacher didn't teach, grades not finalized).

**Mitigation:**
- Pre-flight validation: flag missing data (student grades null, attendance < 80% of days in period)
- Weekly reconciliation dashboard: show data staleness per teacher
- Require explicit "data complete" signal before KPI lock

### 2. **Misaligned Metrics (Gallup finding: 22% of employees agree metrics are in their control)**
**Pitfall:** KPI components based on factors outside employee control (e.g., class enrollment caps, student behavior).

**Mitigation:**
- Define KPI with department heads + sample of staff
- Document explicitly which factors are "external" (document in the KPI definition)
- Weight external factors lower (e.g., engagement component = 25% not 50%)

### 3. **Over-Aggregation Hiding Problems**
**Pitfall:** Overall KPI score of 75 looks fine, but masks failure in one component (e.g., attendance = 50%, delivery = 95%).

**Mitigation:**
- Expose component scores in payroll dashboard
- Flag any component < 60 as "review required"
- Audit trail must store component breakdown (see JSONB schema)

### 4. **Commission Clawback Timing Issues**
**Pitfall:** Student refund arrives in next month, but commission already paid; clawback creates negative paycheck or requires manual adjustment.

**Mitigation:**
- Require approval receipts for commission (not just orders)
- Implement 7-day hold on commission payout (allow reversals)
- Auto-apply clawbacks to next payroll cycle (not retroactive pay cuts)

### 5. **KPI Override Audit Trail Gaps**
**Pitfall:** Override logged but no approval, or approval logged but reason missing (regulatory risk).

**Mitigation:**
- Block override submission if reason_text is empty
- Enforce role-based approvals (no self-approval)
- Lock approved KPI for 10 days (audit window) before release to payroll

### 6. **Overtime Calculation Boundary Issues**
**Pitfall:** Teacher at 79.8 hours / 80-hour monthly contract = no overtime, but context shows heavy workload (one-off extra class not recorded).

**Mitigation:**
- Tolerance buffer: allow 0.5 hours + time-off conversion (not just pay)
- Require manager approval if overtime > 10 hours/month
- Log all adjustments (extra classes added) with timestamp

---

## Implementation Patterns: Data Model Sketch

### Core Tables (TypeScript + tRPC context)

```typescript
// 1. KPI Calculation Table
interface KpiCalculation {
  id: string;
  employee_id: string;
  period_start: Date;
  period_end: Date;
  score: number; // 0-100
  components: {
    attendance: { value: number; weight: number; };
    delivery: { value: number; weight: number; };
    engagement: { value: number; weight: number; };
  };
  calculation_method: 'formula_v1' | 'formula_v2';
  data_sources: {
    attendance_from: Date;
    attendance_to: Date;
    // ... timestamp when each data source was read
  };
  status: 'calculated' | 'pending_approval' | 'approved' | 'rejected';
  created_at: Date;
}

// 2. Audit Log (tRPC mutation middleware logs here)
interface AuditLog {
  id: string;
  entity_type: 'kpi' | 'commission' | 'overtime';
  entity_id: string;
  change_type: 'CREATE' | 'UPDATE' | 'OVERRIDE';
  old_value: Record<string, any>; // full JSONB
  new_value: Record<string, any>;
  changed_by: string; // user ID
  approved_by?: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  reason: string;
  created_at: Date;
  approved_at?: Date;
}

// 3. Approval Workflow
interface ApprovalWorkflow {
  id: string;
  audit_log_id: string;
  approver_role: 'payroll_manager' | 'finance_controller' | 'director';
  status: 'pending' | 'approved' | 'rejected';
  decision_reason?: string;
  timestamp_decided?: Date;
}
```

### tRPC Mutation Pattern with Audit Logging

```typescript
// Server: middleware logs all mutations
const auditMiddleware = t.middleware(async ({ ctx, next, meta }) => {
  const result = await next();
  
  // Log after mutation completes successfully
  if (result && meta?.auditEntity) {
    await db.auditLog.create({
      entity_type: meta.auditEntity,
      entity_id: result.id,
      change_type: 'CREATE',
      new_value: result,
      changed_by: ctx.user.id,
      approval_status: 'pending',
      created_at: new Date(),
    });
  }
  return result;
});

export const router = t.router({
  updateKpi: t
    .procedure
    .use(auditMiddleware)
    .input(z.object({ kpi_id: z.string(), score: z.number() }))
    .meta({ auditEntity: 'kpi' })
    .mutation(async ({ input, ctx }) => {
      // ... update KPI
      return updated_kpi;
    }),
});
```

### PostgreSQL Audit View for Auditors

```sql
CREATE VIEW payroll_audit_trail AS
SELECT 
  al.created_at,
  e.name AS changed_by,
  al.entity_type,
  al.change_type,
  (al.new_value->>'score')::numeric AS new_score,
  (al.old_value->>'score')::numeric AS old_score,
  al.reason,
  aw.approver_role,
  aw.status AS approval_status,
  aw.timestamp_decided
FROM audit_log al
LEFT JOIN employees e ON al.changed_by = e.id
LEFT JOIN approval_workflow aw ON al.id = aw.audit_log_id
ORDER BY al.created_at DESC;
```

---

## Integration Checklist

### Before Implementation

- [ ] Define KPI components with department heads (weight each 0-100)
- [ ] Identify data sources for each component (where does attendance data live? grades?)
- [ ] Set approval thresholds (override > 20 points = director approval)
- [ ] Document Vietnam PIT calculator & test with 3 salary ranges
- [ ] Plan BHXH enrollment sync (from HR system? manual audit?)
- [ ] Design commission reversal triggers (which CRM statuses = clawback?)

### tRPC Integration

- [ ] Add audit logging middleware to all payroll mutations
- [ ] Implement maker-checker approval endpoints
- [ ] Add role-based guards (director_only, finance_only)
- [ ] Expose audit trail view to compliance officers

### PostgreSQL Schema

- [ ] Create `kpi_audit_log` + `approval_workflow` tables
- [ ] Create `JSONB` component breakdown storage
- [ ] Add `payroll_locks` table (period-based locking)
- [ ] Create reconciliation views for data freshness

### Verification

- [ ] Test PIT calculation against Vietnam sample payroll (3 cases)
- [ ] Test clawback reversal in next payroll cycle
- [ ] Verify audit trail captures all override approvals
- [ ] Load test: 100+ teachers KPI auto-calculation in < 5 seconds

---

## Unresolved Questions

1. **Student grades finalization:** When in your LMS are grades considered "final"? (e.g., 5 days after class? end of term?) This drives the "data complete" check.

2. **Commission approval receipt source:** Where are approved sales stored in your current system? CRM? separate receipt table? tRPC mutation endpoint?

3. **BHXH enrollment status:** Is BHXH enrollment managed in your HR system or separately? How is termination date tracked?

4. **Overtime preference:** Do teachers prefer overtime pay or time-off conversion? (Impacts overtime table design: is there a `use_time_off` flag?)

5. **Multi-period bonus:** For Decree 73/2024 bonuses, should the system allow early payout (before Jul 1 / Dec 31) for cash flow reasons? Requires approval override.

6. **Threshold tuning:** What KPI score change % triggers director review? (Currently proposed 20 points = 20-30 minutes if changed from 60→80. Is this right?)

---

## Sources

- [Workday vs BambooHR: Which HRIS Tool is Best for You?](https://www.getguru.com/reference/workday-vs-bamboohr)
- [BambooHR Time and Attendance](https://www.bamboohr.com/platform/time-and-attendance/)
- [Odoo KPI Management & Performance Scorecard](https://apps.odoo.com/apps/modules/18.0/kpi_management)
- [Odoo Overtime Rules Documentation](https://www.odoo.com/documentation/19.0/applications/hr/attendances/overtime.html)
- [Salesforce Commission Software & Integration](https://www.everstage.com/best-sales-commission-software-for-salesforce-users)
- [Payroll Approval Workflow & Audit Trail Standards](https://www.indpayroll.com/help/payroll-help/payroll-processing-management/payroll-approvals-audit-trails)
- [Maker-Checker Approval Workflow for Payroll (Keka Documentation)](https://help.keka.com/hc/en-us/articles/41388353533073-Approval-Workflow-Maker-Checker-for-Payroll-Finalisation)
- [Payroll Approval Workflow Guide](https://payrun.app/blog/payroll-approval-workflow)
- [Vietnam Payroll Guide 2026: PIT, BHXH & Compliance](https://trustlineax.com/vietnam-payroll-guide-2026/)
- [Vietnam HR & Payroll Guide 2026](https://vietnam.acclime.com/guides/hr-payroll/)
- [Decree 73/2024 Teacher Bonus Regulations (Vietnam)](https://www.vietnam.vn/en/nam-dau-tien-giao-vien-duoc-thuong-tet-muc-thuong-ra-sao)
- [Is Tet Bonus Obligatory in Vietnam? 2026 Guide](https://iscale-solutions.com/tet-bonus-in-vietnam/)
- [KPI Common Implementation Mistakes](https://mark-bridges.medium.com/what-are-the-common-mistakes-and-pitfalls-made-in-kpi-implementation-8edfd25bd35b)
- [Common KPI Mistakes that Hurt Organizations](https://www.spiderstrategies.com/blog/kpis-gone-wrong/)
- [Sales Commission Clawback: Best Practices 2026](https://www.everstage.com/sales-commission/sales-commission-clawback)
- [Commission Clawback: How It Works and Best Practices](https://www.qobra.co/blog/clawback-how-it-works-examples-best-practice)
- [PostgreSQL Audit Trigger Patterns](https://wiki.postgresql.org/wiki/Audit_trigger)
- [PostgreSQL Audit Log Schema Design](https://nestcode.co/en/blog/database-design-audit-log-tracking-changes-to-column-data-value-in-postgresql-part-1)
- [Row Change Auditing Options for PostgreSQL](https://www.cybertec-postgresql.com/en/row-change-auditing-options-for-postgresql/)
- [tRPC Middleware for Auth & Logging](https://stevekinney.com/courses/full-stack-typescript/middleware-auth-logging-for-trpc)
- [Education KPI Examples for Teachers and Schools](https://www.spiderstrategies.com/kpi/industry/educational-services/)
- [Benchmarking Success with KPIs in School Management Systems](https://www.classter.com/blog/edtech/benchmarking-success-with-kpis-in-school-management-systems/)
- [Space Utilization Rate (Seat Fill) in Education](https://learningportal.iiep.unesco.org/en/glossary/space-utilization-rate)
- [Sales Commission Management: Automation and Data Integration](https://pretius.com/blog/sales-commission-management)
- [CaptivateIQ Commission Automation Software](https://www.captivateiq.com/)
- [LMS Metrics & KPIs to Track System Performance](https://www.thinkific.com/blog/lms-metrics-kpis/)
