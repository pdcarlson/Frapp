> **PLANNED (target state).** This document specifies the Signet design system the product is being built toward; much of it has no implementation yet. Sequencing is tracked in GitHub Issues — do not file spec-vs-implementation drift issues against it.

# Signet design system

> The rules shared by every Signet surface: direction, guardrails, component ownership, state completeness, entitlement gating, accessibility, motion, and the quality gate. Token values live in the sibling docs below; the committed HTML references are the visual truth.

**Scope.** The *process* standards — component ownership (§3), state completeness (§4), entitlement gating (§5), accessibility (§6), motion discipline (§7), the quality gate (§8), and the behavioral bans in §2 — bind **every** UI surface, including the frozen [`../web-dashboard/README.md`](../web-dashboard/README.md) and [`../landing/README.md`](../landing/README.md). The *visual* specification — §1, the visual bans in §2, and the token docs below — is scoped to **Signet surfaces only**; the frozen surfaces keep shipping their legacy design system, and [`foundations.md`](foundations.md) §1 owns that split.

---

## 1. Direction

Signet (the rebrand of Frapp — see [`../brand-identity.md`](../brand-identity.md)) is **dark-first, warm, and consumer**. The lane is Notion dark / Cash App — a product members *want* to open — not the Linear/Vercel technical-tool aesthetic.

Principles:

1. **Warm dark, not black.** The base is a warm charcoal ladder, lifted off the pure-black floor. Values: [`foundations.md`](foundations.md).
2. **Elevation is a lighter surface.** Depth comes from stepping up the surface ladder and low-opacity white hairlines — never drop shadows.
3. **One accent engine.** Chapters personalize through a generated 12-step scale seeded from one hex; house gold is Signet's own accent and the default seed. The raw seed never paints UI. Mechanics: [`accent-engine.md`](accent-engine.md).
4. **Consumer ergonomics.** Body text never below 16px, touch targets ≥ 44px, friendly plain-language copy ([`writing.md`](writing.md)).
5. **Chat is home.** The mobile app opens into chat; the global "Ask" entry is the signature AI affordance.
6. **Every surface ships its states.** Skeleton, empty, and error are designed variants, not afterthoughts (§4).

Visual truth and precedence (references beat docs, Canvas beats the system panels) are defined in [`../README.md`](../README.md).

### The family

| Doc | Owns |
| --- | --- |
| [`foundations.md`](foundations.md) | Neutral ladder, semantic colors, type scale, radius map, spacing grid |
| [`components.md`](components.md) | Buttons, inputs, cards, badges, sheets, tabs, and their variants |
| [`iconography.md`](iconography.md) | Duotone icon recipe, sizing, usage |
| [`writing.md`](writing.md) | UX writing: microcopy, errors, empty states, tone |
| [`accent-engine.md`](accent-engine.md) | Chapter accent pipeline: seed → Radix scale → roles, caching |
| [`reference/signet-design-system.dc.html`](reference/signet-design-system.dc.html) | System panels: foundations, accent stress tests, components, states |
| [`reference/canvas-screens.dc.html`](reference/canvas-screens.dc.html) | The 23 locked mobile screens |

---

## 2. De-Google guardrails

Signet must not read as another generic Google/Material utility, and must not behave like one. These bans are research-derived and **binding**; the Binds column states where, per the scope statement above. A visual ban is not a defect on a frozen surface — `apps/web` legitimately ships `shadow-*` utilities and fixed-HSL borders under its legacy tokens.

| Ban | Instead | Binds |
| --- | --- | --- |
| Fixed-hex border colors | Low-opacity white hairlines only (token values in [`foundations.md`](foundations.md)) | Signet surfaces |
| Drop shadows | Elevation via a lighter surface step | Signet surfaces |
| Raw chapter hex painting UI | Only generated scale steps paint ([`accent-engine.md`](accent-engine.md)) | Signet surfaces |
| `window.confirm` (and other browser-chrome dialogs) | In-product confirmation dialogs ([`components.md`](components.md)) | Every surface |
| Light-on-dark QR codes | QR codes are always dark-on-white, even inside the dark UI | Every surface |
| Background location | Never. Location is foreground-only | Every surface |
| NativeWind classes on sheet chrome | See mobile sheet pattern in [`../mobile/patterns.md`](../mobile/patterns.md) | Mobile |

