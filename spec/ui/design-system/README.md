> **TARGET STATE — partly shipped.** This document specifies the Signet design system the product is being built toward; the mobile app and the web dashboard shell implement it today, and the remaining web screen families land per the #920 slices. Sequencing is tracked in GitHub Issues — do not file spec-vs-implementation drift issues against it.

# Signet design system

> The rules shared by every Signet surface: direction, guardrails, component ownership, state completeness, entitlement gating, accessibility, motion, and the quality gate. Token values live in the sibling docs below; the committed HTML references are the visual truth.

**Scope.** The *process* standards — component ownership (§3), state completeness (§4), entitlement gating (§5), accessibility (§6), motion discipline (§7), the quality gate (§8), and the behavioral bans in §2 — bind **every** UI surface, including the frozen [`../landing/README.md`](../landing/README.md). The *visual* specification — §1, the visual bans in §2, and the token docs below — binds the **Signet surfaces**: mobile and the web dashboard ([`../web-dashboard/README.md`](../web-dashboard/README.md)). Landing is the one frozen carve-out — it keeps shipping its legacy design system, and [`foundations.md`](foundations.md) §1 owns that split.

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

Signet must not read as another generic Google/Material utility, and must not behave like one. These bans are research-derived and **binding**; the Binds column states where, per the scope statement above. A visual ban is not a defect on a frozen surface — `apps/landing` legitimately ships fixed-color borders and its light bone palette under the legacy tokens. `apps/web` is no longer that example: its shell is Signet, and residual violations on screens awaiting their per-family truing-up are tracked by the #920 slices, not filed as drift.

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
| Web primitives (Radix + Signet recipes) | `apps/web/components/ui/` | Dashboard foundational controls (Button, Card, Dialog, …) |
| Theme/tokens | `packages/theme` | Semantic tokens + motion/elevation defaults |
| Dashboard composites | `apps/web/components/*` | Workflow-specific and shadcn/radix compositions |
| Landing sections | `apps/landing/app/*` | Marketing-specific content modules (inline Tailwind; no shared component package) |
| Mobile composites | `apps/mobile/components/*` | React Native/Expo-specific UX patterns |

Rules:

1. If a component is workflow-specific, keep it app-local.
2. If a component is a reusable dashboard primitive, keep it in `apps/web/components/ui/`. Landing uses inline Tailwind; mobile uses React Native composites. Do not recreate a shared web-component workspace for that.
   - Those files keep Radix for behaviour — focus management, portals, keyboard semantics — but their **appearance is [components.md](components.md), not the shadcn scaffold's defaults**, since the #920 primitives slice. A variant the scaffold ships and Signet does not spec is not automatically kept: `Button`'s `outline` was deleted in that slice because Signet's Secondary already is the outlined button, and two live spellings of one recipe is what the cutover rule forbids.
   - A primitive with **no importers is deleted, not kept for later** (the tech-debt protocol in [`AGENTS.md`](../../../AGENTS.md)). Seven went with the primitives slice. "It ships with shadcn" is not a consumer, and neither is an `index` re-export.
3. Never duplicate token values in app-local files when semantic tokens exist.
4. If no existing token role fits, extend or amend the token definitions and adopt the new role consistently — never one-off the value at the call site. Signet surfaces extend the Signet token definitions — `packages/theme/src/signet.ts`, its stylesheet `packages/theme/src/signet.css`, and, for web, `apps/web/tailwind.config.ts`; the frozen landing surface extends the legacy `packages/theme/src/tokens.ts`. The per-tenant accent family is not in either file — it comes from the engine ([`accent-engine.md`](accent-engine.md)).

---

## 4. State completeness standard

Every async view MUST include all relevant states:

1. Loading — skeletons mirror the content they become; no spinner-in-a-box
2. Empty — with a next action
3. Error — with a retry path
4. Offline/degraded (if network-dependent) — see [`../resilience.md`](../resilience.md)
5. Success confirmation (for mutating actions)

Skeleton, empty, and error render as one visual family — the states panel (4f) in [`reference/signet-design-system.dc.html`](reference/signet-design-system.dc.html) is the model. Web dashboards use the shared state modules in `apps/web/components/shared/async-states.tsx` unless there is a strong reason to diverge.

