# Feature Comparison: CRM & Admission Pipeline
## Source: https://github.com/odoo/odoo (addons/crm) & https://github.com/openeducat/openeducat_erp (op_admission)
## Local Project: CMC ERP (cmc_source)

## Head-to-Head
| Aspect | Source (Odoo / OpenEduCat) | Local Project (CMC) | Recommendation |
| --- | --- | --- | --- |
| **Lead Ingestion** | **Odoo**: Ingests via email gateways, web forms, or REST APIs into `crm.lead` (`type='lead'`). No default deduplication.<br>**OpenEduCat**: Web forms write directly to `op.admission` applications. | Public tRPC `leadIngest` endpoint token-gated by `CRM_LEAD_TOKEN`. Normalizes phone to `+84` and find-or-creates `Contact` by `(facilityId, phone)` before creating `Opportunity`. | **Retain CMC's approach.** The built-in normalization and find-or-create contact deduplication is superior to Odoo's default duplicate-prone behavior. |
| **Pipeline Stages** | **Odoo**: Database-backed `crm.stage` records. Configurable per sales team. Attributes: `is_won`, `sequence`, `fold`.<br>**OpenEduCat**: Hardcoded state machine (`draft` -> `submit` -> `confirm` -> `admission` -> `done`). | Hardcoded `OpportunityStage` enum (`O1_LEAD` -> `O2_CONTACTED` -> `O3_TEST_SCHEDULED` -> `O4_TESTED` -> `O5_ENROLLED`). | **Keep current enum.** Hardcoded O1->O5 enum matches CMC business flow. Migrate to database-backed stages only if multi-pipeline customization is required later. |
| **Stage Transitions & Automation** | **Odoo**: Automated actions triggered on stage updates.<br>**OpenEduCat**: Explicit python transition methods. `enroll_student()` handles student creation and enrollment.<br> | Uses `advanceTo` helper to restrict auto-regression. Auto-hooks: entrance `TestAppointment` scheduled -> `O3_TEST_SCHEDULED`; graded -> `O4_TESTED`. | **Retain current hooks.** The automation linking test appointments to pipeline progression is highly effective. Ensure all transitions write audit logs. |
| **Audit Logs & Chatter** | **Odoo**: Uses `mail.thread` mixin and `tracking=True` fields. Changes are logged to `mail.message` records (displayed as chatter timeline). | Uses `RecordEvent` table. tRPC endpoints call `logEvent` to record state updates, logging `changes` as JSON (`[{ field, old, new }]`) and a text `body`. | **Expose timeline in UI.** Expose the `RecordEvent` logs as a history chatter sidebar in the CRM Opportunity and Student Detail UI views to align with Odoo's UX. |
| **Student Provisioning** | **Odoo**: Lead converted to customer via `_handle_partner_assignment()` (creates `res.partner`).<br>**OpenEduCat**: Gated atomic transaction `enroll_student()` creates `op.student`, course enrollment, and fee milestones. | Historically detached (`student.create` in UI vs. opportunity pipeline). New spec: Student provisioning triggered atomically inside `receipt.approve` (payment approval). | **Enforce gated provisioning.** Block direct student creation from UI. Implement atomic provisioning during `receipt.approve` (create Student, Enrollment, and link Guardian). |
| **Relationship Hierarchy** | **Odoo**: Unified `res.partner` table using `parent_id` (company/parent contact links).<br>**OpenEduCat**: Separate `op.parent` model linked M2M to `op.student` post-enrollment. | Separate `Guardian` and `ParentAccount` tables linked to `Student` and `Opportunity`. | **Capture at Intake.** Capture guardian contact details (name, phone, email, relationship) during lead ingestion. Auto-create and link `Guardian` records at enrollment. |

---

## 1. Detailed Data Models

### 1.1 Odoo & OpenEduCat Schema Mapping
*   **`crm.lead`**: Unified table for leads and opportunities. Uses `type` selection ('lead', 'opportunity') to filter visibility. Inherits from `mail.thread` for audit chatter.
*   **`crm.stage`**: Defines stages dynamically using database rows. Contains sorting (`sequence`) and logical flags (`is_won`).
*   **`op.admission`**: Stores admission applications. Linked to `op.admission.register` (defining course, seat capacity, fees).
*   **`op.student`**: Represents the final student. Inherits (`_inherits`) from `res.partner` using `partner_id` as the primary link.
*   **`op.student.course`**: The enrollment entity. A first-class model holding `course_id`, `batch_id`, `roll_number`, and `academic_year_id`.