---

## 3. Component ownership

| Layer | Location | Ownership |
| --- | --- | --- |
| Shared primitives | `packages/ui` | Cross-app foundational controls only |
| Theme/tokens | `packages/theme` | Semantic tokens + motion/elevation defaults |
| Dashboard composites | `apps/web/components/*` | Workflow-specific and shadcn/radix compositions |
| Landing sections | `apps/landing/app/*` | Marketing-specific content modules |
| Mobile composites | `apps/mobile/components/*` | React Native/Expo-specific UX patterns |

Rules:

1. If a component is workflow-specific, keep it app-local.
2. If a component is style-agnostic and reusable across web/landing, promote it to `packages/ui`.
3. Never duplicate token values in app-local files when semantic tokens exist.
4. If no existing token role fits, extend or amend the token definitions (`packages/theme/src/tokens.ts`) and adopt the new role consistently — never one-off the value at the call site.

---

## 4. State completeness standard

Every async view MUST include all relevant states:

1. Loading — skeletons mirror the content they become; no spinner-in-a-box
2. Empty — with a next action
3. Error — with a retry path
4. Offline/degraded (if network-dependent) — see [`../resilience.md`](../resilience.md)
5. Success confirmation (for mutating actions)

Skeleton, empty, and error render as one visual family — the states panel (4f) in [`reference/signet-design-system.dc.html`](reference/signet-design-system.dc.html) is the model. Web dashboards use the shared state modules in `apps/web/components/shared/async-states.tsx` unless there is a strong reason to diverge.

---

## 5. Entitlement gating standard (fail fast)

**A user must never be able to complete work the server will reject.** When the client already knows an action is unavailable, the entry point to that action must say so — before the user invests effort, not after they hit Submit.

The canonical failure, observed on the billing screen: the chapter's subscription was `incomplete`, so `POST /v1/invoices` was always going to return `403 chapter.subscription.required`. But the **Create invoice** button was live, the dialog opened, and the member, title, amount, and due date were all accepted. The rejection arrived as a toast only after Submit. Every keystroke was wasted, and the error read as a malfunction rather than as a known, explainable state.

### The rule

For each of the three gate classes the API enforces, the client must mirror the gate at the control that starts the flow:

| Gate | Enforced server-side by | Client must |
| --- | --- | --- |
| Permission | `@RequirePermissions` → `PermissionsGuard` (`apps/api/src/interface/guards/permissions.guard.ts`) | Hide or disable the control (`<Can>`, `apps/web/components/shared/can.tsx`) |
| Subscription | `ChapterGuard.enforceSubscription` (`apps/api/src/interface/guards/chapter.guard.ts`) | Disable the control and name the reason (`useSubscriptionGate`, `apps/web/components/shared/subscription-gate.tsx`) |
| Module enabled | `ChapterGuard.enforceModule` | Hide the surface |

All three gate classes now have a client counterpart — `<Can>` for permissions, the sidebar / Cmd+K / slash-command filtering for modules (module semantics: [`../../product/modules.md`](../../product/modules.md)), and `useSubscriptionWriteState` for subscription state.

**Writes only.** `enforceSubscription` returns early for `GET`/`HEAD`/`OPTIONS`, so a lapsed chapter can still read everything it owns. Mirror the gate on write affordances; never gate a read surface on subscription state.

**The subscription mirror is a predicate, not a wrapper.** `subscriptionWriteState()` (`apps/web/lib/subscription.ts`) reproduces the guard branch-for-branch — all four structured codes (`chapter.subscription.required` / `write_locked` / `invite_blocked` / `canceled`), the 3-day `past_due` grace window, and the `@FreeTier` / `@GraceBlocked` carve-outs — and `useSubscriptionWriteState` feeds it the active chapter. It is shaped as a hook rather than a `<Can>`-style wrapper because §5 rule 4 requires *disabling* the control, which means the caller needs the reason, not just a boolean. Pass the `writeClass` matching the route's decorators; `paid` is the default and the safe one.