**A disabled query is not a loading state.** TanStack Query v5 keeps `isPending` true for a query whose `enabled` flag is false — nothing is in flight, and nothing will be (`fetchStatus: "idle"`). Gate spinners on `isLoading` (`isPending && isFetching`) or `fetchStatus === "paused"` (offline, no cached data). Treat `isPending && fetchStatus === "idle"` as the entitlement/empty branch (permission denied, no chapter selected), not as a spinner. Do not use `isPending && !isFetching` for that branch — paused queries share those flags and are not disabled. `/polls` (`polls:view_all`) and `/backwork` (no chapter) are the reference surfaces.

**The same rule binds the gate, not just the data query.** `<Can>` (`apps/web/components/shared/can.tsx`) branched on `isPending` alone across all fifteen gated surfaces, so a member opening a gated route offline for the first time in a session held the gate's fallback forever — twelve of them on `null`, i.e. on nothing at all (#1211). The data queries on `/polls` and `/backwork` had been given the rule above; the permission query deciding whether those queries render at all had not. Three branches, and the middle one is new:

- **A cached answer is used, whatever the fetch is doing.** Permissions are stale-while-revalidate, as §10 requires of any background refetch. This needs no branch — `isPending` is false whenever `data` exists — but it is the half a later "simplification" to `fetchStatus === "paused"` alone silently breaks, so it is pinned in `apps/web/components/shared/can-fallback.test.tsx`.
- **Paused with nothing cached renders an offline state with a retry, never `null`.** An unanswerable check is a *recoverable* state, and §5 rule 4 reserves hiding for permissions the user will never hold. The chrome follows §10's container rule: a gate standing in for a screen or a card passes the card-shaped `OfflineState` (eight of the twenty-three sites); a gate standing in for a single control gets `PermissionsOffline` (eleven), which is `<Can>`'s non-null **default** — the twelve blank surfaces were reached by *omitting* the prop, so the default is where the fix has to live. Copy: [writing.md](writing.md) §7's "Permission check offline".

  **The one exception is a gate with no affordance behind it.** Three sites wrap nothing but a `SubscriptionNotice` — copy explaining why a *different* control is disabled. Rule 4 is about controls; supplementary prose has nothing to disable, and a second notice there says we cannot check an access the member was not being offered anyway, stacked beside the chip the real control already shows. Those three stay `null`, and the guard derives that from the child rather than listing it, so the rule runs both ways: a fourth notice gate cannot ship a chip, and a fourth affordance cannot ship silence.

  **The classification is the hard part, and it is where this change first got it wrong.** Three region-scale gates — the whole invoice surface, Settings' rollover card, Service's review queue — were bucketed as control slots and shipped the one-line chip in place of a card, which is §10's "not a smaller version of the right answer" in the other direction. Caught by review, not by a rule, which is why the eight are a written ledger in `apps/web/components/shared/can-fallback.test.tsx` rather than a heuristic.
- **Idle with nothing cached still fails closed.** This is the entitlement branch above, and it is why swapping `isPending` for `isLoading` is not the fix — it would render gated content to a viewer whose permissions were never fetched.

---

## 5. Entitlement gating standard (fail fast)

**A user must never be able to complete work the server will reject.** When the client already knows an action is unavailable, the entry point to that action must say so — before the user invests effort, not after they hit Submit.

The canonical failure, observed on the billing screen: the chapter's subscription was `incomplete`, so `POST /v1/invoices` was always going to return `403 chapter.subscription.required`. But the **Create invoice** button was live, the dialog opened, and the member, title, amount, and due date were all accepted. The rejection arrived as a toast only after Submit. Every keystroke was wasted, and the error read as a malfunction rather than as a known, explainable state.

### The rule

For each of the three gate classes the API enforces, the client must mirror the gate at the control that starts the flow:

