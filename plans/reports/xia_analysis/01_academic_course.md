# Feature Comparison: Academic and Course Module
## Source: Odoo (addons/website_slides) & OpenEduCat (op_course, op_subject)
## Local Project: CMC System (packages/domain-academic & schema.prisma)

This report presents a side-by-side architectural and functional comparison between Odoo/OpenEduCat and the local CMC codebase.

---

## Head-to-Head

| Aspect | Odoo (website_slides) & OpenEduCat | Local CMC Project | Recommendation |
| :--- | :--- | :--- | :--- |
| **Catalog Architecture** | **Odoo**: Global/Website-scoped `slide.channel` courses.<br>**OpenEduCat**: Multi-company/department-scoped `op.course` and `op.subject` lists. | **CMC**: Global catalog models (`Course`, `Program` enum) shared system-wide without facility scoped RLS. | **Maintain Global Catalog**: Keep `Course` global. Avoid duplicating curriculum templates per facility. |
| **Course Hierarchy** | **Odoo**: Single-level courses.<br>**OpenEduCat**: Multi-level hierarchy using `parent_course_id` (Many2one pointing to self) representing grade years or advanced streams. | **CMC**: Flat catalog. No built-in hierarchy for courses. `ClassBatch` links to a single flat `Course`. | **Keep Flat Catalog**: Use `Student.level` and `LevelProgress` to model progression rather than nesting courses. |
| **Module / Section Organization** | **Odoo**: Uses `slide.slide` with a discriminator `is_category: True` for sections/headers, linking slides via `category_id` and ordering via `sequence`. No separate tables.<br>**OpenEduCat**: Maps `op.subject` (subjects) to courses. | **CMC**: No concept of subjects/modules. `Exercise` (assignments) and meetings are directly linked to `ClassBatch`. | **Adopt Lightweight Sections**: If sections are needed, add a topic/section text field on `Exercise` or `Session` instead of a complex subject model. |
| **Student Leveling & Progression** | **Odoo**: Progress tracked via slide completion.<br>**OpenEduCat**: Student moves through course/batch levels manually; progression checked via transcripts and prerequisites.<br>No explicit "student level" field. | **CMC**: Explicit `Student.level` attribute. Level promotion is managed via a formal `LevelProgress` workflow:<br>- **UCREA**: 100% Qualitative (pillars average).<br>- **BRIGHT_IG**: 60% Qualitative / 40% Quantitative.<br>- **BLACK_HOLE**: 30% Qualitative / 70% Quantitative.<br>Manual workflow: GV proposes, Head Teacher reviews/approves, updating `Student.level`. | **Maintain Ledgers & Program Splits**: The local `LevelProgress` workflow with qualitative/quantitative splits is excellent for specialized academies. Keep this model. |
| **Prerequisites Management** | **Odoo**: Slide completion locks or unlocks access.<br>**OpenEduCat**: Many2many relations on `op.subject` (`prerequisite_ids` via `op_subject_rel`) and `op.course` level dependencies. Checked during registration. | **CMC**: No prerequisites model. Progression relies entirely on the manual approval workflow of `LevelProgress`. | **Implement Lazy Prerequisite Checks**: If formal course-level prerequisites are needed, introduce a self-referential `CourseDependency` table or handle it in the application logic. |
| **Tenancy & RLS** | **Odoo/OpenEduCat**: Company-based filters in ORM queries. No native DBMS-level Row-Level Security (RLS). | **CMC**: Postgres RLS policies enforced on all facility-scoped tables (`ClassBatch`, `Student`, `LevelProgress`, `Enrollment`). `Course` is global and bypasses RLS. | **Continue Strict RLS Enforcement**: Protect student and batch data with facility-based RLS. Keep course configuration global to minimize management overhead. |

---

## Detailed Data Model Analysis

### 1. Odoo (website_slides)
Odoo simplifies course structures by combining content and organization into a unified model:
- **`slide.channel` (Course)**: Top-level entity defining course settings, access visibility, and enrollments.
- **`slide.slide` (Content & Section)**:
  - Uses `is_category` (boolean) to designate a record as a section header/module.
  - Connects contents using `category_id` (pointing to the category slide).
  - Orders contents using a `sequence` integer field.
  - Supports different media types (video, quiz, presentation, document, webpage).

### 2. OpenEduCat (SIS core)
OpenEduCat models a traditional academic curriculum:
- **`op.course` (Course)**: Represents academic programs. Contains credit requirements, evaluation types, parent-child structures (`parent_course_id`), and fees.
- **`op.subject` (Subject)**: Represents academic units (modules/classes) belonging to a course or department. Supports theoretical/practical credit configurations and elective flags.
- **`op.subject.prerequisite`**: Implemented using a self-referential Many2many field `prerequisite_ids` on `op.subject` (via the join table `op_subject_rel`).
- **`op.batch` (Cohort/Class)**: Links a Course to a specific timeline and student group.

