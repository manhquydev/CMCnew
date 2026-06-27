# OpenEduCat ERP: Admission→Student Business Model Research

**Status:** DONE  
**Date:** 2026-06-26 22:24  
**Source:** https://github.com/openeducat/openeducat_erp (main branch, depth=1 clone)  
**Modules Analyzed:** openeducat_core, openeducat_admission, openeducat_parent, openeducat_fees, openeducat_assignment, openeducat_exam  

---

## 1. STUDENT MODEL (op.student)

**File:** `openeducat_core/models/student.py:61–183`

### Inheritance & Structure
- **Model name:** `op.student`
- **Inheritance:** `_inherits = {"res.partner": "partner_id"}` — student IS a partner contact
- **Key:** All res.partner fields (email, phone, address, name) available directly on student

### Core Fields
| Field | Type | Details |
|-------|------|---------|
| `partner_id` | Many2one(res.partner) | Required, cascade delete; PRIMARY inheritance link |
| `first_name` | Char | Separate from inherited `name` |
| `middle_name` | Char | |
| `last_name` | Char | |
| `birth_date` | Date | Constrained: `≤ today` |
| `gender` | Selection(m/f/o) | Required, default='m' |
| `blood_group` | Selection | A±/B±/O±/AB± |
| `nationality` | Many2one(res.country) | |
| `user_id` | Many2one(res.users) | Portal user; optional |
| `gr_no` | Char | "Registration Number"; **unique constraint** |
| `category_id` | Many2one(op.category) | Custom category |
| `course_detail_ids` | One2many(op.student.course) | **Enrollment records** — one per course+batch |
| `active` | Boolean | Soft delete; default=True |
| `certificate_number` | Char | readonly, copy=False |

### Critical Rule: Student Creation Gated via Admission Only
- No direct student creation intended in workflow
- Entry point: `op.admission.enroll_student()` → method creates student
- See Section 2 for exact mechanism

---

## 2. ADMISSION PIPELINE (THE PROVEN PATTERN)

**File:** `openeducat_admission/models/admission.py`

### State Machine (op.admission.state)
```
draft (initial)
  ↓ submit_form()
submit
  ↓ confirm_in_progress()
confirm
  ↓ admission_confirm()
admission
  ↓ enroll_student() ← **STUDENT CREATION HAPPENS HERE**
done

Alternative rejections:
confirm → confirm_rejected() → reject
confirm → confirm_pending() → pending
any    → confirm_cancel() → cancel
any    → confirm_to_draft() → draft
```

**Code reference:** Lines 77–89 for state definition; methods lines 321–513 for transitions.

### op.admission.register State (Session/Batch Management)
```
draft → confirm_register() → confirm
      → start_application() → application
                            → start_admission() → admission
                                              → close_register() → done
      → cancel_register() → cancel
```

### STUDENT CREATION: enroll_student() Method

**Signature:** Line 451  
**Purpose:** Atomic operation: create student + enroll in course + setup fees + register for subjects

**Step 1: Create Student (if New)**
```python
if not record.student_id:
    vals = record.get_student_vals()  # Lines 249–320
    record.student_id = self.env['op.student'].create(vals).id
    record.partner_id = record.student_id.partner_id.id
```

**Step 2: Prepare vals (get_student_vals, lines 249–320)**

Optionally creates res.users account (if config `openeducat_admission.enable_create_student_user` = True):
```python
student_user = self.env['res.users'].create({
    'name': student.name,
    'login': student.email or student.application_number,
    'is_student': True,
    'company_id': self.company_id.id,
    'groups_id': [(6, 0, [base.group_portal.id])]
})
```

Builds student dict:
```python
details = {
    # Contact fields
    'name': student.name,
    'phone': student.phone,
    'mobile': student.mobile,
    'email': student.email,
    'street': student.street,
    'city': student.city,
    'country_id': student.country_id.id or False,
    'state_id': student.state_id.id or False,
    'image_1920': student.image,
    
    # Student fields
    'title': student.title.id or False,
    'first_name': student.first_name,
    'middle_name': student.middle_name,
    'last_name': student.last_name,
    'birth_date': student.birth_date,
    'gender': student.gender or False,
    
    # ENROLLMENT: Create course_detail_ids (One2many) inline
    'course_detail_ids': [[0, False, {
        'course_id': student.course_id.id or False,
        'batch_id': student.batch_id.id or False,
        'academic_years_id': student.register_id.academic_years_id.id,
        'academic_term_id': student.register_id.academic_term_id.id,
        'fees_term_id': student.fees_term_id.id,
        'fees_start_date': student.fees_start_date,
        'product_id': student.register_id.product_id.id,
    }]],
    
    'user_id': student_user.id if student_user else False,
    'company_id': self.company_id.id
}
return details
```

