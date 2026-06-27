# Feature Comparison: Payroll & Commission Module
## Source: odoo/odoo (addons/hr_payroll)
## Local Project: CMCnew (packages/domain-payroll)

## Head-to-Head
| Aspect | Source (Odoo hr_payroll) | Local (CMCnew domain-payroll) | Recommendation |
| --- | --- | --- | --- |
| **Architectural Paradigm** | Dynamic rule-based engine executing custom Python strings via `safe_eval`. | Statically typed pure functions in TypeScript driven by database-stored JSON parameters. | Maintain TS pure-function approach; avoids runtime script execution risks and high support overhead. |
| **Formula Configuration** | Custom code written in UI rules (`amount_python_compute`) executed in order of sequence. | Standard math formulas hardcoded in TS codebase; coefficients, rates, and bands loaded from versioned schema. | Continue compiling formulas; keeps core logic testable, type-safe, and prevents security sandbox escapes. |
| **PIT Computation** | Custom Python script looping through tax brackets or hardcoded `if-elif` statements. | Statically typed loop in `pit.ts` evaluating array of tax brackets configured in the active policy. | Retain current `computePit` function; it is clean, correct, and completely parameterized. |
| **Insurance Deductions** | Dynamically computed via `DED` rules (e.g., base * 10.5%). | Manual input field on payslip (`insuranceDeduction`), defaulting to 0. | Add standard BHXH formulas and cap parameters (e.g., 20x basic wage cap) to `CompensationPolicy` schema. |
| **Sales Commissions** | Configured via Subscription/CRM modules; calculates on invoiced revenue and MRR movements. | Custom calculation in `commission.ts` mapping real collected cash receipts to quota attainment ratios. | Retain cash-collected commission base; matches tuition fee cashflow reality better than Odoo's invoice-base. |
| **KPI Integration** | Manual inputs or custom rules mapped from external worksheets. | Structured weighted criteria configurations inside the policy, mapping 0-100 score to A/B/C/D payout ratios. | Keep current weighted composite scoring; ensures math is transparent and editable by HR. |
| **Lifecycle & Security** | Locked at payslip validation; RLS/access controlled by standard Odoo access rights. | State gating (`draft -> finalized -> paid`). `finalized` freezes numbers. strict RLS prevents non-HR view. | Keep current state transitions and RLS; guarantees auditability and payroll confidentiality. |
| **Testability** | Hard to test without loading DB state and mock context. | 100% testable locally via standard Unit Tests (`vitest`) without DB or API dependencies. | Retain pure functions pattern; enables fast local verification during development and CI checks. |

---

## Data Models Comparison

### Odoo Data Models (`addons/hr_payroll`)
*   **`hr.contract`**: Stores base employee wage, structural type, schedule, and effective date. Required to compute any payslip.
*   **`hr.payroll.structure`**: Aggregates a collection of salary rules (`hr.salary.rule`) for a specific worker class.
*   **`hr.salary.rule`**: Stores the category (Basic, Allowance, Deduction), computation type (Python, Percentage, Fix), execution sequence, and Python code string.
*   **`hr.payslip`**: The record of calculation. Loads worked days, inputs, computes the rules, and stores computed line results in `hr.payslip.line`.

### CMCnew Data Models (`packages/domain-payroll` & `packages/db`)
*   **`EmploymentProfile`**: Ties employee to their role and facility.
*   **`SalaryRate`**: Stored rate card per employee with effective dating (`effectiveFrom`), containing `baseSalary`, `mealAllowance`, `otherAllowance`, `kpiMax`, and `monthlyQuota`.
*   **`CompensationPolicy`**: Versioned, effective-dated database record holding global JSON parameters:
    *   `pit`: `brackets` array (`upTo`, `rate`), `selfRelief`, and `dependentRelief`.
    *   `kpi`: KPI bands for `training` and `sales` blocks (minScore, grade, ratio).
    *   `commission`: `cvtvNewRates` (6-band quota ratios), `cvtvRenewalTiers` (retention tiers), budget cap %, and default retention ratio.
    *   `kpiCriteria`: Criteria keys, labels, and weights (must sum to 1.0).
*   **`Payslip`**: Calculated record containing proration details, KPI scores, computed PIT, gross, and net income. Gated by status transitions.

---

## Business Rules Comparison

