# PR #31 Thread Resolution and Consolidation Map

> Last updated: 2026-03-10  
> Purpose: map unresolved review findings from PR #31 to concrete fixes and validation evidence on canonical branch `c/mobile-ui-ux-quality-plan-29ef`

## Execution target decision

- Chosen path: **focused follow-up canonical PR** (`c/mobile-ui-ux-quality-plan-29ef`) instead of adding more commits directly to the superseded mega-PR branch.
- Rationale: preserve existing implementation work, isolate remediation commits, and provide one clear review source of truth.

## Mobile review thread mapping

| Review finding | File(s) | Fix implemented | Evidence |
|---|---|---|---|
| Sign-in routes directly to tabs (auth boundary bypass) | `apps/mobile/app/(auth)/sign-in.tsx`, `apps/mobile/app/(auth)/_layout.tsx`, `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/app/_layout.tsx`, `apps/mobile/lib/preview-session.tsx` | Added preview session provider, auth redirects, guarded sign-in/sign-out actions | Manual walkthrough: unauthenticated `/points` redirects to sign-in; valid sign-in enters tabs; sign-out returns to sign-in |
| Leaderboard chips are visual-only | `apps/mobile/app/(tabs)/points-details.tsx` | Added selected-window state, active chip styling by state, and per-window leaderboard datasets | Manual walkthrough: All time/Semester/Month chips switch styling and rows |
| Preferences hydration lacks parse-error recovery | `apps/mobile/app/(tabs)/preferences.tsx` | Added malformed JSON catch path, cleanup recovery, and safe hydration completion | Lint/typecheck pass + manual preferences hydration recovery validation |
| Network banner treats unknown reachability as degraded | `apps/mobile/components/network-banner.tsx` | Degraded state only on explicit reachability failure (`isInternetReachable === false`) | Manual walkthrough: no degraded flash on initial app load |
| Expo package mismatch (`expo-network`) | `apps/mobile/package.json`, `package-lock.json` | Pinned `expo-network` to SDK-compatible `~8.0.8` | Dependency manifest verification + mobile lint/typecheck pass |
| Dead-end controls in event details/chat thread | `apps/mobile/app/(tabs)/event-details.tsx`, `apps/mobile/app/(tabs)/chat-thread.tsx`, `apps/mobile/lib/calendar-export.ts` | Wired live handlers and visible feedback for calendar export, retry upload, and queued message actions | Manual walkthrough: each control produces immediate behavior and feedback |
| Web visual regression startup command mismatch | `apps/web/playwright.config.ts` | Updated Playwright webServer command to workspace-safe `npm run dev` | CI failure root cause removed (`No workspaces found --workspace=apps/web`) |

## Non-mobile review thread mapping

| Review finding | File(s) | Fix implemented | Evidence |
|---|---|---|---|
| `web-visual-regression` job inherits broad default token permissions | `.github/workflows/ci.yml` | Added explicit minimal permissions block (`contents: read`) on `web-visual-regression` job | Workflow diff review + CI job definition check |
| Invite link copied with query bearer token | `apps/web/components/members/invite-member-dialog.tsx` | Removed query-token link copying; now copies structured invite code message for manual redemption | UI copy/control update + lint/typecheck pass |
| Dashboard quick actions are inert CTAs | `apps/web/app/(dashboard)/page.tsx` | Mapped available actions to real routes and left unimplemented flow explicitly disabled with rationale | Keyboard-activatable links + explicit disabled reason semantics |
| Event editor accepts invalid schedule window | `apps/web/components/events/event-editor-dialog.tsx` | Added `end > start` validation with destructive toast on invalid range | Type/lint pass + form logic verification |
| Event save and refresh failures conflated | `apps/web/components/events/event-editor-dialog.tsx` | Separated mutation failure path from post-save refresh failures with explicit follow-up toast | Error-path logic review + lint/typecheck pass |
| Mobile users lack practical nav access in dashboard shell | `apps/web/components/layout/dashboard-shell.tsx` | Added mobile nav sheet (hamburger trigger) and made command-menu trigger available on small screens | Responsive manual validation path |
| Async state components missing client directive for event handlers | `apps/web/components/shared/async-states.tsx` | Added `"use client"` pragma | Build/type correctness and App Router client semantics preserved |

## Canonical PR summary checklist

Use this checklist in the canonical PR description:

- [ ] Blocker fixes included (auth gate, dead-end controls, chips, parse safety, network null handling, Expo pin, visual regression startup fix)
- [ ] Theme parity called out (mobile + web, system default + manual override)
- [ ] Interaction QA hardening docs linked (`MOBILE_INTERACTION_SMOKE_CHECKLIST`, PR template dead-end control guard)
- [ ] Icon intent map + icon grammar consistency linked
- [ ] Test evidence attached:
  - [ ] mobile/web lint + typecheck results
  - [ ] web visual regression result
  - [ ] manual walkthrough artifact

## Closure note snippets for superseded PRs

### Superseded PR #31

`Closing as superseded by the canonical implementation PR: <NEW_PR_URL>. This branch carries forward #31 plus blocker remediations and consolidated validation evidence, and is now the single review source of truth.`

### Stale draft PRs #30, #32, #33

`Closing during PR consolidation so review focus stays on the canonical implementation PR: <NEW_PR_URL>. Re-open scope in a focused follow-up if still needed.`

## Verification bundle (local)

- `npm run lint -w apps/mobile`
- `npm run check-types -w apps/mobile`
- `npm run lint -w apps/web`
- `npm run check-types -w apps/web`
- `npm run test:visual -w apps/web`
- `npm run lint`
- `npm run check-types`
- Manual walkthrough artifact (mobile + web interaction/theme matrix)