### 3. Local CMC Project (schema.prisma)
The local database structure aligns with a lightweight, multi-tenant academy model:
- **`Course` (Global)**: Flat catalog defining `code`, `name`, `program` (enum `Program`), and metadata. Has no `facilityId` (shared system-wide).
- **`ClassBatch` (Facility-Scoped)**: Maps a course to a physical facility. Code format is `B-YYYY-NNNN` (generated atomically). Lifecycle: `planned -> open -> running -> closed` + `cancelled`.
- **`Student` (Facility-Scoped)**: Profile containing a nullable `level` field and the selected program.
- **`LevelProgress` (Facility-Scoped)**: Ledger recording level changes. Tracks `fromLevel`, `toLevel`, and transitions via an approval workflow.
- **`GradingTemplate` / `QualitativeAssessment` / `FinalGrade`**: Defines program-specific formulas for grades.

---

## Detailed Business Rules Mapping

### 1. Course Module Organization & Sections
- **Odoo's Approach**: Odoo's use of a single `slide.slide` model with an `is_category` discriminator avoids table bloat. A course's sections are dynamically resolved by sorting by `sequence` and identifying category change boundaries.
- **CMC's Approach**: Flat structure where assignments (`Exercise`) and sessions (`Session`) are directly under the `ClassBatch`. No course sections or subjects are modeled.
- **Evaluation**: CMC's model is simpler and avoids the complexity of relational subjects, which is highly suited for K-12 style short courses.

### 2. Student Levels & Progression Logic
- **OpenEduCat's Approach**: Students progress through batches of hierarchical courses (`op.course` -> Year 1, Year 2). Progression is validated by exams, transcripts, and matching prerequisites before registration.
- **CMC's Program-Specific Progression Rules**:
  - The level is stored as a direct string attribute on `Student.level`.
  - Promotion requires calculating a `FinalGrade` based on the program type:
    - **UCREA**: 100% Qualitative. The quantitative average is ignored. Score is computed from the qualitative assessment criteria (pillars like "sáng tạo", "tập trung", "hợp tác", "tự tin").
    - **BRIGHT_IG**: 60% Qualitative + 40% Quantitative (homework, test, and attendance rate formula).
    - **BLACK_HOLE**: 30% Qualitative + 70% Quantitative.
  - A passing grade (`passed = true`, default mark 5.0) is calculated. If met, the teacher proposes promotion via a `LevelProgress` request (`status = pending`).
  - The Head Teacher must review and approve it, which updates `Student.level`.

### 3. Prerequisites & Dependency Management
- **OpenEduCat's Approach**: Enforces rigid course and subject dependencies using self-referential Many2many relationships (`op_subject_rel`).
- **CMC's Approach**: No database-enforced prerequisites. The progression pipeline is controlled manually by teachers and head teachers using `LevelProgress`.

### 4. Scheduling & Validation
- **CMC's Approach**: Hard collision checks for rooms and teachers are enforced in `@cmc/domain-academic` via `detectConflicts`. Weekly scheduling templates (`ScheduleSlot`) are expanded into concrete `Session` instances using `enumerateSessions` across the course horizon.
- **OpenEduCat's Approach**: Handled using standard calendar entries and time slots, checking for conflicts via validation constraints on save.

---

## Recommendations for CMC System

1. **Lightweight Sectioning for Courses**:
   - If courses scale and require modules or sections, avoid building a separate `Subject` model like OpenEduCat. Instead, adopt Odoo's lightweight concept: add a `sectionName` or `topic` group attribute directly to `Exercise` and `Session` models.
2. **Flexible Prerequisite Model**:
   - Do not enforce database-level blockers for prerequisites immediately. Maintain the manual approval workflow (`LevelProgress`) to support student-centric progression, which is a major business differentiator for CMC.
   - If prerequisites are needed later, introduce a `CourseDependency` join table mapping a `courseId` to its `prerequisiteCourseId`.
3. **Enhance Level Management Metadata**:
   - Standardize the `Student.level` values (e.g. by seeding them or linking them to `GradingTemplate.level`) to prevent free-text typos by teachers during the promotion proposal.

---

## Unresolved Questions
1. **Student Level Standards**: What are the exact allowed string patterns for the `Student.level` and `toLevel` fields (e.g., `UCREA-01`, `BI-01`)?
2. **Automation of Level Proposals**: Should the system automatically trigger a pending `LevelProgress` record when a student completes all course sessions with a passing `FinalGrade`?
3. **Prerequisite Gating**: Will future courses require automatic blocking of enrollment in a `ClassBatch` if the student has not completed the prerequisite course/level?