**Gate every write on the surface, not just the headline one.** A screen that disables its primary action while leaving sibling writes live is worse than one that gates nothing: it states that writes are blocked and then offers three. The invoice card gates its create trigger, its dialog submit, and its per-row status transitions off one predicate, because all four hit routes behind the same guard.

**Read subscription state from one place.** `useSubscriptionWriteState` and any status-driven card must share a single query. Two sources for the same fact let one half of a screen report `active` while the other still says locked.

Unlike `<Can>`, the subscription mirror **fails open** while the chapter is loading or its fetch failed: an unresolved permission may be one the user never holds, but an unresolved subscription most likely belongs to a paying chapter, and disabling its paid surface over a slow fetch is worse than the late 403 the gate exists to avoid.

**Use the shared primitive, not the raw hook.** `useSubscriptionGate` / `useGatedDialog` / `SubscriptionNotice` (`apps/web/components/shared/subscription-gate.tsx`) package the five things a correct gated control needs: the pending fold-in, the mid-flight revoke, the refusal to open, the `aria-describedby` wiring, and the notice. `useSubscriptionWriteState` remains the predicate underneath, for callers that need the verdict without a control. Pass your own busy flags to `controlProps(alsoDisabled)` rather than OR-ing them in afterwards — spreading the props and then writing your own `disabled` silently drops the gate.

Rollout is complete across `apps/web`. Any new subscription-gated flow adopts the primitive rather than re-solving this per screen.

#### The gated surface (enumerated)

A controller is subscription-gated only if `ChapterGuard` is in its guard chain **and** it carries no `@FreeTier` / `@SubscriptionExempt`. Client and server can be diffed by grepping one string — the guard's structured codes.

| Paid-ops controller | Writes | Web surface |
| --- | --- | --- |
| `attendance` | 3 | `components/events/attendance-panel.tsx` |
| `backwork` | 4 | `components/backwork/backwork-page.tsx` |
| `chapter-document` | 6 | `components/documents/documents-page.tsx` |
| `event` | 3 | `components/events/event-editor-dialog.tsx` |
| `financial-invoice` | 3 (+1 exempt) | `components/billing/invoice-admin-card.tsx` |
| `points` | 1 | `components/points-adjustment-dialog.tsx` |
| `poll` | 3 | `components/polls/polls-page.tsx` |
| `report` | 4 | `components/reports/reports-page.tsx` |
| `semester-rollover` | 1 | `components/settings/settings-page.tsx` (rollover only) |
| `service-entry` | 4 | `components/service/service-page.tsx` |
| `study` → `StudyGeofenceController` | 3 | `components/geofences/geofences-admin-page.tsx` |
| `study` → `StudySessionController` | 5 | `components/study/study-page.tsx` |
| `task` | 5 | `components/tasks/tasks-board.tsx` |

**12 files / 13 controller classes / 41 writes.** `study.controller.ts` holds two controller classes behind different modules. `alumni` carries the guard but has no non-GET route, so it contributes no write surface.

**Free-tier** (writes survive `incomplete`, and `past_due` inside grace): `chapter` · `chapter-config` · `chat` · `custom-field` · `custom-role` · `invite` · `member` · `rbac` · `search` · `user`. The two `@GraceBlocked` routes are `POST /invites` and `POST /invites/batch`.

**Exempt:** `billing` (whole class — the recovery path) and `POST /invoices/:id/payment-intent`.

**Not chapter-guarded at all**, so never subscription-gated despite carrying writes: `analytics`, `notification`, `chapter-directory`, `webhook`, and `POST /chapters`, `POST /chapters/onboard`, `POST /chapters/:id/activate`. Gating these would lock a lapsed chapter out of settings and push registration it is entitled to — over-gating is a worse defect than the late 403.

### What "fail fast" means concretely