| Gate | Enforced server-side by | Client must |
| --- | --- | --- |
| Permission | `@RequirePermissions` → `PermissionsGuard` (`apps/api/src/interface/guards/permissions.guard.ts`) | Hide or disable the control (`<Can>`, `apps/web/components/shared/can.tsx`) — but say so, not hide, while the check itself cannot be made (§4) |
| Subscription | `ChapterGuard.enforceSubscription` (`apps/api/src/interface/guards/chapter.guard.ts`) | Disable the control and name the reason (`useSubscriptionGate`, `apps/web/components/shared/subscription-gate.tsx`) |
| Module enabled | `ChapterGuard.enforceModule` | Hide the surface |

All three gate classes now have a client counterpart — `<Can>` for permissions, the sidebar / Cmd+K / slash-command filtering for modules (module semantics: [`../../product/modules.md`](../../product/modules.md)), and `useSubscriptionGate` for subscription state.

**Writes only.** `enforceSubscription` returns early for `GET`/`HEAD`/`OPTIONS`, so a lapsed chapter can still read everything it owns. Mirror the gate on write affordances; never gate a read surface on subscription state.

**The subscription mirror is a predicate, not a wrapper.** `subscriptionWriteState()` (`packages/validation/src/subscription.ts`, exported from `@repo/validation` next to `can` and `isModuleEnabled`) reproduces the guard branch-for-branch — all four structured codes (`chapter.subscription.required` / `write_locked` / `invite_blocked` / `canceled`), the 3-day `past_due` grace window, and the `@FreeTier` / `@GraceBlocked` carve-outs — and `useSubscriptionWriteState` feeds it the active chapter. It is shaped as a hook rather than a `<Can>`-style wrapper because §5 rule 4 requires *disabling* the control, which means the caller needs the reason, not just a boolean. Pass the `writeClass` matching the route's decorators; `paid` is the default and the safe one.

**Gate every write on the surface, not just the headline one.** A screen that disables its primary action while leaving sibling writes live is worse than one that gates nothing: it states that writes are blocked and then offers three. The invoice card gates its create trigger, its dialog submit, and its per-row status transitions off one predicate, because all four hit routes behind the same guard.

**Read subscription state from one place.** `useSubscriptionWriteState` and any status-driven card must share a single query. Two sources for the same fact let one half of a screen report `active` while the other still says locked.

