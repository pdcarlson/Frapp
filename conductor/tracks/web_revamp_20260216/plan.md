# Implementation Plan: Web Revamp & Theme Engine (Phase 6.3)

This track overhauls the web application, integrates the new SDK, and implements the "Smart Purple" light/dark theme engine.

## Phase 1: Shared Theme Infrastructure [checkpoint: 25820]

- [x] **Task:** Create `packages/theme` with shared Tailwind tokens and CSS variables. 33100
- [ ] **Task:** Implement `ThemeContext` in `packages/ui` for universal theme switching.
- [x] **Task:** Update `apps/mobile` to use the new `@repo/theme` tokens. 25820

## Phase 2: Web Foundation [checkpoint: 33100]

- [x] **Task:** Configure `apps/web` to use the shared `@repo/api-sdk` and `@repo/validation`. 33100
- [x] **Task:** Set up `@clerk/nextjs` for web authentication. 33100
- [x] **Task:** Integrate `lucide-react` for modern icon support. 33100

## Phase 3: Dashboard Architecture [checkpoint: 19484]

- [x] **Task:** Create a modern sidebar layout using the new "Smart Purple" design system. 13420
- [x] **Task:** Implement light/dark mode toggle. 13420
- [x] **Task:** Build the "Member Directory" page using the shared `useMembers` logic. 19484

## Phase 4: Verification [checkpoint: 22792]

- [x] **Task:** Run final Build, Lint, and Type checks across the monorepo. 22792
- [x] **Task:** Conductor - Final Track Verification 22792
