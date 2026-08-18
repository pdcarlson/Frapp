> **TARGET SPEC (partially built).** Every route below now exists in `apps/mobile`, but most screens are stubs and several have no entry point yet — see the Status column, and note that `ask` (opened from the ✦ pill), `check-in` (from an event), `host-check-in` (role-gated), `join` and `welcome` are registered without an inbound link, pending the slices that own them. Implementation is tracked in GitHub Issues — do not file spec-vs-implementation drift issues against these documents ([`README.md`](README.md)).

# Mobile Screen Inventory (s01–s23)

> The 23 locked Canvas screens mapped to expo-router paths, plus the pre-Signet screens they replace. The mapping is total: every current file under `apps/mobile/app` is accounted for.

Visual truth: [`../design-system/reference/canvas-screens.dc.html`](../design-system/reference/canvas-screens.dc.html). Screen ids (`s01`…`s23`) and Canvas labels below match that file's `data-screen-label` attributes exactly.

## Route conventions

- Routes live under `apps/mobile/app`. `(tabs)/` holds everything a member does inside a chapter. `(auth)/` holds everything before that point — which is **not** the same as "signed out": `chapter-picker` and s02/s03 are reached while authenticated. The group's gate keys on chapter context, not on session alone, so a member with no resolved chapter stays here (`apps/mobile/lib/auth-gate.ts` holds the single decision both layouts read).
- Routes not in the 4-tab bar are hidden (`href: null` in the tab layout) and reached by navigation only.
- **Filename contract:** `event-details.tsx` MUST never be renamed. `frapp://event-details` is baked into every exported `.ics` file (`deepLinkUrl` in `apps/mobile/app/(tabs)/event-details.tsx`); renaming the route breaks calendar entries already sitting on members' devices.
- All other renames land together in a single PR so typed routes never half-break — see [`navigation.md`](navigation.md).
- Bottom-sheet screens (marked *sheet* below) are `@gorhom/bottom-sheet` components hosted by a parent screen, not router routes — see [`patterns.md`](patterns.md).

## Inventory

Status legend — **Live**: route exists and carries real content. **Routed, stub**: the route exists and is reachable, but the drawn screen is not built — the nav restructure pre-created it so later slices only add files (see the hotspot freeze in [`navigation.md`](navigation.md)). **Sheet**: gorhom sheet component, no route of its own.