1. **Gate the trigger, not the submit.** Disable the button that opens the form. Never let a dialog open onto an action that cannot succeed.
2. **Say why, and say what fixes it.** A disabled control with no explanation is its own dead end. Pair it with the reason and the recovery path — the API's own message is a good source: "Chapter subscription is not active; complete checkout to use this feature." Per [`writing.md`](writing.md), name the blocker and the next action.
3. **Keep the recovery path reachable.** Whatever clears the block must stay enabled — this is why `BillingController` is `@SubscriptionExempt()` (`apps/api/src/interface/controllers/billing.controller.ts`). Never gate a user out of the screen that ungates them.
4. **Disable, don't hide, for recoverable states.** A subscription lapse is temporary and the user can fix it; hiding the feature makes the product look broken or missing. Hide only for permissions the user will never hold and modules the chapter has switched off.
5. **The server gate stays regardless.** Client-side gating is a UX affordance, never a security boundary — a direct API call bypasses all of it. Mirroring a gate never means removing it.

### Reviewer check

If a route carries a subscription, permission, or module gate, open the UI that calls it and confirm the entry control reflects that gate. A server gate with no client counterpart is an incomplete feature, not a backend detail.

---

## 6. Accessibility baseline (release gate)

Minimum release requirements:

- Visible focus indicator on all keyboard-focusable controls
- Focus order follows visual order
- Semantic labels for icon-only buttons
- 4.5:1 text contrast minimum
- 3:1 non-text UI contrast minimum
- Dialogs move focus to the first input on open (the primary control when there is no input), trap focus while open, and return focus to the trigger on close
- A hidden "Skip to main content" link that becomes visible on focus and jumps to the page's main landmark

Execution protocol and evidence requirements: [`../../../docs/internal/quality/ACCESSIBILITY_TESTING_PROTOCOL.md`](../../../docs/internal/quality/ACCESSIBILITY_TESTING_PROTOCOL.md).

---

## 7. Motion and feedback

**The duration values below are provisional, not Signet canon** — they are the legacy `@repo/theme` durations carried forward until a Signet motion spec lands. [`foundations.md`](foundations.md) §11 owns that status; build against the token names, not the numbers.

| Class | Range | Token value |
| --- | --- | --- |
| Micro-feedback | 100–180ms | `motion.duration.micro` = 140 |
| Standard transitions | 180–260ms | `motion.duration.standard` = 220 |
| Context shifts | 240–320ms | `motion.duration.context` = 300 |

Motion MUST remain subtle, functional, and compatible with reduced-motion preferences.

### Motion budget

Discipline, not palette — these rules bind **every** surface, and they govern the `fade-up` / `count-up` / `slide-down` animation utilities shipped by `packages/theme/src/tailwind.config.ts`.

| Zone | Rule |
| --- | --- |
| First paint (hero) | No entrance animation on LCP-critical text or the primary CTA. Prefer static layout. |
| Below the fold | Optional `fade-up` / stagger, once only — `motion-safe`, respecting `prefers-reduced-motion` |
| Hover | Color and border transitions only. Avoid scale transforms on primary chrome (buttons, nav) unless a component spec calls for one explicitly |
| Duration | Prefer the standard duration for UI chrome; the context duration is the ceiling for section entrances |

Token source: `packages/theme/src/tokens.ts` (`motion.duration`, `motion.easing`).

---

## 8. Quality gate checklist

A UI change is not ready unless it passes:

1. Visual consistency with the token system the surface actually ships — [`foundations.md`](foundations.md) and [`accent-engine.md`](accent-engine.md) on Signet surfaces, the legacy `@repo/theme` tokens on the frozen ones
2. Spacing consistency on the 4px grid
3. Clear visual hierarchy — each screen has exactly one obvious typographic anchor, so hierarchy is checked per screen and not only per component
4. Complete state handling (§4)
5. Entitlement gating mirrored at the entry control (§5) — no flow a user can complete but the server will reject
6. Accessibility baseline checks (§6)
7. Responsive/adaptive behavior checks
8. Copy clarity per [`writing.md`](writing.md) — no placeholder language
9. De-Google guardrails respected per their Binds column (§2) — behavioral bans on every surface, visual bans on Signet surfaces

Icon standards: [`iconography.md`](iconography.md). Typography roles: [`foundations.md`](foundations.md). Logos, favicons, Open Graph, and asset sync: [`../assets.md`](../assets.md).
