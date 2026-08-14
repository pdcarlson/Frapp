> **TARGET SPEC (not yet built).** This inventory describes the target app; most routes below do not exist in `apps/mobile` yet. Implementation is tracked in GitHub Issues — do not file spec-vs-implementation drift issues against these documents ([`README.md`](README.md)).

# Mobile Screen Inventory (s01–s23)

> The 23 locked Canvas screens mapped to expo-router paths, plus the pre-Signet screens they replace. The mapping is total: every current file under `apps/mobile/app` is accounted for.

Visual truth: [`../design-system/reference/canvas-screens.dc.html`](../design-system/reference/canvas-screens.dc.html). Screen ids (`s01`…`s23`) and Canvas labels below match that file's `data-screen-label` attributes exactly.

## Route conventions

- Routes live under `apps/mobile/app`. `(auth)/` holds the signed-out stack; `(tabs)/` holds everything signed-in. Routes not in the 4-tab bar are hidden (`href: null` in the tab layout) and reached by navigation only.
- **Filename contract:** `event-details.tsx` MUST never be renamed. `frapp://event-details` is baked into every exported `.ics` file (`deepLinkUrl` in `apps/mobile/app/(tabs)/event-details.tsx`); renaming the route breaks calendar entries already sitting on members' devices.
- All other renames land together in a single PR so typed routes never half-break — see [`navigation.md`](navigation.md).
- Bottom-sheet screens (marked *sheet* below) are `@gorhom/bottom-sheet` components hosted by a parent screen, not router routes — see [`patterns.md`](patterns.md).

## Inventory

Status legend — **Live**: route exists today, gets the Signet reskin. **New**: route does not exist yet; it is created when the app is rebuilt against this spec. **Sheet**: gorhom sheet component, no route of its own.

| ID | Canvas label | Route (`apps/mobile/app/`) | Status |
| --- | ------------ | -------------------------- | ------ |
| s01 | Sign-in | `(auth)/sign-in.tsx` | Live |
| s02 | Join chapter | `(auth)/join.tsx` | New — code entry + invite-link autofill |
| s03 | First-run + notification primer | `(auth)/welcome.tsx` | New — auto-joined channels + contextual push primer |
| s04 | Chat — channels (landing) | `(tabs)/index.tsx` | Live file, new content — chat is home; the chat list moves here from `chat.tsx` (see renames below) |
| s05 | Chat thread | `(tabs)/chat-thread.tsx` | Live |
| s06 | Events list | `(tabs)/events.tsx` | Live |
| s07 | Event detail | `(tabs)/event-details.tsx` | Live — **filename contract, never rename** |
| s08 | Tasks + points | `(tabs)/tasks.tsx` | New filename — renamed from `task-center.tsx`; absorbs the points balance/rank (see removals) |
| s09 | More hub | `(tabs)/more.tsx` | Live |
| s10 | Study hours | `(tabs)/study.tsx` | New — study-session timer, geofenced ([`patterns.md`](patterns.md)) |
| s11 | Dues | `(tabs)/dues.tsx` | New — balance, pay, history ([`patterns.md`](patterns.md)) |
| s12 | Documents | `(tabs)/documents.tsx` | New — replaces the documents half of `documents-reports.tsx` |
| s13 | Directory | `(tabs)/directory.tsx` | New — actives + alumni ([`../../behavior/members.md`](../../behavior/members.md)) |
| s14 | Notifications | `(tabs)/notifications.tsx` | Live |
| s15 | Profile | `(tabs)/profile.tsx` | Live |
| s16 | Settings | `(tabs)/preferences.tsx` | Live — drawn title is "Settings"; route filename stays `preferences.tsx` (see notes) |
| s17 | Ask sheet | `(tabs)/ask.tsx` | New — global ✦ Ask entry, presented as a sheet; answers per [`../../behavior/ai.md`](../../behavior/ai.md) |
| s18 | QR check-in scanner | `(tabs)/check-in.tsx` | New — member scanner ([`patterns.md`](patterns.md)) |
| s19 | New task sheet | *sheet* on `tasks.tsx` | Sheet |
| s20 | Log service hours sheet | *sheet* on `service-hours.tsx` | Sheet — host route exists today ([`../../behavior/service-hours.md`](../../behavior/service-hours.md)) |
| s21 | Upload document sheet | *sheet* on `documents.tsx` | Sheet |
| s22 | Host check-in (admin) | `(tabs)/host-check-in.tsx` | New — rotating QR display, role-gated |
| s23 | Adjust points sheet (admin) | *sheet* on `more.tsx` | Sheet — reason required, audit-logged ([`../../behavior/points.md`](../../behavior/points.md)) |

Supporting route with no drawn screen: `(auth)/chapter-picker.tsx` — chapter selection when an account resolves to more than one chapter during join/sign-in. It reuses s02's visual language.

## Removed screens

These pre-Signet screens have no Canvas counterpart and are deleted when the app is rebuilt against this spec:

| Current route | Why removed |
| ------------- | ----------- |
| `(tabs)/index.tsx` (old Home) | There is no Home tab — chat is home (s04). The `index.tsx` path is reused by the chat list. |
| `(tabs)/points.tsx` | Absorbed into Tasks (s08): points balance + house rank render at the top of the task board. |
| `(tabs)/points-details.tsx` | Absorbed into Tasks (s08) and Profile (s15) stat cards; the ledger stays authoritative in [`../../behavior/points.md`](../../behavior/points.md). |
| `(tabs)/notification-targets.tsx` | Notification preferences live in Settings (s16); opt-in happens via the contextual primer (s03 and [`patterns.md`](patterns.md)). |
| `(tabs)/onboarding-tour.tsx` | Replaced by the first-run screen (s03) — join flow behavior in [`../../behavior/onboarding.md`](../../behavior/onboarding.md). |
| `(tabs)/documents-reports.tsx` | Split: documents become s12; reports remain web-only and do not return to mobile. |

## Renames

| Current file | Becomes | Screen |
| ------------ | ------- | ------ |
| `(tabs)/chat.tsx` | `(tabs)/index.tsx` | s04 — chat list becomes the home/index route |
| `(tabs)/task-center.tsx` | `(tabs)/tasks.tsx` | s08 |

All renames and removals above ship in the single typed-routes PR ([`navigation.md`](navigation.md)).

## Notes

- Every screen implements the skeleton/empty/error states family — rule stated once in [`README.md`](README.md), not per row.
- s16's drawn title is "Settings" while the route file is `preferences.tsx`. The filename is not part of any external contract; whether it joins the rename PR is an open call — until then, cite `preferences.tsx`.
