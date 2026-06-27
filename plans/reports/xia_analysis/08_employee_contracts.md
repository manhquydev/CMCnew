# Feature Comparison: Employee and Contract Management (Odoo vs CMC)
## Source: https://github.com/odoo/odoo (addons/hr, addons/hr_contract)
## Local Project: CMC (packages/domain-payroll, C:/Users/manhquy/cmc_source)

---

### Executive Summary
This report analyzes and compares Odoo's employee and contract directory architecture with CMC's localized, education-specific payroll implementation (`packages/domain-payroll`). Odoo relies on a highly dynamic, decoupled, Python-driven rule engine where contracts and calendars drive payroll inputs. In contrast, CMC utilizes a strongly typed, hardcoded TypeScript architecture centered around direct Prisma queries (`EmploymentProfile`, `SalaryRate`, `CompensationPolicy`, `KpiScore`) that automatically aggregate operational metrics (approved sales receipts, teacher grades, class session attendance) and map them to compensation policies.

---

### Head-to-Head Comparison

| Aspect | Odoo (Source) | CMC (Local) | Recommendation |
| :--- | :--- | :--- | :--- |
| **Employee Profiles** | `hr.employee` (base abstract is `hr.employee.base`). Manages personal & organizational links. | `EmploymentProfile` extends `AppUser` via `userId`. Maps to center/facility and tracks positions/grades. | Maintain current extension model; it keeps the user table lean and matches local tenancy. |
| **Contract / Salary Rates** | `hr.contract`. Stores base wage, wage type (hourly/fixed), structure type, and work calendar. | `SalaryRate` is effective-dated per employee. Tracks `baseSalary`, `mealAllowance`, `otherAllowance`, `kpiMax`, and `monthlyQuota`. | CMC's effective-dated rates are simpler but effective. Ensure indexing on `effectiveFrom` to prevent calculation lag. |
| **Work Schedule / Calendars** | `resource.calendar`. Drives the generation of `hr.work.entry` lines for worked days and leaves. | Prorated by manual inputs of standard/actual workdays on payslip creation. | Keep manual/calculated proration simple. Avoid full Odoo calendar complexity unless scheduling is integrated. |
| **Allowances** | Dynamic Python formulas referencing `contract.allowance_name` or manually entered inputs. | Hardcoded prorated allowances (`mealAllowance + otherAllowance`) in TypeScript pure logic. | The current pure TypeScript calculation is safe and performs well. Keep allowances static unless dynamic ones are requested. |
| **Sales Quota & Commission** | Custom modules map sales opportunities/invoices to inputs (`hr.payslip.input`) before payslip calculation. | Hardcoded TypeScript integration: queries `tx.receipt` for approved new/renewal revenues, computes attainment against `monthlyQuota`, and maps to tiered rates in `CompensationPolicy`. | Keep TypeScript implementation. Integrate a database flag for finalized receipts to prevent retroactive commission recalculations. |
| **Teaching Activities & Overtime** | Timesheets / attendance lines map to worked days or payslip inputs. | Automatically aggregates data: `chuyen_mon` (average published grades) and `tuan_thu` (class session attendance marked) to compute KPI scores; maps grade (`B1`..`B4`) to overtime hourly rates. | High level of business-specific automation. Introduce audit logs for class session changes during payroll period lock. |
| **Calculation Engine** | Dynamic database-driven rule engine evaluating Python scripts in sandboxed environment. | Immutable pure functions in `@cmc/domain-payroll` compiled to JavaScript, run on server. | Pure TypeScript functions are vastly superior for maintenance, performance, and security. Avoid Odoo's Python script evaluations. |

---

### Data Model Mapping

#### Odoo Data Model Structure
1. **`hr.employee`**:
   - `resource_calendar_id`: Working hours calendar.
   - `contract_id`: Currently active contract.
2. **`hr.contract`**:
   - `wage`: Base salary.
   - `wage_type`: Fixed salary vs Hourly.
   - `structure_type_id`: Links to `hr.payroll.structure.type`.
   - `resource_calendar_id`: Overrides or inherits employee schedule.
3. **`hr.payslip`**:
   - `worked_days_line_ids`: Breakdown of worked hours and leaves.
   - `input_line_ids` (`hr.payslip.input`): Variable payroll inputs (e.g. Commissions).
