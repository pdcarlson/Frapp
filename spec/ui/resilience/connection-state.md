# Connection state machine

> Part of [Network resilience](README.md).

```
        ┌──────────┐
        │  ONLINE  │ ◄── link up, consecutive /health failures = 0
        └────┬─────┘
             │ 1–2 consecutive /health failures (link still up)
             ▼
        ┌──────────┐
        │ DEGRADED │ ◄── link up, API intermittently unreachable
        └────┬─────┘
             │ 3 consecutive /health failures
             │ OR navigator.onLine → false (from any state)
             ▼
        ┌──────────┐
        │ OFFLINE  │
        └────┬─────┘
             │ navigator.onLine → true
             │ AND a /health probe succeeds
             ▼
        ┌──────────┐
        │  ONLINE  │
        └──────────┘
```

A down link skips DEGRADED — there is no intermittent API to talk about when
there is no link. Recovery is not the `online` event alone: that event only
means the browser has a link again. The next successful `/health` probe is
what clears the failure count. Blindly resetting on `online` would flash
ONLINE while the API is still dead.

**DEGRADED's "slow (>5s)" half is unbuilt on both surfaces.** The Detection Logic heading names "requests are slow (>5s) or intermittently failing". Neither web
nor mobile times a real request; consecutive `/health` failures are the only
DEGRADED input today. Do not read the amber banner as evidence that latency
is measured.

## Detection Logic

```typescript
type ConnectionState = 'ONLINE' | 'DEGRADED' | 'OFFLINE';

// Maintained by a global provider
// - 'ONLINE': navigator.onLine && recent /health probes succeeding
// - 'DEGRADED': navigator.onLine but consecutive /health failures in 1..2
//   (the "slow (>5s)" half of this sentence is unbuilt — see below)
// - 'OFFLINE': !navigator.onLine OR health check to /health fails 3 times
// A 429 from /health is not a failure: it proves the API is up.
```