**Step 3: Add Fees Details (lines 420–476)**

If student has fees_term_id (payment schedule):
```python
if record.fees_term_id.fees_terms in ['fixed_days', 'fixed_date']:
    for line in record.fees_term_id.line_ids:  # Each payment milestone
        dict_val = {
            'fees_line_id': line.id,
            'amount': (line.value * record.fees) / 100,
            'fees_factor': line.value,  # %
            'product_id': record.register_id.product_id.id,
            'discount': record.discount or record.fees_term_id.discount,
            'state': 'draft',
            'course_id': record.course_id.id,
            'batch_id': record.batch_id.id,
            'date': line.due_date or (fees_start_date + days(line.due_days))
        }
        val.append([0, False, dict_val])
    record.student_id.write({'fees_detail_ids': val})
```
→ Materializes fee schedule from template into per-student milestones.

**Step 4: Mark Admission Complete & Auto-Register for Subjects (lines 477–495)**
```python
record.write({
    'nbr': 1,
    'state': 'done',
    'admission_date': fields.Date.today(),
    'student_id': student_id,
    'is_student': True,
})

# Auto-enroll in course subjects
reg_id = self.env['op.subject.registration'].create({
    'student_id': student_id,
    'batch_id': record.batch_id.id,
    'course_id': record.course_id.id,
    'min_unit_load': record.course_id.min_unit_load or 0.0,
    'max_unit_load': record.course_id.max_unit_load or 0.0,
    'state': 'draft',
})
reg_id.get_subjects()  # Populate from course
```

### What Admission Form Captures

**Applicant Personal Info:**
- `name, first_name, middle_name, last_name, title`
- `birth_date, gender`
- `image` (photo)

**Applicant Contact:**
- `email` (required)
- `phone, mobile`
- `street, street2, city, zip, state_id, country_id`

**Academic Intent:**
- `course_id` (required)
- `batch_id` (optional but recommended)
- `register_id` (required; which admission session)
- `program_id` (auto-computed)

**Financial:**
- `fees` (amount)
- `fees_term_id` (payment schedule template)
- `fees_start_date` (when fees begin)
- `discount` (% discount)

**Background:**
- `prev_institute_id` (previous school; Char, not linked)
- `prev_course_id` (previous course; Char)
- `prev_result` (previous grade/result)
- `family_business` (Char)
- `family_income` (Float)

**Status Flags:**
- `is_student` (Boolean; re-enrollment of existing student?)
- `student_id` (if re-enrolling, link existing student)

### Validation Constraints

```python
@api.constrains('register_id', 'application_date')
def _check_admission_register(self):
    # application_date must be within register.start_date...end_date
    start_date < application_date < end_date
```

```python
@api.constrains('birth_date')
def _check_birthdate(self):
    # birth_date ≤ today
    # years_since_birth ≥ register_id.minimum_age_criteria
```

---

## 3. STUDENT ↔ COURSE LINKAGE MODEL

**Model:** `op.student.course` (not a hidden m2m; a real One2many)

**File:** `openeducat_core/models/student.py:26–57`

### Fields
| Field | Type | Purpose |
|-------|------|---------|
| `student_id` | Many2one(op.student) | Required; cascade delete |
| `course_id` | Many2one(op.course) | Which course |
| `batch_id` | Many2one(op.batch) | Which batch/section (e.g., "A1", "B2") |
| `roll_number` | Char | Unique per batch; for attendance, grading |
| `subject_ids` | Many2many(op.subject) | Subjects in this course enrollment |
| `academic_years_id` | Many2one(op.academic.year) | Audit: year enrolled |
| `academic_term_id` | Many2one(op.academic.term) | Audit: term enrolled |
| `state` | Selection | 'running' or 'finished'; enrollment status |

### Unique Constraints (Prevent Duplicates)
```sql
unique(roll_number, course_id, batch_id, student_id)
unique(roll_number, course_id, batch_id)
unique(student_id, course_id, batch_id)
```

→ **One student can enroll in ONE course+batch combination once.**

### Fees Extension (openeducat_fees/models/student.py)
```python
class OpStudentCourseInherit(models.Model):
    _inherit = "op.student.course"
    
    fees_term_id = fields.Many2one('op.fees.terms', 'Fees Term')
    fees_start_date = fields.Date('Fees Start Date')
```

