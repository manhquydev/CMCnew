# Odoo CRM Lead-to-Opportunity-to-Customer Architecture Analysis

**Objective**: Extract Odoo's CRM pipeline modeling and lead-to-customer conversion logic for comparison against CMC's Opportunity (O1...O5) manual pipeline.

**Source**: Odoo GitHub `master` branch, `addons/crm` module
- `addons/crm/models/crm_lead.py` — lead/opportunity model, conversion logic
- `addons/crm/models/crm_stage.py` — configurable pipeline stages
- `addons/crm/models/crm_lost_reason.py` — loss reason tracking
- `addons/crm/models/crm_team.py` — team-based assignment & capacity
- `odoo/addons/base/models/res_partner.py` — unified customer/contact model

---

## 1. LEAD vs OPPORTUNITY

**Field Definition** (`crm_lead.py`):
```python
type = fields.Selection([
    ('lead', 'Lead'), ('opportunity', 'Opportunity')
], required=True, tracking=15, index=True,
default=lambda self: 'lead' if self.env.user.has_group('crm.group_use_lead') else 'opportunity')
```

**Distinction**: Not a schema difference—same table, different `type` value. Default assigned by user permission group (`crm.group_use_lead`). A user account can work with leads OR opportunities depending on group membership; team configuration controls whether both are enabled (`use_leads`, `use_opportunities`).

**Conversion Method** (`crm_lead.py`):
```python
def convert_opportunity(self, partner, user_ids=False, team_id=False):
    """Converts lead to opportunity with optional partner and team assignment"""
    customer = partner if partner else self.env['res.partner']
    for lead in self:
        if not lead.active or lead.won_status == 'won':
            continue
        vals = lead._convert_opportunity_data(customer, team_id)
        lead.write(vals)
    if user_ids or team_id:
        self._handle_salesmen_assignment(user_ids=user_ids, team_id=team_id)
    return True
```

**Key behavior**: Conversion skips already-won or inactive records. The helper `_convert_opportunity_data()` prepares the write values (including `type='opportunity'`), then calls `_handle_salesmen_assignment()` for user/team routing.

---

## 2. PIPELINE STAGES (Configurable, Database-Backed)

**crm.stage Model** (`crm_stage.py`):
```python
is_won = fields.Boolean('Is Won Stage?')  # marks completion
sequence = fields.Integer('Sequence', default=1)  # ordering
team_ids = fields.Many2many('crm.team', string='Sales Teams')  # team-scoped
fold = fields.Boolean('Folded in Pipeline')  # collapsed in kanban view
```

**Crucial insight**: **Stages are database rows, not hardcoded enums**. Each CRM team can define its own stages (via `team_ids` M2M filter). The `sequence` field controls visual order; lower numbers come first. The `fold` flag collapses "done" stages in the kanban UI without hiding the lead.

**No explicit is_lost field on stage**. Loss is determined at the lead level by a combination of the `active` flag and `probability` computation.

---

## 3. LEAD → CUSTOMER PROVISIONING (Auto-Create on Conversion)

### 3a. Partner Assignment Method
```python
def _handle_partner_assignment(self, force_partner_id=False, create_missing=True):
    """Updates customer (partner_id) of leads through new or existing partner"""
    for lead in self:
        if force_partner_id:
            lead.partner_id = force_partner_id
        if not lead.partner_id and create_missing:
            partner = lead._create_customer()
            lead.partner_id = partner.id
```

**Key behavior**: 
- If `force_partner_id` is passed, use that (manual assignment).
- If lead has no `partner_id` AND `create_missing=True`, auto-create a new `res.partner`.
- Called during `convert_opportunity()` to link the lead to a customer record.

### 3b. Customer Creation Method
```python
def _create_customer(self):
    """ Create a partner from lead data and link it to the lead.
    :return: newly-created partner browse record
    """
    Partner = self.env['res.partner']
    contact_name = self.contact_name
    if not contact_name:
        contact_name = parse_contact_from_email(self.email_from)[0] if self.email_from else False

    if self.partner_id:
        partner_company = self.partner_id
    else:
        partner_company = self.env['res.partner']

    if contact_name:
        return Partner.create(self._prepare_customer_values(contact_name, parent_id=partner_company.id))

    if partner_company:
        return partner_company
    return Partner.create(self._prepare_customer_values(self.name))
```

