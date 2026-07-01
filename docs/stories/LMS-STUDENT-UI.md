# LMS-STUDENT-UI: Upgrade LMS student post-login UI/UX

## Status

planned

## Lane

normal

## Product Contract

Redesign and beautify the LMS post-login dashboards and views for both Students (primary age 3-11) and Parents. Elevate the aesthetics to be playful, engaging, and premium, utilizing curated gradients, glassmorphism cards, enhanced typography, and micro-animations, while maintaining 100% compatibility with the existing backend services and tRPC schema.

## Relevant Product Docs

- [docs/roadmap.md](file:///d:/project/CMCnew/docs/roadmap.md)
- [docs/design-system.md](file:///d:/project/CMCnew/docs/design-system.md)
- [packages/ui/src/tokens.css](file:///d:/project/CMCnew/packages/ui/src/tokens.css)

## Acceptance Criteria

- **Kid & Parent-Centric Theme**: Implement a soft, vibrant color theme utilizing dynamic CSS variables (gradients, friendly brand accents) that speaks to both students and parents.
- **Enhanced Climb Beanstalk (ClimbView)**: Make the beanstalk climbing journey feel more alive with floating cloud layers, a smoother ambient sky gradient, bobbing "you are here" signposts, and playful hover/active states for clouds.
- **Vibrant Stat Cards & Badges**: Improve the cards under Overview and Rewards with glassmorphism backgrounds, shadows, and subtle gradient borders.
- **Responsive Navigation**: Adapt the sidebar navigation structure to look cleaner on both desktop and mobile viewports.
- **Interactive Sandbox/Showcase**: Build a standalone UI showcase at `/showcase` route in the LMS app allowing the user to experience the new interface mockup live before merging.

## Design Notes

- **UI Surfaces**: `apps/lms/src/student-shell.tsx`, `apps/lms/src/student-view.tsx`, `apps/lms/src/climb-view.tsx`, `apps/lms/src/climb/cloud-climb.tsx`
- **Design Tokens**: Modify/Extend CSS variables in `packages/ui/src/tokens.css` or localized `apps/lms/src/climb/cloud-climb.css`.
- **Framework**: Mantine UI + custom Vanilla CSS.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | CSS design token parser checks |
| Integration | Smoke tests of the tRPC connectivity on the new pages |
| E2E | Run the lms-smoke spec and verify no layout breaking |
| Platform | Visual inspection of student-shell on desktop and simulated mobile viewports |

## Evidence

(None yet)