---

## 4. PARENT/GUARDIAN MODEL

**Files:**
- `openeducat_parent/models/parent.py`
- `openeducat_parent/models/parent_relationship.py`

### Model: op.parent

| Field | Type | Purpose |
|-------|------|---------|
| `name` | Many2one(res.partner) | Link to contact; **must have is_parent=True** |
| `student_ids` | Many2many(op.student) | **One parent can manage multiple students** |
| `relationship_id` | Many2one(op.parent.relationship) | "Father", "Mother", "Guardian", "Uncle", etc. |
| `mobile, email` | Char | Derived from res.partner; read-only |
| `user_id` | Many2one(res.users) | Portal account; auto-created/linked |
| `active` | Boolean | Soft delete |

### Model: op.parent.relationship
```python
class OpParentRelation(models.Model):
    _name = "op.parent.relationship"
    name = fields.Char('Name', required=True)  # e.g., "Father", "Mother"
```

### Parent Capture & Creation Timing

**NOT captured during admission.** Instead:
1. Admission form captures applicant info only
2. After `enroll_student()` completes and student exists
3. Separately create `op.parent` records via:
   ```python
   env['op.parent'].create({
       'name': <res.partner ID>,  # Must exist and have is_parent=True
       'student_ids': [(6, 0, [student.id])],
       'relationship_id': <relationship record>,
   })
   ```

### Parent User Auto-Linking (Lines 116–140)

```python
def create_parent_user(self):
    template = env.ref('openeducat_parent.parent_template_user')
    for record in self:
        if not record.name.email:
            raise ValidationError('Update parent email first')
        if not record.name.user_id:
            user_ids = [parent.user_id.id for parent in record.student_ids 
                       if parent.user_id]
            user_id = env['res.users'].create({
                'name': record.name.name,
                'partner_id': record.name.id,
                'login': record.name.email,
                'is_parent': True,
                'groups_id': template.groups_id,
                'child_ids': [(6, 0, user_ids)]  # Link to student users
            })
            record.user_id = user_id
            record.name.user_id = user_id
```

→ Parent user gets portal access with read access to child students' records.

### res.partner Extension
```python
# In openeducat_parent inheritance
class ResPartner(models.Model):
    _inherit = 'res.partner'
    is_parent = fields.Boolean('Is a Parent', default=False)
```

---

## 5. MODULE BOUNDARY: ERP vs LMS Classification

| Module | Category | Role |
|--------|----------|------|
| **openeducat_core** | ERP | Base: Student, Course, Batch, Academic Year/Term, Department, Program, Subject, Faculty, Category |
| **openeducat_admission** | ERP | Admission application workflow + student creation (THE CRITICAL GATEWAY) |
| **openeducat_fees** | ERP | Fee schedules (template), student fee milestones, invoice integration, payment tracking |
| **openeducat_parent** | ERP | Parent/guardian management, parent portal access, parent↔student linking |
| **openeducat_attendance** | ERP | Attendance tracking per student per class/date |
| **openeducat_timetable** | ERP | Class schedule, time slots, room assignments per batch |
| **openeducat_facility** | ERP | Building, classroom, lab, resource management |
| **openeducat_library** | ERP | Library catalog, book loans, student library account |
| **openeducat_classroom** | ERP/LMS Boundary | Classroom entity + batch grouping; foundation for learning experiences |
| **openeducat_assignment** | LMS | Assignment creation, submission tracking, peer/faculty grading, rubrics |
| **openeducat_exam** | LMS | Exam schedule, question bank, student exam attempts, result recording |
| **openeducat_activity** | LMS | Activity log, engagement metrics, milestone tracking |

**ERP scope:** Data, transactions, people, finances, operations  
**LMS scope:** Learning activities, assessment, engagement, content delivery  
**Boundary:** Classroom + Batch define groups; LMS modules operate on those groups

---

## 6. LESSONS: Transferable Design Patterns

### Lesson 1: Student Creation is a Gated Atomic Transaction
- Students do NOT exist until admission reaches `enroll_student()` state
- Single method creates: student record + course enrollment + fee milestones + subject registration
- **Why:** Validates all prerequisites (age, fees, capacity, course exists) before student is "real"
- **Implication:** CMC should prevent direct student creation in UI; require admission flow first

### Lesson 2: Inherit Student from Contact/Partner
- `op.student` inherits `res.partner` → student.email, .phone, .address, .company already exist
- **Why:** Reuse partner infrastructure (comms, reporting, accounting, groups)
- **Implication:** If CMC uses Odoo, follow this pattern; if not, still make student a "specialization" of contact, not a separate entity