| ID | Canvas label | Route (`apps/mobile/app/`) | Status |
| --- | ------------ | -------------------------- | ------ |
| s01 | Sign-in | `(auth)/sign-in.tsx` | Live |
| s02 | Join chapter | `(auth)/join.tsx` | Routed, stub — code entry + invite-link autofill not built |
| s03 | First-run + notification primer | `(auth)/welcome.tsx` | Routed, stub — auto-joined channels + contextual push primer not built |
| s04 | Chat — channels (landing) | `(tabs)/index.tsx` | Live — chat is home; real channel list on `GET /v1/channels`, with the UP NEXT strip, the ✦ Ask pill, and server unread/mention badges. DM rows resolve the other participant from `member_ids` against the roster projection, so no row shows a uuid. No PINNED section: `ChatChannel` carries no pin field |
| s05 | Chat thread | `(tabs)/chat-thread.tsx` | Live — real messages on `@repo/chat-core`: realtime, optimistic send, outbox retry/discard, reactions, typing. No attachments, no scrollback pagination, no reply-quote |
| s06 | Events list | `(tabs)/events.tsx` | Live — real `useEvents()` data, upcoming + still-checkable-in |
| s07 | Event detail | `(tabs)/event-details.tsx` | Live — reads an `id` param; **filename contract, never rename**. RSVP row renders disabled: no RSVP model exists server-side ([`../../behavior/events.md`](../../behavior/events.md)) |
| s08 | Tasks + points | `(tabs)/tasks.tsx` | Live — real `useTasks()` rows filtered to the viewer, grouped DUE THIS WEEK / LATER, with the absorbed points balance + house rank card. Hosts s19. Completing a `TODO` is two writes: the server has no `TODO → COMPLETED` transition |
| s09 | More hub | `(tabs)/more.tsx` | Live |
| s10 | Study hours | `(tabs)/study.tsx` | Live — real sessions on `GET /v1/study-sessions`, geofenced ([`patterns.md`](patterns.md)). The live session is recovered from the list on mount, so a relaunch mid-session does not strand the member. `AppState` mirrors foreground state to `/pause` and `/resume`; the 5-minute heartbeat runs foreground-only at `Accuracy.Balanced`. The timer displays **credited** time re-derived from the session's own `last_heartbeat_at` watermark, never an accumulated counter. Start is gated behind a contextual location primer. The drawn `THIS WEEK · 5.4 of 6.0 hrs` meter ships without its denominator: no weekly requirement is modelled anywhere |
| s11 | Dues | `(tabs)/dues.tsx` | Live — the viewer's own invoices from `GET /v1/invoices` (the route serves a `billing:view` holder the whole chapter, so the screen filters), balance from OPEN rows, and Stripe PaymentSheet behind the `isStripeAvailable` guard in `lib/payments/stripe.ts`. A completed sheet shows **payment received, confirmation pending** and flips to Paid only when the webhook has written it. Pay settles one invoice at a time — a PaymentIntent is per invoice. The drawn payment-plan link, payment-method sub-labels and receipts line are omitted: none has a backing model, and the method detail lives on a `billing:view`-only route |
| s12 | Documents | `(tabs)/documents.tsx` | Live — real folders and documents, title search, opens the signed `downloadUrl` in the system browser. No PINNED section (no pin field exists) and no upload affordance: the s21 sheet needs a file picker, which is not a dependency |
| s13 | Directory | `(tabs)/directory.tsx` | Live — actives + alumni chips and name search ([`../../behavior/members.md`](../../behavior/members.md)). Opts out of `ScreenShell` for a `FlatList`, because nothing here paginates. Rows do not navigate: member detail would need a new route file and the tab layout is frozen |
| s14 | Notifications | `(tabs)/notifications.tsx` | Live — real in-app history grouped TODAY/EARLIER, unread dot, tap-to-read, and a Mark-all-read fan-out (no bulk endpoint exists). The per-row category label is derived from `data.target.screen`: notification rows do **not** store their category. No deep-link on tap — that lands with the push handler in C7 |
| s15 | Profile | `(tabs)/profile.tsx` | Live — identity, two real stat cards (points, approved service hours), and the backed profile fields. **Read-only**: no Edit action, because an avatar picker is not a dependency. The drawn "96% attendance" stat and the Phone / Pledge class / Big brother rows are omitted — no member-readable source exists for any of them |
| s16 | Settings | `(tabs)/preferences.tsx` | Live — drawn title is "Settings"; route filename stays `preferences.tsx` (settled, see notes). Three sections as drawn: NOTIFICATIONS (quiet hours plus a switch per shared category), CHAPTER · ADMIN (`chapter-config:view`-gated, read-only), ACCOUNT (Appearance as static text, the Terms/Privacy/FERPA links from #275, sign out, and delete account from #713). The drawn "Join code" row is omitted: no such field exists |
| s17 | Ask sheet | `(tabs)/ask.tsx` | Routed, stub — global ✦ Ask entry, presented as a sheet; answers per [`../../behavior/ai.md`](../../behavior/ai.md) |
| s18 | QR check-in scanner | `(tabs)/check-in.tsx` | Live — member scanner, latched reads + manual code ([`patterns.md`](patterns.md)) |
| s19 | New task sheet | *sheet* on `tasks.tsx` | Live — gorhom v5 sheet on the host route, `tasks:manage`-gated. Title, points and a roster assignee picker as drawn; the due date is **preset chips, not the drawn free field**, because no date picker is a dependency and `package.json` is frozen (same constraint as s21) |
| s20 | Log service hours sheet | *sheet* on `service-hours.tsx` | Live — gorhom v5 sheet on the host route ([`../../behavior/service-hours.md`](../../behavior/service-hours.md)). Description and duration only; **no proof attachment**, which needs an image picker |
| s21 | Upload document sheet | *sheet* on `documents.tsx` | Sheet — **blocked**: uploading needs a file picker, and adding one touches the frozen `package.json` (integrator PR per [`navigation.md`](navigation.md)) |
| s22 | Host check-in (admin) | `(tabs)/host-check-in.tsx` | Live — rotating QR, `events:update`-gated. Reached from the More hub's admin section, which resolves the next hostable event and passes its `eventId` |
| s23 | Adjust points sheet (admin) | *sheet* on `more.tsx` | Sheet — **not built**: the More hub's Adjust points row renders disabled, because the sheet needs a member picker plus amount/category/reason. Server rules (reason required, audit-logged) stand: [`../../behavior/points.md`](../../behavior/points.md) |

Supporting route with no drawn screen: `(auth)/chapter-picker.tsx` — chapter selection when an account resolves to more than one chapter during join/sign-in. It reuses s02's visual language.

## Removed screens

These pre-Signet screens had no Canvas counterpart and have been **deleted**:

| Removed route | Why removed |
| ------------- | ----------- |
| `(tabs)/index.tsx` (old Home) | There is no Home tab — chat is home (s04). The `index.tsx` path is reused by the chat list. |
| `(tabs)/points.tsx` | Absorbed into Tasks (s08): points balance + house rank render at the top of the task board. **Landed.** The rank denominator counts members with points in the window, not chapter members — `getLeaderboard` groups transactions. |
| `(tabs)/points-details.tsx` | Absorbed into Tasks (s08) and Profile (s15) stat cards; the ledger stays authoritative in [`../../behavior/points.md`](../../behavior/points.md). The s08 half has landed as the balance + house-rank card; no standalone leaderboard list replaced the deleted one, by design. |
| `(tabs)/notification-targets.tsx` | Notification preferences live in Settings (s16); opt-in happens via the contextual primer (s03 and [`patterns.md`](patterns.md)). |
| `(tabs)/onboarding-tour.tsx` | Replaced by the first-run screen (s03) — join flow behavior in [`../../behavior/onboarding.md`](../../behavior/onboarding.md). |
| `(tabs)/documents-reports.tsx` | Split: documents become s12; reports remain web-only and do not return to mobile. |

## Renames

Both have landed.

| Former file | Now | Screen |
| ----------- | --- | ------ |
| `(tabs)/chat.tsx` | `(tabs)/index.tsx` | s04 — chat list is the home/index route |
| `(tabs)/task-center.tsx` | `(tabs)/tasks.tsx` | s08 |

All renames and removals above shipped in one PR, as the typed-routes rule requires ([`navigation.md`](navigation.md)). Stale deep links into the removed paths land on `app/+not-found.tsx`, which redirects to home rather than drawing a dead end.

## Notes

- Every screen implements the skeleton/empty/error states family — rule stated once in [`README.md`](README.md), not per row. The shared implementation is `apps/mobile/components/state-block.tsx`, built to [`../design-system/components.md`](../design-system/components.md) §10. It adds a fourth member: a **"no chapter selected"** state, because no production token carries an `active_chapter_id` claim while #805 is open, so every chapter-scoped query stays disabled and that is what a member actually sees. The screens predating it still carry their own inline loading/error blocks.
- **Elements drawn in Canvas that have no backing data are omitted, not faked.** In this cluster: s16's "Join code" (chapters have no join code — joining runs through single-use, expiring invite tokens), s15's "96% attendance" and its Phone / Pledge class / Big brother rows, s12's PINNED section, s10's weekly study goal (no weekly requirement is modelled anywhere, yet s08, s09 and s14 all draw the same fictional `6.0`), and s11's payment plan, payment-method sub-labels (`Visa ··4242`) and receipts-email line. Each carries a `TODO-DESIGN:` at its site and a filed issue.
- s16's drawn title is "Settings" while the route file is `preferences.tsx`. The filename is not part of any external contract. **Settled: it stays `preferences.tsx`** — it did not join the rename PR, and the registration carries the drawn title instead. Cite `preferences.tsx` for the route and "Settings" for anything a member reads.
