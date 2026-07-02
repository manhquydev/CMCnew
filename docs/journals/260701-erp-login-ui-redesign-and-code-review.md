# Technical Journal — ERP Login UI/UX Redesign & Security Hardening

**Date**: 2026-07-01  
**Author**: Antigravity  
**Topic**: ERP Login UI/UX Redesign, A11y, and Multi-Agent Code Review Resolution

---

## 1. Context & Motivation
The original ERP login gate lacked visual consistency, used confusing title colors (blue link color for static text), and did not provide redirects for external stakeholders (e.g., parents, student users) who accidentally landed on the employee portal.

The goal was to build a modern, high-converting, and beautiful login experience that aligns with the educational core of CMC (development of digital thinking and logical capabilities for kids).

---

## 2. Key Decisions & Architecture

### Split-Screen Layout (Option 3)
- Implemented a 55/45 Split-Screen layout as the single, polished login design.
- **Left Column (Visual/Brand)**: Uses a custom high-end flatlay photograph of Montessori-style wooden blocks (`/brand/erp-login-bg.png`) representing logical creativity and construction. Overlaid with a smooth, dark-to-translucent slate gradient (`linear-gradient(to right, rgba(15, 23, 42, 0.9) 0%, rgba(15, 23, 42, 0.35) 100%)`) to ensure maximum typography readability while keeping the warm blocks texture visible.
- **Right Column (Form)**: Minimalist login paper centering form inputs on a slate white background (`#F8FAFC`).
- **Responsive design**: Clean collapse under 900px, hiding the visual column and showing a mobile-only centered logo.

### Redirection & Redirection Anchors
- Added a header and footer redirection system:
  - **Trang chủ CMC** (`https://cmcvn.edu.vn/`)
  - **Cổng học tập LMS** (`https://hoc.cmcvn.edu.vn/login`)
- Provides clear, friendly directions for external visitors and prevents system-entry frustration.

---

## 3. Code Review & Code Hardening
Following the multi-agent code review (UI/UX, Security, and Code Quality), we implemented the following immediate fixes:
- **Security Hardening**: Added `autoComplete="username"` and `autoComplete="current-password"` to the `TextInput` and `PasswordInput` forms to ensure correct browser autofill behavior.
- **UX Alignment**: Adjusted the Microsoft SSO SVG icon's margin (`marginRight: '6px', marginTop: '-2px'`) for perfect vertical alignment with the text.

---

## 4. Verification Results
- Compile check: `@cmc/ui` and `@cmc/admin` typechecks -> **PASS**
- Card execution: `/flow check C-001` -> **PASS**
- Visual verify: Headless browser subagent verified transitions, error states, and rendering.