### 1. Progressive Personal Income Tax (PIT)
*   **Odoo's Approach**: Relies on a Python expression evaluating `categories.GROSS`. Requires a database rule configuration or custom module code to handle tax brackets. Modifying thresholds requires updating the code block or managing Odoo's `hr.rule.parameter` records.
*   **CMCnew's Approach**: Tax brackets and reliefs are represented as structural parameters inside the effective policy JSON. The computation logic in `pit.ts` processes taxable income over a progressive loop, applying the configured marginal rates correctly without hardcoding limits:
    ```typescript
    const portion = Math.min(taxable, upper) - lower;
    tax += portion * b.rate;
    ```
    This matches the Vietnam statutory 7-bracket system.

### 2. Social Insurance (BHXH/BHYT/BHTN) Deductions
*   **Odoo's Approach**: Evaluated as a deduction category rule (`result = -contract.wage * 0.105`).
*   **CMCnew's Approach**: In the current v1 release, `insuranceDeduction` is a manual input on the payslip. The system accepts any number and subtracts it from gross income prior to calculating PIT.

### 3. Sales & Retention Commissions
*   **Odoo's Approach**: Calculated against invoice totals and contract lines. Typically requires complex subscription sync modules to isolate renewals.
*   **CMCnew's Approach**:
    *   **Cash-Collected Base**: Directly targets the paid and approved receipt transactions (`Receipt.soldById` and `Receipt.kind`), keeping payroll aligned with actual center cashflow rather than nominal invoicing.
    *   **Quota Attainment Ranges**: Commissions for new contracts are based on quota attainment % (`attainment = collected / quota`). Ratios map to 6 fixed brackets (<50%, 50-80%, 80-100%, 100-120%, 120-150%, >150%) with configurable rates.
    *   **Retention Tiers**: Renewal commission rates dynamically adjust based on center retention ratios:
        *   `<50%` retention = `0%` commission rate
        *   `50-70%` retention = `1.5%` commission rate
        *   `70-90%` retention = `2%` commission rate
        *   `≥90%` retention = `2.2%` commission rate
    *   **Safety Constraints**: Enforces a strict commission budget cap (`budgetPct <= 6%` of real revenue) to prevent margin erosion.
    *   **Win-Back Rules**: Returning students who go through a new admission funnel (new opportunity + test appointment) are treated as new revenue rather than renewals.

### 4. KPI Payout & Day Proration
*   **Odoo's Approach**: Compares work logs and standard contract days.
*   **CMCnew's Approach**:
    *   Prorates monthly base salary and allowances based on `workdays` vs `standardDays`.
    *   Calculates a single KPI score from weighted criteria (e.g. Sales KPI weight: Doanh số 70%, Tuân thủ 20%, Khác 10%).
    *   Maps the score to payout ratio (Training block vs Sales block bands) and scales the `kpiMax` amount to produce `kpiBonus`.

---

## Recommendations

1.  **Avoid Dynamic Evaluation Engines**: Odoo’s Python execution model is notorious for breaking during version upgrades and presenting security risks. CMCnew's compiled TypeScript model with JSON parameter schemas is faster, safer, and easier to verify with unit testing.
2.  **Automate Insurance Calculations**: Transition `insuranceDeduction` from a manual entry input to a parameter-driven computation. Store standard Vietnam insurance rates (10.5% employee, 21.5% employer) and the statutory maximum salary cap (20x basic wage) inside the `CompensationPolicy` schema.
3.  **Direct CRM/Receipt Integration**: Establish automatic calculations that query approved `Receipt` records matching the payslip’s period and employee. The snapshotted `soldById` and `kind` values on approved receipts provide an immutable source of truth, removing manual input steps for HR.
4.  **Implement Manager rollup commission structures**: Support team-quota tracking and roll-ups for `tpkd` and `gdtt` roles in subsequent phases by traversing the Center reporting relationships configured in the database, matching the placeholders already prepared in `commission.ts`.

---

## Unresolved Questions
1.  Should BHXH (Social Insurance) auto-calculation logic follow a statutory rate config or be kept as manual entry for the remainder of Phase 4?
2.  When implementing the deferred manager rollup commissions for TPKD and GDTT, will the hierarchy be fetched from CRM or from HR Center Org charts?
3.  How will the system reconcile and adjust payslips if a payment is clawed back or refunded after the payroll period is finalized?