**The mirror depends on two server fields, and its failure mode is silence.** `subscription_status` and `past_due_since` reach the client from `GET /v1/chapters/current`. That payload is an explicit server-side allowlist (`chapter-member-view.ts`, #930) rather than the raw row, so those two are there on purpose and are pinned by test at both the projection and the service layer. If you are narrowing that payload, do not "clean up" either one: `isWithinSubscriptionGrace(null)` **fails open**, so dropping them throws nothing and breaks no type — every client just renders grace-window affordances indefinitely while the server hard-locks the same writes.

Unlike `<Can>`, the subscription mirror **fails open when the chapter cannot be established** — the fetch failed, no chapter is active, or the status is one this client does not model. An unresolved permission may be one the user never holds, so hiding is right; an unresolved subscription most likely belongs to a paying chapter, and locking its paid surface over a failed fetch is worse than the late 403 the gate exists to avoid.

The **in-flight** window is the one exception, and it goes the other way: while the chapter query is still resolving, `useSubscriptionGate` holds the control disabled and says so ("Checking this chapter's subscription…"). That window is the most common path to the very 403 this gate prevents — a trigger that paints enabled for one round trip still lets a fast click reach a doomed form. Do not collapse the two: `allowed` folds in `isPending`, `state.allowed` does not.

**Use the shared primitive, not the raw hook.** `useSubscriptionGate` / `useGatedDialog` / `SubscriptionNotice` (`apps/web/components/shared/subscription-gate.tsx`) package the five things a correct gated control needs: the pending fold-in, the mid-flight revoke, the refusal to open, the `aria-describedby` wiring, and the notice. `useSubscriptionWriteState` remains the predicate underneath, for callers that need the verdict without a control. Pass your own busy flags to `controlProps(alsoDisabled)` rather than OR-ing them in afterwards — spreading the props and then writing your own `disabled` silently drops the gate.

Every paid-ops write **affordance** in `apps/web` is mirrored. Any new subscription-gated flow adopts the primitive rather than re-solving this per screen.

Two gaps are known and tracked, not overlooked:

- **The chat slash commands.** `/event`, `/task` and `/points` dispatch straight to `POST /v1/events`, `/v1/tasks` and `/v1/points/adjust` from `packages/chat-core/src/dispatch.ts`. The palette filters on module state only, and a *typed* command bypasses the palette entirely — so the gate has to sit on the dispatcher, not on a control, which is a different shape from everything above.
- **Residual `chapter.subscription.*` errors.** Nothing yet reads the guard's structured codes off a rejected response to render the remedy alongside the message. That is the backstop for exactly the paths a client-side mirror cannot cover, the typed slash command among them.

**`@FreeTier` is not "always allowed".** Free-tier writes still lock past the `past_due` grace window, and `canceled` is checked above the carve-out entirely. Only the invite surface mirrors this today; the other free-tier surfaces (members, roles, custom fields, chat, search) fail late on a canceled or long-lapsed chapter.

#### The gated surface (enumerated)

A controller is subscription-gated only if `ChapterGuard` is in its guard chain **and** it carries no `@FreeTier` / `@SubscriptionExempt`. Client and server can be diffed by grepping one string — the guard's structured codes.

**A controller maps to as many surfaces as reach it — never assume one.** Two of the misses this inventory was written to prevent were exactly that shape: the chat task card and the chat event card call paid-ops routes from a surface whose *own* controller (`chat`) is `@FreeTier`, and the event editor's triggers live in two files that are not the editor. The route decides the gate, not the screen hosting it.

| Paid-ops controller | Writes | Web surfaces (all of them) |
| --- | --- | --- |
| `attendance` | 3 | `components/events/attendance-panel.tsx` · `components/chat/renderers/event-card.tsx` (check-in) |
| `backwork` | 4 | `components/backwork/backwork-page.tsx` |
| `chapter-document` | 6 | `components/documents/documents-page.tsx` |
| `event` | 3 | `components/events/events-page.tsx` (both create triggers) · `components/events/event-editor-dialog.tsx` · `components/events/event-detail-sheet.tsx` (edit + delete) |
| `financial-invoice` | 3 (+1 exempt) | `components/billing/invoice-admin-card.tsx` |
| `points` | 1 | `app/(dashboard)/points/page.tsx` (trigger) · `components/points/points-adjustment-dialog.tsx` |
| `poll` | 3 | `components/polls/polls-page.tsx` |
| `report` | 4 | `components/reports/reports-page.tsx` |
| `semester-rollover` | 1 | `components/settings/settings-page.tsx` (rollover only) |
| `service-entry` | 4 | `components/service/service-page.tsx` |
| `study` → `StudyGeofenceController` | 3 | `components/geofences/geofences-admin-page.tsx` |
| `study` → `StudySessionController` | 5 | `components/study/study-page.tsx` |
| `task` | 5 | `components/tasks/tasks-board.tsx` · `components/chat/renderers/task-card.tsx` |

Where a dialog's `open` state lives in a parent, the **parent** carries the gate — rule 1 is about the control that starts the flow, and a dialog cannot refuse to open on its own behalf. `useGatedDialog` returns `contentProps` as well as `dialogProps`; a parent that owns `open` but not the `DialogContent` has to forward `onCloseAutoFocus` through, or the revoke path drops focus to `<body>`.

**12 files / 13 controller classes / 45 gated writes** (46 non-GET routes, less the one `@SubscriptionExempt` payment-intent). `study.controller.ts` holds two controller classes behind different modules. `alumni` carries the guard but has no non-GET route, so it contributes no write surface.

Three of `chapter-document`'s six writes — folder create, rename and delete — have no client counterpart yet: the documents page derives its folder list from the loaded documents and its folder buttons are pure filters. A folder-management UI must adopt the gate when it lands.

**Free-tier** (writes survive `incomplete`, and `past_due` inside grace): `chapter` · `chapter-config` · `chat` · `custom-field` · `custom-role` · `invite` · `member` · `rbac` · `search` · `user`. The three `@GraceBlocked` routes are `POST /invites`, `POST /invites/batch` and `POST /invites/email`.

**Exempt:** `billing` (whole class — the recovery path) and `POST /invoices/:id/payment-intent`.

**Not chapter-guarded at all**, so never subscription-gated despite carrying writes: `analytics`, `notification`, `webhook`, and `POST /chapters`, `POST /chapters/onboard`, `POST /chapters/:id/activate`, `POST /invites/redeem`. (`chapter-directory` is also un-guarded but has no non-GET route, so it contributes no write surface.) Gating these would lock a lapsed chapter out of settings and push registration it is entitled to — over-gating is a worse defect than the late 403. `redeem` is the subtle one: it sits on an otherwise-guarded controller, and the chapter it writes to is `invite.chapter_id`, which `ChapterGuard` never sees — guarding it would gate the redeemer's _current_ chapter and 400 a user who has none.

### What "fail fast" means concretely

1. **Gate the trigger, not the submit.** Disable the button that opens the form. Never let a dialog open onto an action that cannot succeed.
2. **Say why, and say what fixes it.** A disabled control with no explanation is its own dead end. Pair it with the reason and the recovery path — the API's own message is a good source: "Chapter subscription is not active; complete checkout to use this feature." Per [`writing.md`](writing.md), name the blocker and the next action.
3. **Keep the recovery path reachable.** Whatever clears the block must stay enabled — this is why `BillingController` is `@SubscriptionExempt()` (`apps/api/src/interface/controllers/billing.controller.ts`). Never gate a user out of the screen that ungates them.
4. **Disable, don't hide, for recoverable states.** A subscription lapse is temporary and the user can fix it; hiding the feature makes the product look broken or missing. Hide only for permissions the user will never hold and modules the chapter has switched off. **An unresolved permission is not a held one.** Hiding is the right answer to a *denial*; a check that could not run — the offline pause §4 describes — is as recoverable as a lapsed subscription, and gets the same treatment: state it, and offer the recovery.
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
- Dialogs move focus to the first input on open (the primary control when there is no input), trap focus while open, and return focus to the trigger on close — Radix only does the last part automatically for a dialog opened via `<DialogTrigger>`. A dialog opened from controlled `open` state with no `DialogTrigger` (the chat slash palette, opened by typing `/`) gets no free trigger-return: `DialogContent`'s `onCloseAutoFocus` calls `context.triggerRef.current?.focus()`, and that ref is only ever populated by `<DialogTrigger>` mounting (`#396`). Such a dialog needs its own explicit refocus on close.
- A hidden "Skip to main content" link that becomes visible on focus and jumps to the page's main landmark — a route whose main landmark hides real content behind its own sub-navigation (chat's channel rail before the timeline) should carry a second, route-scoped skip link to the content past that sub-navigation (`#396`)
- Dialogs are announced as modal (`aria-modal="true"`) — Radix's `DialogContent` does not set this itself (verified against `@radix-ui/react-dialog@1.1.23`; only `role="dialog"` comes for free even in its default modal variant), so `apps/web/components/ui/dialog.tsx` sets it explicitly on every consumer (`#396`)

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

1. Visual consistency with the token system the surface actually ships — [`foundations.md`](foundations.md) and [`accent-engine.md`](accent-engine.md) on Signet surfaces, the legacy `@repo/theme` tokens on the frozen landing surface
2. Spacing consistency on the 4px grid
3. Clear visual hierarchy — each screen has exactly one obvious typographic anchor, so hierarchy is checked per screen and not only per component
4. Complete state handling (§4)
5. Entitlement gating mirrored at the entry control (§5) — no flow a user can complete but the server will reject
6. Accessibility baseline checks (§6)
7. Responsive/adaptive behavior checks
8. Copy clarity per [`writing.md`](writing.md) — no placeholder language
9. De-Google guardrails respected per their Binds column (§2) — behavioral bans on every surface, visual bans on Signet surfaces

Icon standards: [`iconography.md`](iconography.md). Typography roles: [`foundations.md`](foundations.md). Logos, favicons, Open Graph, and asset sync: [`../assets.md`](../assets.md).
