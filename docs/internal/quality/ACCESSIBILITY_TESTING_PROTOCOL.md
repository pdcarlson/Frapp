# Accessibility Testing Protocol (UI Release Gate)

> Last updated: 2026-03-08  
> Applies to: `apps/web`, `apps/landing`, `apps/mobile`

This protocol defines the minimum accessibility verification required before UI changes are considered releasable.

## 1) When this protocol is required

Run this protocol for any PR that changes:

- interactive components (buttons, links, inputs, menus, dialogs, sheets, tabs)
- screen structure/layout hierarchy
- color, typography, spacing, or focus styles
- async state surfaces (loading/empty/error/offline/success)
- navigation flows (sidebar/tab/deep-link transitions)

## 2) Success criteria (baseline)

A change passes only if all are true:

1. Focus is always visible and never trapped unintentionally.
2. Keyboard and screen-reader users can complete the primary flow.
3. Contrast requirements are met:
   - text contrast ≥ 4.5:1
   - non-text UI contrast ≥ 3:1
4. Icon-only controls expose a clear accessible label (e.g., `aria-label`) and a visual tooltip (e.g., `title`) for sighted users.
5. Async states are understandable without color-only signals.

## 3) Automated checks (required)

Run targeted workspace checks for impacted surfaces:

```bash
npm run lint -w apps/web
npm run check-types -w apps/web
npm run lint -w apps/landing
npm run check-types -w apps/landing
npm run lint -w apps/mobile
npm run check-types -w apps/mobile
```

Use only relevant commands for changed areas.

## 4) Manual verification checklist

## Web / Landing

- [ ] Tab/Shift+Tab traversal follows visual order.
- [ ] Focus ring remains visible on all interactive controls.
- [ ] Dialog/sheet focus trap works; closing returns focus to trigger.
- [ ] Dropdowns/menus can be fully operated without a mouse.
- [ ] Error and offline states include non-color explanatory copy.
- [ ] Core responsive breakpoints validated (desktop, tablet, narrow/mobile width).

## Mobile (Expo / React Native surfaces)

- [ ] Tap targets are comfortably usable (minimum 44x44 intent).
- [ ] State labels (pending/synced/retry/cached) are text-visible, not color-only.
- [ ] Critical actions are not positioned in conflict zones (safe area / tab bar overlap).
- [ ] Back navigation path is explicit on drill-down screens.
- [ ] Long content remains readable and scrollable without clipped controls.

## 5) Evidence requirements (PR review)

For each UI PR include:

- command outputs for lint/typecheck
- screenshots or short walkthrough evidence for:
  - default state
  - at least one async/error/offline state (if applicable)
  - keyboard/focus behavior for web where relevant

If a checklist item is not applicable, explicitly note why in the PR.

## 6) Sign-off

UI PRs are blocked until:

- all required checklist items are checked
- evidence is attached
- no unresolved accessibility regressions remain

Reference this protocol from `.github/pull_request_template.md` and `docs/internal/UI_UX_SYSTEM.md`.
