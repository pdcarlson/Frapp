# Canonical PR Body Draft — Mobile/UI UX Consolidation

> Use this text when opening the canonical replacement PR from `c/mobile-ui-ux-quality-plan-29ef` into `main`.

## Why this PR exists

This PR consolidates implementation and review context from superseded PR #31 plus targeted remediation commits into a single source of truth.

## Blocker fixes included

- **Auth gate hardening (mobile preview):**
  - Session-backed route guards now block unauthenticated access to `/(tabs)`.
  - Sign-in and sign-out actions now mutate preview session state before route transitions.
- **Dead-end control removal (mobile):**
  - Event details `Add to Calendar` triggers real export behavior with immediate feedback.
  - Chat thread retry/queue controls now mutate state and surface user feedback.
- **Leaderboard chips now functional (mobile):**
  - Time-window chips (`All time`, `Semester`, `Month`) now update selected state and rendered leaderboard dataset.
- **Preferences parse safety (mobile):**
  - Malformed persisted JSON no longer crashes hydration; safe fallback and recovery path added.
- **Network null handling (mobile):**
  - Unknown reachability (`null`) no longer triggers degraded/offline flash.
- **Expo dependency pin fix:**
  - `expo-network` aligned to SDK-compatible `~8.0.8`.
- **Web visual regression startup fix:**
  - Playwright web server command corrected to workspace-safe `npm run dev`.

## Review-thread remediations added in this branch

- Added explicit CI token permissions for `web-visual-regression` (`contents: read`).
- Removed query-token invite URL copying; invite flow now copies a secure code payload.
- Wired dashboard quick actions to real routes or explicit disabled rationale.
- Added event schedule guard (`end > start`) and split mutation failures from post-save refresh failures.
- Added mobile-accessible dashboard navigation drawer with hamburger trigger.
- Added missing `"use client"` directive for interactive async-state components.

## Theme parity (mobile + web)

- Mobile now supports persisted Light/Dark/System preference with runtime token resolution.
- Web now wires `next-themes` provider and user-facing theme toggle (Light/Dark/System).
- Shared token model supports runtime light/dark mode consumption across surfaces.

## Interaction QA hardening and docs

- Added explicit dead-end-control gate to PR template.
- Added mobile interaction smoke checklist:
  - `docs/internal/MOBILE_INTERACTION_SMOKE_CHECKLIST.md`
- Added cross-surface thread resolution and consolidation map:
  - `docs/internal/MOBILE_THREAD_RESOLUTION_MAP.md`

## Icon intent + grammar consistency

- Added icon intent map:
  - `docs/internal/ICON_INTENT_MAP.md`
- Updated iconography guidelines and navigation icon grammar alignment.

## Test evidence

### Automated checks (local)

- `npm run lint -w apps/mobile` ✅
- `npm run check-types -w apps/mobile` ✅
- `npm run lint -w apps/web` ✅
- `npm run check-types -w apps/web` ✅
- `npm run test:visual -w apps/web` ✅ (after baseline update for intentional header/nav changes)
- `npm run lint` ✅
- `npm run check-types` ✅

### Manual walkthrough highlights

- Mobile auth redirect, sign-in validation, and sign-out redirect verified.
- Mobile points chips, calendar export, and chat retry/queue feedback verified.
- Web mobile nav drawer and quick-action behavior verified.
- Web + mobile theme toggle behavior (System/Light/Dark) verified.

## Review carry-forward

- This PR supersedes #31 and is intended as the canonical review surface.
- Thread-to-fix mapping and closure-note snippets are documented in:
  - `docs/internal/MOBILE_THREAD_RESOLUTION_MAP.md`
