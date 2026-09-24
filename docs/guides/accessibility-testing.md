# Accessibility testing protocol (UI release gate)

> Applies to: `apps/web`, `apps/landing`, `apps/mobile`

This protocol defines the minimum accessibility verification required before UI changes are considered releasable. The baseline it verifies is owned by the spec (§ 2 below names where).

## 1) When this protocol is required

Run this protocol for any PR that changes:

- interactive components (buttons, links, inputs, menus, dialogs, sheets, tabs)
- screen structure/layout hierarchy
- color, typography, spacing, or focus styles
- async state surfaces (loading/empty/error/offline/success)
- navigation flows (sidebar/tab/deep-link transitions)

## 2) Success criteria (baseline)

The requirements live in the spec, and this list doesn't restate them. A change passes only if every one that applies to the surfaces it touches holds:

- [`spec/ui/design-system/README.md` § 6](../../spec/ui/design-system/README.md#6-accessibility-baseline-release-gate), the release gate: focus, labels, contrast, dialogs, skip links.
- [§ 4 of the same file](../../spec/ui/design-system/README.md#4-state-completeness-standard): every async state is present.
- [`iconography.md` § 4](../../spec/ui/design-system/iconography.md#4-accessibility), and [§ 3](../../spec/ui/design-system/iconography.md#3-color-usage)'s rule that status is never encoded in color alone.

On top of those, this protocol checks that keyboard and screen-reader users can complete the primary flow.

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
- [ ] Dialogs and sheets meet every § 6 dialog rule (focus on open, trap, return on close, `aria-modal`), and the skip link reaches the main landmark.
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

A UI PR isn't ready to merge until:

- all required checklist items are checked
- evidence is attached
- no unresolved accessibility regressions remain

No CI check enforces this. The gate is the accessibility checkbox in
[`.github/pull_request_template.md`](../../.github/pull_request_template.md), which names this file, and review.
