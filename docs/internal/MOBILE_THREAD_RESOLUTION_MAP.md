# Mobile Thread Resolution Map (PR #31)

> Last updated: 2026-03-09  
> Purpose: map unresolved mobile review findings to implemented fixes and evidence

## Execution target decision

- Chosen path: **focused follow-up branch/PR** (`c/mobile-ui-ux-quality-plan-29ef`) rather than patching the existing mega-PR branch directly.
- Rationale: isolate high-signal mobile UX/remediation work so each blocker has explicit code + test evidence.

## Thread-to-fix mapping

| Review finding | File(s) | Fix implemented | Evidence |
|---|---|---|---|
| Sign-in routes directly to tabs (auth boundary bypass) | `apps/mobile/app/(auth)/sign-in.tsx`, `apps/mobile/app/(auth)/_layout.tsx`, `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/app/_layout.tsx`, `apps/mobile/lib/preview-session.tsx` | Added preview session provider, auth redirects, guarded sign-in/sign-out actions | Manual walkthrough: unauthenticated `/points` redirects to sign-in; valid sign-in enters tabs; sign-out returns to sign-in |
| Leaderboard chips are visual-only | `apps/mobile/app/(tabs)/points-details.tsx` | Added selected window state, active chip styling by state, and per-window table datasets | Manual walkthrough: All time/Semester/Month chips switch styles and table rows |
| Preferences hydration lacks parse-error recovery | `apps/mobile/app/(tabs)/preferences.tsx` | Added catch path for malformed storage JSON with fallback recovery + safe hydration completion | Lint/typecheck pass and manual screen validation with recovered-state messaging |
| Network banner treats unknown reachability as degraded | `apps/mobile/components/network-banner.tsx` | Degraded banner now only appears on explicit reachability failure (`false`), not unknown (`null`) | Manual walkthrough: no degraded flash on initial app load |
| Expo package mismatch (`expo-network`) | `apps/mobile/package.json`, `package-lock.json` | Pinned `expo-network` to SDK-compatible `~8.0.8` | Dependency manifest verification + mobile lint/typecheck pass |
| Dead-end controls in event details/chat thread | `apps/mobile/app/(tabs)/event-details.tsx`, `apps/mobile/app/(tabs)/chat-thread.tsx`, `apps/mobile/lib/calendar-export.ts` | Wired real handlers and user feedback for calendar export, retry upload, queue message | Manual walkthrough: action feedback and state changes confirmed |
| Web visual regression CI startup command failure | `apps/web/playwright.config.ts` | Updated webServer command to workspace-safe `npm run dev` | Visual suite passes; no `No workspaces found --workspace=apps/web` error |

## Related supporting changes

- Added interaction QA gate:
  - `docs/internal/MOBILE_INTERACTION_SMOKE_CHECKLIST.md`
  - `.github/pull_request_template.md` dead-end-control checkbox
- Added theme and icon system parity docs:
  - `docs/internal/ICON_INTENT_MAP.md`
  - `docs/internal/ICONOGRAPHY_GUIDELINES.md` cross-link

## Verification bundle (local)

- `npm run lint -w apps/mobile`
- `npm run check-types -w apps/mobile`
- `npm run lint -w apps/web`
- `npm run check-types -w apps/web`
- `npm run test:visual -w apps/web`
- `npm run lint`
- `npm run check-types`
- Manual GUI walkthrough artifacts (mobile + web theme/interaction checks)