> **`navigator.onLine` is the web half of that rule; mobile has no such property.**
> React Native defines `navigator` but never sets `onLine`, so `!navigator.onLine`
> evaluates `undefined === false` → `false` and a naive port reports *permanently
> online*. The mobile equivalent of the clause is an `expo-network` read, and the
> banner takes only the **link** half of it (`isConnected === false`). Everything
> else in this section reads the same on both surfaces: one link signal, one
> `/health` poll (30s, 5s timeout), three consecutive failures.
>
> **`isInternetReachable === false` is suspicion, not proof.** The mobile
> outbox reads this same monitor (#1072), so this value is DEGRADED for both
> the banner and the queue — a slow or once-failed probe must still send.
> Folding it into OFFLINE would disable check-in at the door with no route
> back: a chapter house whose captive-portal validation probe is blocked
> reports `isInternetReachable: false` while the API is perfectly reachable,
> and a down link also suppresses the `/health` probe that would have proved
> otherwise. So it counts as one probe failure and `/health` settles it,
> which is also what this section literally says: `!navigator.onLine` is the OFFLINE
> clause, "intermittently failing" is DEGRADED.

**Two inputs, not one.** A device link is not reachability, which is why `DEGRADED`
exists at all: an API that is up, routable and failing leaves the member connected
while the app does not work, and "you're offline" is a lie they can disprove by
opening a browser.

## UI Indicators

| State | Banner | Write Actions | Read Actions |
|-------|--------|--------------|--------------|
| ONLINE | None | Enabled | Enabled (live data) |
| DEGRADED | "Slow connection. Some features may be delayed." (amber) | Enabled (with extended timeouts) | Enabled (from cache + refetch) |
| OFFLINE | "You're offline. Showing cached data." (red/amber) | **Labeled where a queue exists; refused with "Reconnect to make changes." where none does — usually by disabling the control, but not where its appearance carries state** — see below | Enabled (from cache) |

**The copy above lost its leading ⚡ / 📡.** Those predate Signet's iconography
rule, which governs glyphs on these surfaces and does not admit emoji
([`design-system/iconography.md`](../design-system/iconography.md)), and the semantic
tint already carries the severity they stood in for. The strings are otherwise
verbatim and mobile ships them exactly. `apps/web` shipped a **third** variant until
#1707 — `"You're offline. Showing cached data. Changes will sync when you reconnect."`
— and now ships the string above, because the trailing clause became false rather
than merely divergent. Web mutations no longer pause-and-resume offline; they reject
(see [`web-dashboard/README.md`](../web-dashboard/README.md) § Surviving data contracts),
so a global banner promising a sync would have contradicted principle 1, "actions must
never appear to succeed when they haven't". The queue promise belongs at the one
control that has a queue — the composer's own label — not in page chrome that renders
on every route. The lucide `WifiOff` / `Zap` icons
(`apps/web/components/shared/offline-banner.tsx`) are still web-only, left for the
reskin.

**Write gating is "labeled, never blocked, wherever an outbox exists."** The
disabled-with-tooltip rule holds only where a failed write is *lost*. It must not be
applied to a surface with a queue: the chat composer's `sendMessage` enqueues to the
outbox and returns before touching the network, so gating it would defeat the queue
built to make composing-while-offline work — it stays enabled and gains the label
"You're offline — messages send when you reconnect."

**Web violated this until the #920 chat slice.** `apps/web` passed `disabled`
into the composer on `connection === "offline"`, and `submit()` returned early
on the same flag — so Send greyed out and Enter did nothing at all, with no
explanation, on the one surface built to survive being offline. (The draft
itself survived; the loss was the send, not the text.) The composer now takes an
`isOffline` prop that only renders the label;
`packages/chat-core/src/chat-client.ts` has had the "Offline: the row is safely
queued" branch the whole time, unreachable from web.

**The split runs inside that one control**, which is the part worth carrying to
other surfaces. The text path queues, so it stays live and is labelled. The
**slash commands do not**: `/points`, `/task` and `/event` POST straight to
their controllers from `packages/chat-core/src/dispatch.ts` with no outbox
behind them, so an offline dispatch is a queueless write and refuses — before
clearing the composer, so the typed command survives to be re-sent. One control,
both halves of this rule, decided per action rather than per screen. Queueless surfaces disable and
say why: service hours (s20) and check-in (s18) both take
`writeBlockedReason` and wire it to the control's `accessibilityHint`, not merely to
a sentence beside it. Dues is already gated by its own Stripe guard. The rule lives
in `apps/mobile/lib/connection/state.ts` (`writeBlockedReason`) so the split is one
decision rather than a per-screen judgement call.

**Disabling is the usual form of that refusal and is right above** — a mobile
submit button carries no state of its own, so `disabled` costs nothing beyond
the press. **On a control whose appearance carries state, it is wrong.** The web
Profile notification switches (#564) are
queueless, and since #1754's `networkMode: "always"` an offline toggle no longer
parks — it starts, exhausts `retry: 2` and rejects in about three seconds. That
removed the silent loss, but not the reason to refuse: the optimistic `onMutate`
moves the switch, it sits wrong for those three seconds, then snaps back under an
error toast. On a control whose *position is the state*, showing a value the
server was never told about is the failure; refusing costs nothing and answers
immediately. So they refuse — this is this section's "disabled with 'Reconnect to make
changes'" on a control whose appearance carries state, which is why they do
not go through `useSubscriptionGate` (#1753). That hook is the dashboard-wide
path for queueless *buttons* (`disabled` + `title` on the control). These
switches cannot take the real `disabled` attribute, for the colour / tab-order
reasons below.
They refuse with **`aria-disabled` plus a guard in the handler**, not the
`disabled` attribute, because `apps/web/components/ui/switch.tsx` scopes every
state colour to `enabled:` and its thumb takes `group-data-[disabled]`, which
outranks the `data-[state]` thumb rules. A genuinely disabled grid therefore
renders every switch identically, leaving the on/off cue at the thumb offset
alone — measured 2.24:1, under [WCAG 1.4.11's 3:1 for non-text](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) —
and drops the whole grid out of the tab order. Reading which categories are
muted is the more common offline need, so erasing the state to signal
unavailability trades the wrong one away.

The obligations that come with soft-disabling, all three required together:
the handler must actually refuse (an `aria-disabled` control that still writes
is a lie); the reason must reach the control itself via `aria-describedby`, per
the `accessibilityHint` rule above — a sentence after the last row is not on the
control; and the visual presentation must not contradict the accessibility tree, so
`switch.tsx` carries an `aria-disabled:` cursor rather than leaving a control
that announces "unavailable" while behaving like a live one. Activating it
anyway is answered out loud rather than swallowed, since a control that
silently ignores a click is the dead control this whole section exists to
prevent.

**That third obligation stops at the cursor, and the reason is measured.** An
`opacity` dim is the obvious way to make the two agree and is wrong twice over,
because `opacity` composites the whole element. It dims the focus ring — and
soft-disabling is exactly the case where the control keeps its place in the tab
order, so that ring is the entire focus indicator: across all 19 seeds,
ring-vs-`--background` falls from 8.48–11.47 undimmed to 2.96–3.68 at a 50% dim,
putting **5 of the 19** under [§6](../design-system/README.md)'s 3:1. (Those
undimmed figures were 3.05–4.07 while the recipe drew in accent-8; it draws in
accent-11 since the greenfield ladder, so the dim fails five chapters rather than
all of them — still five chapters whose keyboard users lose the indicator.) And
it flattens the on/off cue this whole carve-out exists to protect, dropping
checked-vs-unchecked below 3:1 on **sixteen** accents where nine already sit
there undimmed — the same erasure, at a larger magnitude, that disqualified the
real `disabled` attribute. `button.tsx` and `label.tsx` already record the
system's ban on that idiom. So the visual signal here is the cursor, and the
*explanation* is carried by `aria-describedby` and the note, not by dimming.

Banner behavior:
- Appears at the top of the content area (below header bar). **Mobile deviates,
  deliberately:** the banner is mounted above the navigator in `app/_layout.tsx`, not
  below each screen's header. "Below the header bar" is a web-shaped rule written for
  a dashboard chrome; a global banner belongs above every screen, and moving it under
  each header would mean editing the frozen `apps/mobile/components/screen-shell.tsx`
  ([`mobile/navigation.md`](../mobile/navigation.md) § Hotspot freeze). It does take the
  safe-area inset, which it previously did not — it rendered outside every
  `SafeAreaView` and painted under the status bar on a notched device.
- 200ms slide-down animation. **Mobile ships the 200ms as an opacity transition, not a
  translate** — the duration is the spec's, the motion is not. It runs on the JS driver
  (opacity here animates alongside a non-transform property), which is the right trade for
  something that fires once per connectivity change rather than once per frame of a
  gesture. Recorded as drift rather than smuggled: nothing about the placement forces a
  fade, so a later pass may make it a real slide.
- Auto-dismisses when state improves
- User can manually dismiss (it reappears if state hasn't changed after 30s). On mobile a
  dismissed bar fades to transparent but **stays laid out**, so its space is not reclaimed
  until the state changes or the 30s timer fires — also known drift
- Announced, not merely drawn: `accessibilityRole="alert"` +
  `accessibilityLiveRegion="polite"` on mobile, `role="alert"` + `aria-live="polite"`
  on web. A member using a screen reader needs to know a write is about to fail as
  much as a sighted one does.

## Implementation

**Mobile has one connection model for the UI.** `apps/mobile/lib/connection/`:
`state.ts` holds the copy and write-gating (`connectionBannerCopy`,
`writeBlockedReason`) and re-exports `deriveConnectionState` from
`@repo/validation` — the same function web's `NetworkProvider` calls, so the
two surfaces cannot disagree about the three states. `monitor.ts` is the
process singleton that feeds it
(`expo-network` link state plus the `/health` poll), `use-connection.ts` is how a
component reads it through `useSyncExternalStore`, and `components/app-runtime.tsx`
starts it once above the auth gate. `components/network-banner.tsx` takes **no
props** — it used to be handed two raw `expo-network` booleans and derive its own
flags inline, which made it a third opinion about connectivity, and the readings
could and did disagree on screen.

**Mobile chat reads this same monitor.** `chatNetworkState`
(`lib/chat/use-chat-runtime.ts`) is a `NetworkState` adapter over
`connectionMonitor` — one `expo-network` subscription, one `/health` poll.
`isOffline()` is this model's OFFLINE (link down, or three failed probes), so a
dead API with the link up queues instead of POSTing a failed bubble, and a
health recovery with no link flip still fires `online=true` to flush the
outbox. `DEGRADED` does **not** queue: a slow or once-failed probe must still
send. The remaining asymmetry is the banner's write gate, not a second
connectivity definition: `isInternetReachable === false` is still one probe
failure here, never proof of OFFLINE, because that value disables check-in.

**Web and mobile share the rule.** `deriveConnectionState` and
`healthProbeIsReachable` live in `@repo/validation`. Web's
`NetworkProvider` and mobile's `monitor.ts` feed them; neither app owns a
second copy. A 429 from `/health` is reachability, not a failure — the
anonymous bucket can 429 a chapter house behind one NAT while authenticated
`/v1` traffic still succeeds.

**Presence does not use this OFFLINE.** Chapter presence rides the Supabase
Realtime socket, a different service from `/health`. Web gates
`ChapterPresenceProvider` on the browser link (`linkOnline`), not on
`isOffline`, so an API-only outage does not make every member read Offline.

---