4. **`hr.salary.rule`**:
   - Stores Python code to calculate individual line amounts based on `contract`, `employee`, `worked_days`, and `inputs`.

#### CMC Data Model Structure (Prisma Schema)
1. **`EmploymentProfile`**:
   - Maps `userId` (unique) to facility (`facilityId`), positions (`teacher`, `sales`, etc.), and grade classification (`B1`..`B4`, `PT3`).
2. **`SalaryRate`**:
   - Unique on `[userId, effectiveFrom]`. Stores base compensation components:
     - `baseSalary`, `mealAllowance`, `otherAllowance`, `kpiMax`, and `monthlyQuota` (CRM sales target).
3. **`KpiScore`**:
   - Unique on `[userId, periodKey]`. Evaluated as `overrideScore ?? autoScore`. Tracks workflow stages: `draft` -> `submitted` -> `confirmed` -> `approved`.
4. **`CompensationPolicy`**:
   - Global effective-dated policy parameter configuration stored as JSON and validated via Zod schema (`pit` brackets, `kpi` bands, `commission` rates/tiers, `overtimeRates` by grade, and weights).
5. **`CallMetric`**:
   - Period-based VoIP metrics mapped from Callio extension (`callioExt`) to automate KPI compliance.
6. **`Payslip`**:
   - Financial ledger snapshot of computed earnings (`baseEarned`, `allowanceEarned`, `kpiBonus`, `variablePay`, deductions, PIT, and Net).

---

### Business Rules & Variable Resolution