### 1.2 Local CMC Schema Mapping
*   **`Contact`**: Holds normalized contact details (`phone` standardized to `+84` prefix) with a unique constraint on `[facilityId, phone]`.
*   **`Opportunity`**: Linked to `Contact` (`onDelete: Restrict` to preserve payroll/commission attribution). Tracks pipeline stage (`O1` to `O5`). Has `ownerId` representing the Sales Consultant (CVTV) credited with the lead.
*   **`TestAppointment`**: Handles testing. Linked to `Opportunity` for entrance tests (`type='entrance'`) or independent periodic evaluations (`type='periodic'`).
*   **`RecordEvent`**: Dedicated audit table tracking target model records (`entityType`, `entityId`) with structured JSON change logs and actor reference.

---

## 2. Business Rules & Life-Cycle Gates

### 2.1 State Progression Mechanics
*   **Odoo CRM**: Progression is flexible. Moving a lead to won requires setting `probability = 100` and changing `stage_id` to a stage where `is_won == True`. Lost opportunities are set to `active = False` with `probability = 0` and linked to `crm.lost.reason`.
*   **OpenEduCat**: The admission state machine follows strict forward transitions: `draft → submit → confirm → admission → done`. Rejections go to `reject` or `cancel` states.
*   **CMC Pipeline**: Auto-hooks automatically advance the stage forward but never regress.
    ```typescript
    function advanceTo(current: OpportunityStage, target: OpportunityStage): OpportunityStage {
      return STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(current) ? target : current;
    }
    ```
    *   **Gate O1 → O2**: Manual contact verification.
    *   **Gate O2 → O3**: Auto-advanced when an entrance `TestAppointment` is scheduled (`TestType.entrance` and `TestStatus.scheduled`).
    *   **Gate O3 → O4**: Auto-advanced when the entrance `TestAppointment` is graded (`TestStatus.done`, score, and result logged).
    *   **Gate O4 → O5**: Triggered on enrollment. In CMC, the actual student creation is deferred to `receipt.approve` (financial gate) rather than O5.

### 2.2 Audit & Reopen Controls
*   **Odoo**: Re-opening an archived/lost lead is done by restoring the record (`active = True`) and resetting probability. All updates are logged in the mail thread automatically.
*   **CMC**: Direct re-opening of lost opportunities is handled via `opportunityReopen`, resetting `closedAt` and `lostReason` to null. Manual transitions log structured JSON objects to `RecordEvent` with transition notes.

---

## 3. Strategic Recommendations for CMC

1.  **Enforce Gate-Provisioning Rule (Zero Orphans)**:
    *   Deactivate the UI button for direct Student creation (`student.create` endpoint must be restricted to internal seeds/migrations).
    *   Provision the `Student` and `Enrollment` atomically inside the transaction of `receipt.approve` once payment is verified.
2.  **Add Intake Deduplication**:
    *   Implement an automated `findOrCreateStudent` helper during provisioning. Search for existing student records by parent/guardian phone number to prevent duplicate customer profiles.
3.  **Capture Guardian Details Early**:
    *   Extend the CRM `leadIngest` structure and UI forms to collect parent/guardian info (full name, phone, email, relationship) at the top of the funnel. Write these to the `Contact` note or distinct relation fields so they can be mapped to a `Guardian` record automatically upon student provisioning.
4.  **Expose Audits as a Chatter Sidebar**:
    *   Expose the contents of `RecordEvent` as a chronological activity sidebar in both the Opportunity pipeline cards and the Student details view, mirroring Odoo's Chatter feature.

---

## Unresolved Questions
1.  **Rollback Behavior**: What happens to the provisioned `Student` and `Enrollment` records if a receipt is rejected or cancelled after approval? Should the student lifecycle state rollback to a non-active status?
2.  **Field Mutability**: Which fields on the student profile should remain immutable post-provisioning (e.g., student name mapping from the opportunity vs. manual correction of typos)?