### Lesson 3: Enrollment is a First-Class Model, Not Hidden Metadata
- `op.student.course` is a real One2many model with: batch, roll_number, subjects, academic_year, academic_term, fees_term
- NOT just a m2m checkbox or user group membership
- **Why:** Enrollment has real data and audit trail; enables batch-level operations, roll assignments, fee tracking
- **Implication:** If CMC is not Odoo, still model enrollment as a real join table with these fields, not a hidden link

### Lesson 4: State Machine is Explicit, Not Implicit
- Each state transition is a named method: `submit_form()`, `confirm_in_progress()`, `admission_confirm()`, `enroll_student()`
- No jumping steps; each step can have validation and side effects
- **Why:** Prevents "phantom" states; audit trail is clear
- **Implication:** CMC's admission state should NOT collapse multiple transitions; make each explicit and reversible

### Lesson 5: Capture Parent Identity at Intake; Link Post-Enrollment
- Admission form asks for applicant contact info (first_name, email, phone, etc.) — NOT parent yet
- After student created, separately create `op.parent` records linking pre-existing res.partner or new partner
- **Issue with OpenEduCat:** Parent link happens post-admission; requires extra UI flow
- **Recommendation for CMC:** Extend admission form to capture **parent name + mobile + email + relationship** as line items, then auto-create op.parent records after `enroll_student()` completes

### Lesson 6: Fees Template → Instance Pattern is Reusable
- `op.fees.terms` (template): "60% on enrollment, 40% after 60 days"
- `op.student.fees_detail_ids` (instance): 60% due 2026-07-01, 40% due 2026-08-30
- **Why:** Same course can have different fee schedules per year; template is reusable; flexibility for discounts
- **Implication:** CMC commission/retention/incentive rules should follow the same template→instance pattern

### Lesson 7: Auto-Enroll in Subjects Immediately After Course Enrollment
- After `enroll_student()`, method creates `op.subject.registration` and calls `get_subjects()`
- Student immediately available for subject-level grading, assignment, attendance
- **Why:** Student can be assigned to classes/subjects the same day without extra workflow
- **Implication:** CMC should auto-populate class lists and assignment eligibility once admission is done

### Lesson 8: Separate Admission State from Enrollment State
- `op.admission.state`: application workflow (draft → submit → confirm → admission → done)
- `op.student.course.state`: enrollment lifecycle (running → finished)
- `op.student.active`: boolean soft delete
- **Why:** One student can finish one course and enroll in another; admission is one-time, enrollment is per-course-per-batch
- **Implication:** CMC should track "applicant → admitted" separately from "enrolled in course X with state=active/completed"

---

## ARCHITECTURE SUMMARY

**Flow:**
```
1. Admission Register created (session/batch management)
   ↓
2. Applicant applies via Admission form (draft → submit → confirm)
   ↓
3. Admission moves to 'admission' state (admin confirms intake)
   ↓
4. enroll_student() called:
   - Creates op.student from applicant data
   - Creates op.student.course entry (batch, academic_year, term)
   - Materializes op.student.fees_detail_ids from template
   - Creates op.subject.registration + populates subjects
   - Admission state → 'done'
   ↓
5. Admission.open_student() → student record opens (audit: state='done')
   ↓
6. Post-admission: Parents/guardians created separately
   - op.parent records link res.partner to student(s)
   - Portal user created for parent access
```

**Key Principle:** Admission is a **state machine that terminates in student creation**, not a parallel process. Single entry point, atomic operation, clear audit trail.

---

## Unresolved Questions

1. **Parent capture timing:** Should CMC capture parent contact info DURING admission (recommended) or post-admission as separate step?

2. **Program-based admissions:** OpenEduCat supports `admission_base = 'program'` (multiple courses per program) vs. `'course'` (single course). Does CMC need this complexity?

3. **Re-enrollment:** Can existing students enroll in different courses? OpenEduCat supports this via `is_student=True` flag. Does CMC?

4. **Subject registration timing:** Should subject-level enrollment happen automatically in `enroll_student()`, or deferred to later admin action?

5. **Batch assignment:** Is batch (section/class) required at admission time, or optional/assigned later? OpenEduCat marks it optional.

---

Status: DONE  
Summary: OpenEduCat gates student creation via admission state machine (draft→submit→confirm→admission→enroll_student→done), materializing fees and subjects atomically. Parent linkage is post-enrollment Many2many. This pattern is proven for K–12 and higher-ed and is directly transferable to CMC.