**Deduplication**: **None**. Creates new partner every time; does NOT check for existing partners by email, name, or phone. If duplicate company records exist, each lead spawns its own contact.

### 3c. Data Mapping
```python
def _prepare_customer_values(self, partner_name, parent_id=False):
    """ Extract data from lead to create a partner.
    :return: dictionary of values to give at res_partner.create()
    """
    email_parts = tools.email_split(self.email_from)
    res = {
        'name': partner_name,
        'user_id': self.env.context.get('default_user_id') or self.user_id.id,
        'comment': self.description,
        'phone': self.phone,
        'email': email_parts[0] if email_parts else False,
        'function': self.function,
        'street': self.street,
        'street2': self.street2,
        'zip': self.zip,
        'city': self.city,
        'country_id': self.country_id.id,
        'state_id': self.state_id.id,
        'website': self.website,
        'parent_id': parent_id,
        'type': 'contact'
    }
    if not parent_id and self.partner_name:
        res['parent_name'] = self.partner_name
    if self.lang_id.active:
        res['lang'] = self.lang_id.code
    return res
```

**Hierarchy logic**: 
- If the lead already has a `partner_id` (company), the new contact is created as a **child** (`parent_id=lead.partner_id.id`).
- If no company is set, the new partner stands alone or may reference `lead.partner_name` as a text field.
- All new contacts are marked `type='contact'` (not company records).

---

## 4. CONTACT MODEL (res.partner — Unified Hierarchy)

**res.partner** (`odoo/addons/base/models/res_partner.py`):

```python
is_company = fields.Boolean(string='Is a Company', default=False, 
    compute="_compute_is_company", store=True)

parent_id = fields.Many2one('res.partner', string='Related Company', index=True)

child_ids = fields.One2many('res.partner', 'parent_id', 
    string='Related Contacts', domain=[('active', '=', True)])

type = fields.Selection([
    ('contact', 'Contact'),
    ('invoice', 'Invoice'),
    ('delivery', 'Delivery'),
    ('other', 'Other'),
], string='Address Type', default='contact')

name = fields.Char(index=True)
```

**Single-Model Approach**:
- One table (`res.partner`) models companies, individuals, and contacts.
- `is_company` boolean distinguishes entity type.
- `parent_id` creates organizational hierarchy (company → contacts under that company).
- `type` field addresses multiple roles a single partner can play (e.g., invoice address ≠ delivery address).
- Child records linked via `parent_id` are listed in `child_ids` (One2many reverse).

This allows a company record to have multiple contact records as children, each with their own type and address role.

---

## 5. WON/LOST MODELING

**Lead Status Fields** (`crm_lead.py`):

```python
probability = fields.Float('Probability', compute='_compute_probabilities', store=True)

active = fields.Boolean('Active', default=True)

lost_reason_id = fields.Many2one('crm.lost.reason', string='Lost Reason')

won_status = fields.Selection([
    ('won', 'Won'),
    ('lost', 'Lost'),
    ('pending', 'Pending'),
], compute='_compute_won_status', store=True)

date_closed = fields.Datetime('Closed Date', readonly=True)
```

**Computation Logic**:
- **Won**: `probability == 100` **AND** `stage_id.is_won == True`.
- **Lost**: `active == False` **AND** `probability == 0`.
- **Pending**: All other states.

**Lost Reason Model** (`crm_lost_reason.py`):
A separate model (`crm.lost.reason`) stores predefined reasons (e.g., "Budget constraints," "Wrong fit," "Competitor chosen"). Users select a reason when marking a lead lost. Computed field `leads_count` aggregates lost leads per reason for reporting.

---

## 6. TEAM & ASSIGNMENT CONTEXT

**crm.team** fields:
```python
use_leads: Boolean  # toggle whether this team manages leads
use_opportunities: Boolean  # toggle whether this team manages opportunities
assignment_enabled: Computed Boolean  # rule-based auto-assignment active?
assignment_max: Integer  # monthly lead capacity for the team
assignment_domain: Char  # additional filter when fetching unassigned leads
```

**Key pattern**: Teams control both lead type visibility (leads vs opps) and assignment capacity. Each team can have multiple members with individual quotas. The system prevents overallocation when `assignment_max` is exceeded.

