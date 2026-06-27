# Feature Comparison: Financial and Receipt Management
## Source: https://github.com/odoo/odoo (addons/account) & https://github.com/openeducat/openeducat_erp (openeducat_fees)
## Local Project: cmc_source (packages/domain-finance)

## Head-to-Head

| Aspect | Odoo & OpenEduCat | Local Project (CMC) | Recommendation |
| :--- | :--- | :--- | :--- |
| **Architecture Philosophy** | Unified double-entry ledger database. Invoices (`account.move`) generate journal item pairs (debit/credit) that reconcile against payments (`account.payment`) via `account.partial.reconcile` tables. | High-speed, cash-basis single receipt ledger (`Receipt`). Tracks pricing, discounts, collection state, and sales-commission freezing in a single stateful table. | Keep CMC's simplified cash-basis model; fits the facility-centric cash flow without the overhead of double-entry ledger setups. |
| **Fee Structure** | `op.fees.term` and `op.fees.element` map structured line items (Tuition, Hostel, Library) to student profiles with recurring schedules. | Effective-dated annual pricing (`CoursePrice`) combined with simple prepaid years (1-3) to determine raw tuition cost. | Keep CMC's effective-dated pricing model. It guarantees price validity based on creation date and simplifies gross calculation. |
| **Discount Logic** | Line-item level percentages or loyalty program configurations. Cascading or stacked rules require complex promotion engine calculations. | Stacked prepaid year-tier discount (15/20/30% configurable) and promo voucher percent, with a strict 35% cap. | Preserve CMC's deterministic pure math stacking/capping utility. It is easily auditable. |
| **Double-Spend Mitigation** | Odoo relies on ORM locks and PostgreSQL MVCC transaction isolation. High-concurrency loyalty redemption can cause serialization errors. | Raw SQL atomic update checks (`UPDATE voucher SET used_count = used_count + 1 WHERE ...`) and transaction-scoped advisory locks. | Retain CMC's PostgreSQL advisory locks. They ensure strict sequential numbering and zero-race-condition voucher depletion. |
| **CRM Integration** | Commission rules are computed dynamically off sales invoices or integrated CRM pipeline transitions. | Frozen sales commission attribution (`soldById` and `kind` new/renewal) resolved during receipt approval. | Keep CMC's frozen attribution pattern at approval. It avoids complex retroactive recalculations. |

---

## Detailed Data Models Analysis

### Source Models (Odoo & OpenEduCat)
*   **`account.move`**: Universal model for journal entries, vendor bills, and customer invoices. Contains `move_type` (e.g. `out_invoice` for customer billing).
*   **`account.move.line`**: Fenced ledger debit/credit lines. Individual product sales and discounts are recorded as unique lines.
*   **`account.payment`**: Handles payment registrations and maps to ledger lines.
*   **`account.partial.reconcile` / `account.full.reconcile`**: Reconciles the invoice debits against the payment credits.
*   **`op.fees.term` / `op.fees.element`**: Educational abstractions mapping fee configurations (hostel fee, tuition) to products. Applies discounts at invoice generation time.

### Local Project Models (CMC)
*   **`Receipt`**: Central model tracking cash-basis state (`draft`, `approved`, `sent`, `reconciled`, `cancelled`), gross tuition, specific year-tier and voucher discounts, net calculation, and sales attribution.
*   **`CoursePrice`**: Tracks effective-dated annual course pricing with unique constraint `[facilityId, courseId, effectiveFrom]` to avoid price collision.
*   **`DiscountTier`**: Defines prepaid duration discounts (default: 1y = 15%, 2y = 20%, 3y = 30%) scoped by facility.
*   **`Voucher`**: Tracks facility-scoped promotion codes with usage tracking (`usedCount` and `maxUses`) and validity dates.
*   **`ReceiptCodeCounter`**: Composite primary key `[facilityId, year]` used to generate atomic sequential receipt codes.

---

## Business Rules Analysis

### 1. Pricing and Discounts
*   **CMC Stacked Formula**:
    *   `Gross Amount = Annual Price * Years Prepaid` (1 to 3 years)
    *   `Effective Discount % = min(Tier Percent + Voucher Percent, 35)`
    *   `Net Amount = Math.round(Gross Amount * (100 - Effective Discount) / 100)`
*   **ERP Comparison**: While standard ERP systems support complex and cascading discounts, they require generating line-item entries with negative amounts or adjusting subtotal fields. CMC handles this directly inside a single deterministic module (`pricing.ts`), ensuring 100% agreement between the server-side API and the admin front-end interface.

### 2. CRM and Sales Attribution
*   **Commission Freeze**: CMC attributes commission at the moment a receipt is approved (`receiptApprove`).
    *   If the linked CRM Opportunity stage is `O5_ENROLLED`, the receipt classification is categorized as `new` (allowing winbacks).
    *   Otherwise, if the student has prior collected receipts (`approved`, `sent`, `reconciled`), it resolves to `renewal`.
    *   The credited advisor is locked to the Opportunity owner (`soldById`), separate from the cashier user (`collectedById`).
*   **ERP Comparison**: Standard systems evaluate commissions dynamically via backend reports, which are susceptible to modifications if the student's status changes retroactively. CMC's "freeze at approval" pattern prevents historic drift.

---

## Concurrency & Atomicity Analysis

### 1. Sequential Numbering (`PT-YYYY-NNNN`)
*   To prevent duplicates or missing sequences under high concurrency, CMC employs a postgres-level advisory lock:
    ```sql
    SELECT pg_advisory_xact_lock(facilityId, year)
    ```
    This forces database transactions to wait in line, executing sequence increments on `ReceiptCodeCounter` atomically. Standard ERPs often rely on slower sequence sequence tables or application-level locks that risk locks table bloat.

### 2. Voucher Consumption (Avoiding Double-Spends)
*   At approval, CMC increments the voucher usage using a single atomic SQL command:
    ```sql
    UPDATE "voucher"
       SET "used_count" = "used_count" + 1
     WHERE "id" = receipt.voucherId
       AND "active" = true
       AND "used_count" < "max_uses"
       AND (valid_from <= current_date) AND (valid_to >= current_date)
    ```
    If this update modifies `0` rows, the system rolls back and throws a `CONFLICT` error (reversing potential race-condition double-spends).
*   During cancelations, the voucher is atomically refunded:
    ```sql
    UPDATE "voucher" SET "used_count" = "used_count" - 1 WHERE id = voucherId AND used_count > 0
    ```

---

## Recommendations

1.  **Maintain the Single-Table Receipt Ledger**: Avoid migrating to a full Odoo double-entry model (`account.move`). The current lightweight `Receipt` model simplifies cashiering operations and requires significantly less maintenance overhead.
2.  **Explicit Date Indexing**: Ensure `CoursePrice` queries use database index scanning. The composite index `[courseId, effectiveFrom]` is already present and matches the `resolvePrice` search behavior perfectly.
3.  **Strict Audit Logging**: Because cancellations increment voucher capacity back, keep the current transaction log structure (`logEvent` system) to detect cases where users cancel receipts simply to exploit coupon codes.

---

## Unresolved Questions

1.  *Is there a requirement to link receipts back to a double-entry ledger system in the future for corporate accounting?* (If so, mapping `Receipt` to a general ledger module via a periodic cron job is cleaner than refactoring to active journal entries).
2.  *Are voucher percentages facility-customizable, or can they also be centrally managed?* (Current schema restricts `Voucher` to unique `[facilityId, code]` combinations).
