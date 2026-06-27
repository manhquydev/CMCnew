# Feature Comparison: Student and Enrollment Module
## Source: https://github.com/openeducat/openeducat_erp (op_student, op_admission)
## Local Project: CMCnew (C:/Users/manhquy/cmc_source)

## Executive Summary
Analysis of Student, Parent, and Enrollment workflows. OpenEduCat maps contacts via Odoo's `res.partner` and enforces atomic student creation via admission state transitions. CMC uses a facility-scoped schema, an independent login credentials table, and junction model (`Guardian`) to solve legacy vulnerability (A3). Security isolation comparison reveals Odoo uses application-level record rules while CMC enforces strict database-level Postgres Row Level Security (RLS) policies.

---

## Head-to-Head

| Aspect | Source (OpenEduCat) | Local (CMC) | Recommendation |
| --- | --- | --- | --- |
| **Student Representation** | `op.student` inherits `res.partner` directly. Optional link to system user (`res.users`). | `Student` is facility-scoped. Optional 1:1 relation to `StudentAccount` (simple PIN login for kids). | Retain CMC's decoupled approach. Fits custom LMS requirements and headless API. |
| **Parent-Student Relationship** | `op.parent` inherits `res.partner`. Many-to-many relationship (`student_ids`) to `op.student`. | `ParentAccount` (email/phone login) linked to `Student` via `Guardian` join table (relation enum, facility-scoped). | Retain CMC `Guardian` junction model. Direct fix for security flaw (A3). |
| **Admission Pipeline** | Explicit state machine: `draft ➔ submit ➔ confirm ➔ admission ➔ done`. Student record provisioned atomically only at `done`. | Opportunities managed via CRM (`O1 ➔ O5`). Student record created manually at `admitted`, resulting in orphaned records. | **Adopt Atomic Provisioning:** At payment approval (`receipt.approve`), atomically create `Student`, `Enrollment`, and link `Guardian`. |
| **Enrollment Flow** | First-class `op.student.course` model linking student, course, batch, roll number, and fees term. | `Enrollment` table joining `ClassBatch` and `Student`. Status: `active` and completed manually (`completed`). | Retain CMC's `Enrollment` join model. Simple and effective for Node stack. |
| **Lifecycle Transitions** | Course state (`running ➔ finished`) decoupled from student record status. | `StudentLifecycle` (`admitted`, `active`, `on_hold`, `transferred`, `withdrawn`, `completed`) linked to CSKH case workflows. | Retain CMC's CSKH-driven transitions. Offers good operational traceability. |
| **History & Audit Logging** | Odoo Chatter (`mail.thread`) tracks field changes dynamically. | Polymorphic `RecordEvent` (actor, type, old/new changes) logs audit history for all models. | Retain CMC `RecordEvent` model. Fits custom Node stack requirements. |
| **Security & Multi-Tenancy** | Application-level record rules (`ir.rule`) using domain filters (e.g. user ID match). | Postgres-level Row-Level Security (RLS) driven by GUC parameters (`app.facility_ids`, `app.student_ids`). | Retain CMC RLS. Offers bulletproof security at database tier, far superior to Odoo's application rules. |

---

## Deep Dive: Data Models

### OpenEduCat Schema (Odoo Python)
- **`op.student`**: Linked to `res.partner` (`_inherits`). Standard attributes (name, email, phone, street) inherited. Custom fields: registration number (`gr_no`), `birth_date` (constrained `≤ today`), `course_detail_ids` (O2M to `op.student.course`).
- **`op.parent`**: Associated with `res.partner` (where `is_parent=True`). Contains M2M link `student_ids` to `op.student`, relation metadata (`relationship_id`), and optional login portal account.
- **`op.student.course`**: First-class enrollment record. Stores `student_id`, `course_id`, `batch_id`, unique `roll_number` (scoped per batch), and `state` (`running` | `finished`).

### CMC Local Schema (prisma.schema)
- **`Student`**: Scoped by `facilityId`. Contains `studentCode` (unique), `fullName`, `dateOfBirth`, `program` (UCREA, BRIGHT_IG, BLACK_HOLE), and `lifecycle` (enum `StudentLifecycle`). Links to `Enrollment` and `Guardian`.
- **`ParentAccount`**: Primary login credentials (display_name, email, phone, password_hash, isActive, tokenVersion). Independent of staff `AppUser`.
- **`StudentAccount`**: Optional 1:1 simple credential model (`loginCode`, `passwordHash`) for children.
- **`Guardian`**: Junction table mapping `ParentAccount` and `Student`. Contains `facilityId`, `parentAccountId`, `studentId`, and relationship enum (`relation`: father, mother, guardian). Scoped by facility.
- **`Enrollment`**: Connects `Student` to `ClassBatch` with `EnrollmentStatus` (active, completed, reserved, transferred, withdrawn).

---

## Deep Dive: Business Rules & State Transitions

### Admission & Provisioning
- **OpenEduCat**: Admission registers (`op.admission.register`) configure intake. Applying is a draft transaction that must transition to `done` before the student is provisioned. `enroll_student()` executes atomically: creates student ➔ creates course enrollment ➔ sets up fee schedule ➔ assigns default subjects. Prevents invalid or duplicate records.
- **CMC**: Currently decoupled. Student is created manually in `student.create` with status `admitted`. Enrollment is mapped manually inside `enrollmentRouter.enroll`, which then transitions the student's lifecycle to `active`. This creates the potential for orphaned "admitted" records in the database.