---

## LESSONS FOR SCHOOL CRM (Opportunity → Student Conversion)

### 1. **Configurable Stages ≠ Hard Enums**
Odoo stores stages in the database (`crm.stage` rows), not as code enums. This allows admins to add/reorder/deactivate stages without deployment. **For CMC**: Replace hardcoded O1...O5 enum with a `student_stage` model. Allows future schools to define custom enrollment workflows (e.g., "Enrolled", "On Probation", "Graduated", "Alumni").

### 2. **Permission-Based Type Filtering (Lead/Opportunity Split)**
The `type` field is a single boolean-like choice, not a schema difference. User group determines what they see. **For CMC**: Model the prospect-vs-enrolled distinction as a `prospect.type` Selection field, not separate models. Apply views/permissions based on user role, not table inheritance.

### 3. **Auto-Create Customer on Conversion (But Add Deduplication)**
Odoo's `_handle_partner_assignment()` auto-creates partners on lead conversion; however, it has **no deduplication**. **For CMC**: Implement a `_find_or_create_student()` method that:
   - Checks for existing Student by email + phone before creating
   - Reuses parent company (e.g., family/guardian record) via `parent_id` hierarchy
   - Logs deduplication decisions for audit

### 4. **Hierarchy Model for Relationships (Student → Parent/Guardian)**
Odoo's `parent_id/child_ids` pattern allows a company record to have multiple contacts. **For CMC**: Use similar hierarchy for Student → Guardian relationships:
   - Guardian as "parent" record (is_company=False, parent_id=None)
   - Student as "child" (parent_id=guardian.id)
   - Supports multiple guardians per student (separate child records)

### 5. **Explicit Loss/Outcome Tracking (Lost Reason Model)**
Odoo separates "lost" logic into a dedicated `crm.lost.reason` model, not a string field. **For CMC**: For prospects who don't enroll, create `enrollment_reason` model with predefined reasons ("Budget," "Schedule conflict," "Better option found"). Enables reporting on why enrollment fails.

### 6. **Probability ≠ Stage; Both Drive Outcome**
In Odoo, `probability` is a computed float field (0–100) that can differ from the stage's inherent likelihood. **For CMC**: Separate "expected outcome" (probability field) from "workflow stage" (stage_id). A prospect in "Qualified" stage might have 30% probability if qualification criteria are weak.

### 7. **Team-Based Quotas & Capacity (For Enrollment Tracking)**
Odoo's `crm.team` with `assignment_max` and member-level `lead_month_count` allows quota enforcement. **For CMC**: Track enrollment targets per school/class/teacher. Use `crm.team_member.assignment_max` to enforce enrollment caps (e.g., "Class A: max 30 students"). Prevents overbooking.

### 8. **Audit Trail via Tracking Fields**
Odoo uses `tracking=<int>` on fields to log changes to `mail.tracking.value`. **For CMC**: Enable tracking on critical prospect→student fields (`email`, `phone`, `stage_id`, `enrollment_date`). Supports compliance audits (e.g., GDPR, data retention policies).

---

## Unresolved Questions

1. **Partner Deduplication Strategy**: Does Odoo have a plugin or best practice for matching existing partners before auto-creating? (Odoo's core `_create_customer()` has none; custom implementation required.)

2. **Lead-to-Opportunity Conversion Wizard UI**: How does the user interface guide the partner assignment choice (force existing, create new, merge)? (Not researched — wizard logic not in fetched code.)

3. **Commission Attribution**: Odoo's `crm.team_member` has quota fields but no explicit commission tracking. Where does Odoo store commission % or attribution rules? (Not researched — likely in sales/commission modules outside CRM.)

4. **Multi-Currency & Locale Handling**: The `_prepare_customer_values()` method copies `lang_id` to the partner, but no currency logic appears. How does Odoo handle multi-currency pipelines? (Not researched — likely in accounting module.)

---

## Status: DONE
**Summary**: Odoo's CRM models the lead-to-customer pipeline as a single `crm.lead` table with type-based filtering (not separate schemas), configurable database-backed stages, and automatic partner creation on conversion (without deduplication). For CMC, key transferable patterns are: configurable stages as DB rows, permission-based type filtering, auto-create with deduplication logic, hierarchy model for relationships, and explicit loss reason tracking.

