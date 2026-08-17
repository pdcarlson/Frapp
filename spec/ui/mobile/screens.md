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
| s04 | Chat — channels (landing) | `(tabs)/index.tsx` | Live — chat is home; real channel list on `GET /v1/channels`, with the UP NEXT strip, the ✦ Ask pill, and server unread/mention badges. No PINNED section: `ChatChannel` carries no pin field |
| s05 | Chat thread | `(tabs)/chat-thread.tsx` | Live — real messages on `@repo/chat-core`: realtime, optimistic send, outbox retry/discard, reactions, typing. No attachments, no scrollback pagination, no reply-quote |
| s06 | Events list | `(tabs)/events.tsx` | Live |
| s07 | Event detail | `(tabs)/event-details.tsx` | Live — **filename contract, never rename** |
| s08 | Tasks + points | `(tabs)/tasks.tsx` | Live — renamed from `task-center.tsx`; still to absorb the points balance/rank (see removals) |
| s09 | More hub | `(tabs)/more.tsx` | Live |
| s10 | Study hours | `(tabs)/study.tsx` | Routed, stub — study-session timer, geofenced ([`patterns.md`](patterns.md)) |
| s11 | Dues | `(tabs)/dues.tsx` | Routed, stub — balance, pay, history ([`patterns.md`](patterns.md)) |
| s12 | Documents | `(tabs)/documents.tsx` | Routed, stub — replaced the documents half of the deleted `documents-reports.tsx` |
| s13 | Directory | `(tabs)/directory.tsx` | Routed, stub — actives + alumni ([`../../behavior/members.md`](../../behavior/members.md)) |
| s14 | Notifications | `(tabs)/notifications.tsx` | Live |
| s15 | Profile | `(tabs)/profile.tsx` | Live |
| s16 | Settings | `(tabs)/preferences.tsx` | Live — drawn title is "Settings"; route filename stays `preferences.tsx` (settled, see notes) |
| s17 | Ask sheet | `(tabs)/ask.tsx` | Routed, stub — global ✦ Ask entry, presented as a sheet; answers per [`../../behavior/ai.md`](../../behavior/ai.md) |
| s18 | QR check-in scanner | `(tabs)/check-in.tsx` | Routed, stub — member scanner ([`patterns.md`](patterns.md)) |
| s19 | New task sheet | *sheet* on `tasks.tsx` | Sheet |
| s20 | Log service hours sheet | *sheet* on `service-hours.tsx` | Sheet — host route exists today ([`../../behavior/service-hours.md`](../../behavior/service-hours.md)) |
| s21 | Upload document sheet | *sheet* on `documents.tsx` | Sheet |
| s22 | Host check-in (admin) | `(tabs)/host-check-in.tsx` | Routed, stub — rotating QR display, role-gated; not yet linked from More |
| s23 | Adjust points sheet (admin) | *sheet* on `more.tsx` | Sheet — reason required, audit-logged ([`../../behavior/points.md`](../../behavior/points.md)) |

Supporting route with no drawn screen: `(auth)/chapter-picker.tsx` — chapter selection when an account resolves to more than one chapter during join/sign-in. It reuses s02's visual language.

## Removed screens

These pre-Signet screens had no Canvas counterpart and have been **deleted**:

| Removed route | Why removed |
| ------------- | ----------- |
| `(tabs)/index.tsx` (old Home) | There is no Home tab — chat is home (s04). The `index.tsx` path is reused by the chat list. |
| `(tabs)/points.tsx` | Absorbed into Tasks (s08): points balance + house rank render at the top of the task board. |
| `(tabs)/points-details.tsx` | Absorbed into Tasks (s08) and Profile (s15) stat cards; the ledger stays authoritative in [`../../behavior/points.md`](../../behavior/points.md). **Its leaderboard UI has no landed replacement yet** — it was deleted with the route and re-lands as those stat cards. |
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

- Every screen implements the skeleton/empty/error states family — rule stated once in [`README.md`](README.md), not per row.
- s16's drawn title is "Settings" while the route file is `preferences.tsx`. The filename is not part of any external contract. **Settled: it stays `preferences.tsx`** — it did not join the rename PR, and the registration carries the drawn title instead. Cite `preferences.tsx` for the route and "Settings" for anything a member reads.