### History & Auditing
- **OpenEduCat**: Field-level audits are pushed to Odoo's Chatter component automatically.
- **CMC**: Writes explicit audit logs using the polymorphically structured `RecordEvent` table. Every change in a student's lifecycle (e.g. from `active` to `on_hold`) is logged under `status_changed`. If changed via a CSKH ticket, both the ticket and the student log reference the transition for total auditability.

---

## Deep Dive: Security & RLS Policies

- **OpenEduCat**: Record Rules (`ir.rule`) are evaluated in the Odoo ORM layer. For parents, the security domain is `[('parent_id.user_id', '=', user.id)]`. This security is bypassed if raw database cursors (`self.env.cr.execute`) are used in backend python code.
- **CMC**: Implemented at the Postgres engine level. Database connections run under the unprivileged role `cmc_app`. Application calls GUC wrapper `withRls()` to pass connection contexts:
  - `app.facility_ids`: isolates facility scopes for staff.
  - `app.principal_kind`: tracks if actor is `staff`, `parent`, or `student`.
  - `app.student_ids`: tracks target student scopes for parents or student logins.
- **Policy Enforcement**: Row-level policies (`USING` and `WITH CHECK` clauses) block unauthorized read/write attempts at the database engine level, preventing any application-level data leaks.

---

## Decision Matrix

| # | Decision | Source's Way | Local Way | Hybrid | Risk | Choice |
|---|---|---|---|---|---|---|
| 1 | **Student Provisioning** | Atomic on admission completion (`enroll_student`) | Manual creation (`student.create`) | **Trigger on payment approve (`receipt.approve`):** Atomically provision Student, Enrollment, and Guardian. | Low | Hybrid |
| 2 | **Parent Mapping** | Post-enrollment many-to-many link | Junction table (`Guardian`) | **Retain Guardian junction:** Simple, secure, and scopes parents to facility correctly. | Low | Local |
| 3 | **Enrollment Structure** | First-class `op.student.course` tracking roll numbers | Junction table (`Enrollment`) | **Retain Enrollment junction:** Direct relationship maps cleanly to local schema. | Low | Local |
| 4 | **Audit Logs** | Odoo Chatter | Polymorphic `RecordEvent` table | **Retain RecordEvent:** Efficient custom implementation fits Node backend. | Low | Local |
| 5 | **Security Model** | ORM-level Record Rules (`ir.rule`) | Database-level Postgres RLS | **Retain Postgres RLS:** Crucial for robust multi-tenant and parent portal isolation. | High | Local |

---

## Universal Challenges (Stress-Test Questions)

1. **Do we need a complex configured intake register like OpenEduCat?**
   - *Source*: Yes, configuration controls intake dates and caps.
   - *Local*: No. CMC uses CRM opportunities and class batches. Keep it simple (KISS) to avoid over-engineering.
   - *Risk of mismatch*: High backend complexity with zero user utility.
2. **How to prevent orphaned "admitted" student records?**
   - *Source*: Only provision the student record at the end of the application flow.
   - *Local*: Deprecate direct student creation from UI. Shift creation to occur atomically when a financial receipt is approved.
   - *Risk of mismatch*: Database gets polluted with invalid lead records that bypass accounting.
3. **Who should be allowed to create Parent/Guardian profiles?**
   - *Source*: Created by admin post-admission.
   - *Local*: Currently locked to `bgd` and `quan_ly`. Recommendation is to allow `sale` to capture parent contact details at opportunity stage to prevent sales process blocks.
   - *Risk of mismatch*: Sales representatives bypassing parent linkage and creating dummy records.
4. **Is Postgres RLS superior to application-layer record rules?**
   - *Source*: Record rules are flexible but easily bypassed by direct SQL queries.
   - *Local*: Yes, Postgres RLS guarantees database-level isolation that cannot be bypassed by developers writing raw SQL.
   - *Risk of mismatch*: High risk of cross-facility leaks if security is moved back to the app layer.
5. **How should multi-facility students be modeled?**
   - *Source*: Handled by standard Odoo multi-company rules.
   - *Local*: Student is strictly facility-scoped. If a student changes facility, they are marked `transferred` and a new record is provisioned in the new facility.
   - *Risk of mismatch*: Violation of local multi-facility data sovereignty policies.

---

## Recommendations

1. **Deprecate Direct Student Creation**: Remove the "Add Student" button from the main admin UI. Student records should only be created atomically via the `receipt.approve` transaction in `apps/api/src/routers/finance.ts`.
2. **Allow Sale Representatives to Capture Parents**: Update the `guardianRouter.parentCreate` roles to allow `Role.sale` to input parent data during lead capture.
3. **Retain Security & Database Models**: The Postgres RLS policies and `Guardian` junction model are robust and architecturally sound; do not port Odoo's application-level security model.

---

## Unresolved Questions

1. **Rollback behavior on Receipt Cancellation**: If a financial receipt that provisioned a student is cancelled or rejected, should the student record be soft-deleted, or should its lifecycle status revert to `admitted`?
2. **Multi-program Enrollment**: Does CMC permit a student to be enrolled in multiple courses across programs (e.g. UCREA and BRIGHT_IG) at the same time, or is there a 1-to-1 constraint?
3. **Cross-Facility History**: When a student is `transferred` between facilities, how should their audit history (`RecordEvent` timeline) be linked across the two facility databases?
