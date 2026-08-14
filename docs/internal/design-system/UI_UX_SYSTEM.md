# Frapp UI/UX System Contract

> Last updated: 2026-03-08  
> Scope: landing (`apps/landing`), dashboard (`apps/web`), mobile (`apps/mobile`)

This document is the implementation bridge between the product/UI specs and active UI code.

## 1) Experience Direction

Frapp’s UI direction is **Modern Ivy, Operationally Sharp**:

- Premium trust cues on public-facing surfaces
- Dense-but-clear controls in admin workflows
- Fast, motivating loops on member mobile surfaces

## 2) Color Role Map (Authoritative)

The color role map below resolves prior ambiguity across spec docs:

- **Brand anchor:** Navy (`#0F172A`)
- **Primary action:** Royal Blue (`#2563EB`)
- **Success/reward:** Emerald (`#10B981`)
- **Warning/error:** semantic amber/red tokens

Never treat emerald as global primary action color.

## 3) Component Ownership Matrix

| Layer                | Location                   | Ownership                                       |
| -------------------- | -------------------------- | ----------------------------------------------- |
| Shared primitives    | `packages/ui`              | Cross-app foundational controls only            |
| Theme/tokens         | `packages/theme`           | Semantic tokens + animation/elevation defaults  |
| Dashboard composites | `apps/web/components/*`    | Workflow-specific and shadcn/radix compositions |
| Landing sections     | `apps/landing/app/*`       | Marketing-specific content modules              |
| Mobile composites    | `apps/mobile/components/*` | React Native/Expo-specific UX patterns          |

Rules:

1. If a component is workflow-specific, keep it app-local.
2. If a component is style-agnostic + reusable across web/landing/docs, promote to `packages/ui`.
3. Never duplicate token values in app-local files when semantic tokens exist.

## 4) State Completeness Standard

Every async view must include all relevant states:

1. Loading
2. Empty
3. Error
4. Offline/degraded (if network-dependent)
5. Success confirmation (for mutating actions)

For web dashboards, use shared state modules in `apps/web/components/shared/async-states.tsx` unless there is a strong reason to diverge.

## 5) Entitlement Gating Standard (Fail Fast)

**A user must never be able to complete work the server will reject.** When the client already
knows an action is unavailable, the entry point to that action must say so — before the user
invests effort, not after they hit Submit.

The failing pattern, observed on the billing screen: the chapter's subscription was `incomplete`,
so `POST /v1/invoices` was always going to return
`403 chapter.subscription.required`. But the **Create invoice** button was live, the dialog opened,
and the member, title, amount, and due date were all accepted. The rejection arrived as a toast only
after Submit. Every keystroke was wasted, and the error read as a malfunction rather than as a
known, explainable state.

### The rule

For each of the three gate classes the API enforces, the client must mirror the gate at the
control that starts the flow:

| Gate | Enforced server-side by | Client must |
| --- | --- | --- |
| Permission | `@RequirePermissions` → `PermissionsGuard` | Hide or disable the control (`<Can>`) |
| Subscription | `ChapterGuard.enforceSubscription` | Disable the control and name the reason |
| Module enabled | `ChapterGuard`'s module gate | Hide the surface |

Permission and module gating already have client counterparts — `<Can>` for permissions, and the
sidebar / Cmd+K / slash-command filtering for modules. **Subscription state is the gap:** it is
enforced only on the server, so every subscription-gated action currently fails late by default.
Any new subscription-gated flow must close that gap itself.

### What "fail fast" means concretely

1. **Gate the trigger, not the submit.** Disable the button that opens the form. Never let a
   dialog open onto an action that cannot succeed.
2. **Say why, and say what fixes it.** A disabled control with no explanation is its own dead end.
   Pair it with the reason and the recovery path — the API's own message is a good source:
   "Chapter subscription is not active; complete checkout to use this feature." Per
   `UX_WRITING_GUIDE.md`, name the blocker and the next action.
3. **Keep the recovery path reachable.** Whatever clears the block must stay enabled — this is why
   `BillingController` is `@SubscriptionExempt()`. Never gate a user out of the screen that
   ungates them.
4. **Disable, don't hide, for recoverable states.** A subscription lapse is temporary and the user
   can fix it; hiding the feature makes the product look broken or missing. Hide only for
   permissions the user will never hold and modules the chapter has switched off.
5. **The server gate stays regardless.** Client-side gating is a UX affordance, never a security
   boundary — a direct API call bypasses all of it. Mirroring a gate never means removing it.

### Reviewer check

If a route carries a subscription, permission, or module gate, open the UI that calls it and
confirm the entry control reflects that gate. A server gate with no client counterpart is an
incomplete feature, not a backend detail.

## 6) Accessibility Baseline (Release Gate)

Minimum release requirements:

- Visible focus indicator on all keyboard-focusable controls
- Focus order follows visual order
- Semantic labels for icon-only buttons
- 4.5:1 text contrast minimum
- 3:1 non-text UI contrast minimum
- Dialogs trap focus and return focus to trigger on close

Execution protocol and evidence requirements are documented in:

- `docs/internal/quality/ACCESSIBILITY_TESTING_PROTOCOL.md`

## 7) Motion and Feedback

Adopt these timing ranges:

- Micro-feedback: 100–180ms
- Standard transitions: 180–260ms
- Context shifts: 240–320ms

Motion must remain subtle, functional, and compatible with reduced-motion preferences.

Motion token source:

- `packages/theme/src/tokens.ts` (`motion.duration`, `motion.easing`)

## 8) Chapter Accent Safety Rules

Chapter-provided accent colors must pass minimum contrast thresholds before use:

- Accent on white text: **4.5:1 minimum**
- Invalid hex values are rejected
- Failing colors are automatically replaced with the fallback accent (`royalBlue`)

Implementation reference:

- `packages/theme/src/accent.ts` (`resolveChapterAccentColor`)

## 9) Quality Gate Checklist

A UI change is not ready unless it passes:

1. Visual consistency with token system
2. Spacing consistency on the 4pt scale
3. Clear visual hierarchy
4. Complete state handling
5. Entitlement gating mirrored at the entry control (§5) — no flow a user can complete but the
   server will reject
6. Accessibility baseline checks
7. Responsive/adaptive behavior checks
8. Trust/copy clarity (no placeholder language)

Icon sizing and usage standards are documented in:

- `docs/internal/design-system/ICONOGRAPHY_GUIDELINES.md`

Typography roles and usage standards are documented in:

- `docs/internal/design-system/TYPOGRAPHY_GUIDELINES.md`

Frapp logos, favicons, Open Graph, and asset sync are documented in:

- `spec/ui/assets.md`
- `docs/internal/design-system/BRAND_ASSETS.md`