#### 1. Quota Attainment & Commission Mapping
*   **Odoo**: Sales values are calculated in external CRM models and written into payslip inputs (`hr.payslip.input`) before calculations. The salary rule engine reads `inputs.SALES_ATT.amount` or similar.
*   **CMC**:
    - Queries approved, sent, or reconciled receipts (`tx.receipt`) credited to the user (`soldById`) within the period range.
    - Quota attainment ratio: $\text{attainment} = \frac{\text{newRevenue}}{\text{monthlyQuota}}$ (obtained from the employee's active `SalaryRate`).
    - The new revenue commission rate is selected from the 6-band list `cvtvNewRates` in the active `CompensationPolicy` corresponding to the attainment ratio:
      - Quota attainment: $<50\%$ (rate index 0), $50\%\text{-}80\%$ (index 1), $80\%\text{-}100\%$ (index 2), $100\%\text{-}120\%$ (index 3), $120\%\text{-}150\%$ (index 4), $>150\%$ (index 5).
    - Renewal commission rate is resolved based on the center retention ratio against `cvtvRenewalTiers`. Currently defaulted to `0.9` (90%) for conservative accrual.
    - Resulting values are aggregated and written to `variablePay`.

#### 2. Teaching Activities & Overtime Calculation
*   **Odoo**: Instructors track hours on timesheets linked to project tasks. Total hours are pulled into the worked days table, and hourly rules calculate $\text{hours} \times \text{hourly\_rate}$ from the contract.
*   **CMC**:
    - **KPI Integration**: `kpiAutoPrefill` aggregates teacher performance:
      - `chuyen_mon` (professional score): Queries published grades (`tx.grade`) graded by the teacher during the period, calculating $\text{avg}(\frac{\text{score}}{\text{maxScore}}) \times 100$.
      - `tuan_thu` (compliance score): Queries class sessions (`tx.classSession`) taught by the user. Computes percentage of sessions with marked attendance over total confirmed sessions: $\frac{\text{sessionsWithAttendance}}{\text{totalConfirmedSessions}} \times 100$.
    - **Overtime Pay**: Looks up the teacher's `grade` (e.g. `B2`) on the active `EmploymentProfile` and retrieves the hourly rate from `overtimeRates` (e.g., `120_000` VND/hour) in the active `CompensationPolicy`, computing $\text{overtimeHours} \times \text{unitPrice}$.
    - **Part-time packages**: Retrieves flat gross amounts from `parttimePackages` based on the package code in `grade` (e.g. `PT3`).

---

### Challenge Framework (Stress-Testing the Porting Decisions)

1.  **Necessity (Odoo's Generic Engines vs CMC Custom Logic)**:
    - *Question*: Do we need Odoo's generic database-driven salary rule engine?
    - *Answer*: No. Standard Odoo payroll rules are written in Python code saved inside database records. This introduces massive complexity, security risks (evaluating dynamic code), and is difficult to debug or unit-test. CMC's compile-time safe TypeScript functions (`assemblePayslip`, `weightedKpi`) are significantly faster, secure, and easier to verify with unit tests.
2.  **Working Schedules & Calendars**:
    - *Question*: Should we port Odoo's `resource.calendar` work-entry generation?
    - *Answer*: Odoo's calendar engine is highly complex, accounting for shift patterns, public holidays, and timezones. For CMC, simple monthly inputs of actual/standard workdays are sufficient for proration. Porting a calendar schedule generator would introduce high maintenance overhead without significant business value.
3.  **Data Mutability & Audit Trail**:
    - *Question*: How do we prevent retroactive changes in payroll calculations when commission or KPI criteria change?
    - *Answer*: CMC uses an effective-dated approach for `CompensationPolicy` and `SalaryRate` which mimics Odoo's contract logic. When a payslip is finalized, its fields are frozen in the database (`status: finalized` / `paid`). This acts as a lock, ensuring past payroll calculations are immutable even if policy variables are updated.
4.  **Security and Authorization**:
    - *Question*: How does CMC handle row-level security (RLS) compared to Odoo's record rules?
    - *Answer*: Odoo uses a database-level record rule engine evaluated dynamically. CMC implements explicit row-level isolation via facility RLS helper wrapper functions (`withRls(rlsContextOf(ctx.session), ...)`). This limits the blast radius of unauthorized data exposure.
5.  **Attribution and Verification**:
    - *Question*: How do we handle discrepancies between automated feeds (Callio, CRM Receipts) and final payslips?
    - *Answer*: Odoo allows manual overrides on payslip lines. CMC supports `overrideScore` on `KpiScore` (requiring audit trail reason logging) and `variablePayOverride` on the payslip compute router. This matches Odoo's flexibility while preserving auditing.

---

### Decision Matrix

| # | Decision | Odoo's Way | CMC's Way | Hybrid | Risk | Choice |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Calculation Logic** | Python scripts stored in database rows | Pure TypeScript functions in code | N/A | Low | **CMC's Way** (TypeScript logic provides compile-time safety and easy testing). |
| 2 | **Proration & Schedules** | Dynamic calendar work entries | Manual workday inputs via API | N/A | Medium | **CMC's Way** (Keep it simple unless automated biometric clocks are required). |
| 3 | **Variable Earnings** | Dynamic `hr.payslip.input` lines | SQL aggregates populated to `variablePay` | Allow custom inputs | Low | **Hybrid** (Retrieve auto-compositions but allow manager override with logs). |
| 4 | **Effective-Dating** | Contract start/end dates | Effective-dated `SalaryRate` + `CompensationPolicy` | N/A | Low | **CMC's Way** (Matches Odoo's logic without multi-table joins). |

**Risk Score**: **Low (1/5)**. CMC's codebase contains clean, testable, and isolated modules. There is no need to port Odoo's database-level dynamic calculation patterns.

---

### Strategic Recommendations

1.  **Freeze Source Records at Payroll Finalization**:
    Ensure that once a payslip is marked `finalized` or `paid`, all associated source data (e.g. `KpiScore`, `Receipt` records used to compute commission, and class attendances) are flagged as "frozen" or cannot be modified retroactively. This prevents compliance errors.
2.  **Add Indexes to effectiveFrom**:
    In `schema.prisma`, add an index on `[userId, effectiveFrom]` inside `SalaryRate` (currently there is a unique constraint, but ensure database queries are fast).
3.  **Formalize Teaching Overtime Aggregation**:
    Currently, teaching overtime is entered manually as a variable pay input or calculated in client code. It is recommended to implement an auto-fill script for overtime hours similar to the CRM commission pre-fill, aggregating sessions taught (`tx.classSession`) beyond standard hours.
4.  **Audit Logs for Policy JSON**:
    Because `CompensationPolicy.params` is a JSON field, any change by `super_admin` affects all future payroll computations. Formally log the full diff of the JSON parameter values during policy updates to provide a comprehensive audit trail.

---

### Unresolved Questions
1.  Are there plans to introduce complex working hour calendars (e.g., split shifts, part-time hourly schedules) that might require migrating to a work-entry calendar system similar to Odoo's `resource.calendar`?
2.  Should manager (TPKD/GĐTT) new-customer commissions and team rollups be fully automated via CRM receipt aggregates in v2, or will they remain manual overrides?
