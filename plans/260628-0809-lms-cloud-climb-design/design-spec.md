# LMS "Leo Tầng Mây" — Design Spec (CMC-branded)

Status: WIREFRAME for review · 2026-06-28 · Lane: normal (UI, no contract change) · Branch: develop

## Concept

Reimagine the LMS student experience as a **vertical cloud-climbing path**: every homework
exercise is a **cloud node**; completing it earns **stars** and climbs the student higher
toward the summit. This is a *visual reskin + gamification layer* over the data that already
exists (exercises, submissions, stars, badges, leaderboard) — **no new business logic, no new
API contracts**.

Source of the metaphor: `D:\project\cungcontuhoc` `cloud-garden` + `beanstalk-garden`.
**Excluded by request:** all mascot / linh vật components (`MascotCompanion`,
`GardenMascotGuide`, `mascot-guide/`, mascot speech bubbles).

Brand identity stays **CMC**: Apple-blue primary (`#0071E3`), CMC logo, and the public-site
imagery (kids, program marks BlackHole / BRIGHT I.G / UCREA) from
`D:\project\CMC\src\website\public`.

## Why this fits

CMC's LMS is a **homework/practice platform** (not live online classes). The existing
student tabs — exercises, results, badges, ranking, rewards — already form a progression.
The climb simply *renders* that progression as a journey instead of a table. Functionality
(open exercise → PDF/text answer → submit → get graded → earn stars) is unchanged.

## Brand fusion — color tokens (wireframe)

| Token | Value | Use |
| --- | --- | --- |
| `--sky-top` | `#0071E3` | top of sky (CMC brand) |
| `--sky-mid` | `#4494E9` | mid sky |
| `--sky-low` | `#A3C8F5` | low sky near clouds |
| `--sky-horizon` | `#E8F1FC` | horizon haze |
| `--cloud` | `#FFFFFF` / `#F2F6FD` | cloud bodies |
| `--star-gold` | `#FF9F0A` → `#FFD98A` | stars, current node glow |
| `--done-green` | `#34C759` | completed node |
| `--locked-gray` | `#BCBCC2` | locked node |
| node radius | 22–28px (cloud blobs) | matches Apple-soft CMC radius |

Keeps CMC's Apple-flat shape language (soft radius, light shadows) but adds the playful
**floating-cloud** silhouettes and **gold star** reward motif for kids.

## Screens (see `wireframe.html`)

1. **Bản đồ leo mây (Climb Map)** — the home screen. Top HUD: CMC logo · ⭐ star balance ·
   level pill · 🔥 streak. A vertical winding path of cloud nodes (alternating left/right),
   grouped into **program zones** (BlackHole / BRIGHT I.G / UCREA banners). Node states:
   **completed** (green check + earned stars), **current** ("Bạn ở đây", gold pulse),
   **available** (blue), **locked** (gray + lock). Round kid photos decorate milestone clouds.
2. **Mở bài (Node popover)** — tap a node → card with lesson title, due date, star reward,
   status, and a "Làm bài" pill. (Maps to the current exercise row → open.)
3. **Màn làm bài (Activity)** — progress HUD (stars + cloud progress bar) over a white
   "content stage" cloud panel holding the question; answer area (cloud buttons for quiz,
   or the existing PDF-annotator / textarea for homework); "Nộp bài" pill. (Maps to the
   current `ExerciseModal`.)
4. **Hoàn thành (Completion)** — celebration overlay: star-burst (CSS, no mascot), 3-star
   rating, "+N sao", encouraging copy, "Leo tiếp" / "Về bản đồ" buttons. (Triggers on a
   graded/passed submission.)

## Implementation surface (proposed, for the NEXT phase — not this review)

- New package area `@cmc/ui` cloud primitives: `CloudNode`, `ClimbPath`, `ClimbHud`,
  `StarBurst`, `CloudStage` — pure presentational, fed by existing tRPC data.
- New `apps/lms/src/climb-view.tsx` rendering the path from `exercise.listForPrincipal` +
  `submission.mine` + `rewards.balance` (all existing queries). `student-view.tsx` keeps the
  table as a fallback/accessibility view; climb becomes the default "exercises" surface.
- Brand assets copied into `apps/lms/public/brand/` (logo, kid rounds, program marks).
- **No** changes to API routers, DB schema, or auth. Zero new env vars.

## Open questions for the user (answer to unblock mass implementation)

1. **Sky palette**: keep the on-brand **CMC-blue daytime** sky (this wireframe), or the
   original **purple→peach dusk** from cungcontuhoc?
2. **Scope of the climb**: render it for the **student role only**, or also give the
   **parent** view a read-only climb of their child's progress?
3. **Path grouping**: group nodes by **program** (BlackHole/BRIGHT I.G/UCREA) as shown, or a
   single continuous climb ordered by due date?
4. Replace the exercises table entirely, or keep a **toggle** (climb ⇄ list)?
