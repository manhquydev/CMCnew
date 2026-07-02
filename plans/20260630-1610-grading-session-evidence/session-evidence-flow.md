# Business Flow: /grading session evidence

## Roles

- GV: uploads photos, writes class/session/student comments, publishes.
- Head teacher / Quan ly: can review or edit depending permission.
- PH/HS: reads published session information in LMS, scoped to owned student.

## Happy Path

```mermaid
sequenceDiagram
  participant T as Teacher
  participant A as Admin /grading
  participant API as API/RLS
  participant DB as Postgres
  participant L as LMS
  participant P as Parent

  T->>A: Select facility + class
  A->>API: schedule.listSessions(classBatchId)
  API->>DB: RLS staff facility query
  DB-->>API: class sessions
  API-->>A: sessions

  T->>A: Open session evidence
  T->>A: Upload photos + summary + student comments
  A->>API: upload/session-photo
  API-->>A: imageRef
  A->>API: sessionEvidence.upsertDraft
  API->>DB: write draft evidence + comments
  DB-->>API: draft
  API-->>A: saved

  T->>A: Publish
  A->>API: sessionEvidence.publish(sessionId)
  API->>DB: set publishedAt + audit log
  API-->>A: published

  P->>L: Open Buoi hoc
  L->>API: sessionEvidence.listForPrincipal(studentId)
  API->>DB: RLS LMS ownership + published only
  DB-->>API: visible sessions + own comment
  API-->>L: cards/gallery/comment
  L-->>P: lesson evidence for child only
```

## UX Target

- One class screen, not separate teacher chores.
- Teacher works in this order: choose session, attach evidence, comment students, publish.
- Draft save is automatic/cheap; publish is explicit.
- LMS view reads like a learning diary, not a grading table.

## Failure / Guard Flow

```mermaid
flowchart TD
  A[Upload image] --> B{Valid image and size?}
  B -->|No| C[Reject with friendly error]
  B -->|Yes| D[Store image ref]
  D --> E{Caller can access session?}
  E -->|No| F[Forbidden, no existence leak]
  E -->|Yes| G[Attach to draft]
  G --> H{Publish?}
  H -->|No| I[Visible staff-only]
  H -->|Yes| J[Visible LMS via guardian/student ownership]
```

## Optimization Notes

- Default to today's/nearest session after class select.
- Inline student comments in a roster table; no modal per student.
- Preserve existing exercise grading tab to avoid retraining.
- Publish checklist should show: photos count, summary present, comments count.
