# Optimistic UI for Signet: which of your ~30 mutations should flip instantly, and exactly how

**Bottom line: most of Signet's interactions should become optimistic, and one must stay blocking.** Toggles (module on/off, notification prefs), task completion, chat reactions, chat sends, poll voting, and event RSVP are all "binary or additive" state changes that the industry treats as safe to update instantly and cheap to roll back [medium](https://medium.com/@kyledeguzmanx/what-are-optimistic-updates-483662c3e171) [dev](https://dev.to/stacknotice/react-useoptimistic-optimistic-ui-patterns-that-actually-work-2026-5460). **Stripe dues payment must stay pessimistic** — a blocking spinner with a disabled button — because it is a financial transaction where a "success-like" state before server confirmation breaks trust, and this is exactly what Stripe's own guidance prescribes [stripe](https://stripe.com/resources/more/mobile-checkout-ui) [stripe](https://docs.stripe.com/payments/build-a-two-step-confirmation). The two ambiguous cases — **points/task adjustments with a required audit reason**, and **QR attendance check-in** — should stay pessimistic-*lite*: a spinner scoped to the submit button (not a full-screen gray-out), because both are server-authoritative actions the client can't reliably predict [sitepoint](https://www.sitepoint.com/react-useoptimistic-production-patterns-for-instant-ui-updates/) [rohanshewale](https://rohanshewale.me/blog/2025/11/optimistic-ui-patterns/).

The good news for your codebase: your current "full loading state + gray out surrounding UI" is the wrong default for nearly all of these, and TanStack Query gives you two clean patterns to replace it — one of which requires *no rollback code at all*.

---

## Part 1 — The decision framework: what's safe to be optimistic

The industry rule is consistent across sources: **be optimistic when the operation is a reversible state change with high success probability and low failure consequence; be pessimistic when the outcome must be trusted (money, irreversible deletes, server-only validation).**

**Safe-to-be-optimistic (the "binary/additive" category).** Likes, reactions, toggles, upvotes/downvotes, and todo checkoffs are the canonical safe cases because a false positive is trivially undone by reverting the count or flag [medium](https://medium.com/@kyledeguzmanx/what-are-optimistic-updates-483662c3e171) [dev](https://dev.to/stacknotice/react-useoptimistic-optimistic-ui-patterns-that-actually-work-2026-5460). This is what makes best-in-class apps feel instant:

- **Linear** applies every change to a local in-memory store first and queues the mutation in the background — the UI re-renders synchronously from local state before the network is even touched, which is *why* there are "no spinners" for these actions [performance](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) [bytemash](https://bytemash.net/posts/i-went-down-the-linear-rabbit-hole/). You don't need Linear's full local-first sync engine to get the same *feel* for individual mutations — TanStack Query's optimistic updates get you 90% of the perceived speed.
- **Todoist** completes a task immediately and shows an Undo popup that lasts a few seconds — the completion is applied to the UI first, with an instant affordance to revert [todoist](https://www.todoist.com/help/articles/complete-a-task-with-a-recurring-date-dmI6SVqdP).
- **Slack/Discord** one-click reactions register "almost instantly," and Discord poll results "update in real time" as members vote [slack](https://slack.com/help/articles/4406393601683-Manage-your-emoji-preferences) [rally](https://rally.casa/blog/how-to-run-discord-polls).
- **Superhuman** sends messages optimistically and, on failure, shows a red "Send failed" notification with Try Again / Edit / Discard — the model to copy for chat sends [superhuman](https://help.superhuman.com/hc/en-us/articles/43485254948627-Failed-Sends).

**Keep-pessimistic (the "trust-critical" category).** Multiple sources independently name the same exclusions: **financial transactions**, **permanent deletes without undo**, **actions with serious consequences (payments, account deletion, password changes)**, and **anything requiring server validation the client can't replicate** [dev](https://dev.to/stacknotice/react-useoptimistic-optimistic-ui-patterns-that-actually-work-2026-5460) [unwiredlearning](https://unwiredlearning.com/blog/react-optimistic-ui) [xiaoyunyang](https://xiaoyunyang.github.io/post/web-developer-playbook-optimistic-ui/). The failure mode to avoid: showing "completed" when the server may later reject it. Where trust matters, show an **"updating"/in-flight state** instead [stackexchange](https://ux.stackexchange.com/questions/17514/should-we-be-optimistic-or-pessimistic-with-ui-updates-on-ajax-requests). For server-side validation specifically, "*Looks fine on the client, server says no* is a worse UX than waiting" — so only be optimistic when client-side validation is sufficient [rohanshewale](https://rohanshewale.me/blog/2025/11/optimistic-ui-patterns/) [remix](https://remix.run/docs/en/main/guides/optimistic-ui).

**Stripe is the clearest case.** Stripe's own mobile-checkout guidance says: give **immediate loading-state feedback** when the pay button is tapped, **disable the button** until fields are valid and while the request is in flight (to prevent double submission), and show an **explicit confirmation** only after it goes through [stripe](https://stripe.com/resources/more/mobile-checkout-ui). Their two-step confirmation docs reinforce this: disable the submit button while loading, re-enable only in the error handler, and surface errors rather than assuming success [stripe](https://docs.stripe.com/payments/build-a-two-step-confirmation). This is a blocking spinner by design.

### How success and failure are shown

**Success is confirmed subtly or not at all.** When the optimistic update is correct, the best products show almost nothing extra — the toggle is already flipped, the checkmark is already there. Linear deliberately has no spinner [performance](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown). The common technique for pending-but-not-yet-confirmed items is a **reduced-opacity ("greyed") temporary item** that solidifies once the server confirms [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates).

**Failure needs an *explicit* surface — silent rollback is a UX bug.** Automatic rollback is invisible by default; if the UI just snaps back with no explanation, users are confused [sitepoint](https://www.sitepoint.com/react-useoptimistic-production-patterns-for-instant-ui-updates/) [medium](https://ys1113457623.medium.com/stop-using-react-19s-useoptimistic-without-an-error-rollback-ux-strategy-c50e5f966e7c). The recommended pattern is **revert + a toast/notice offering retry** ("The change could not be saved — try again?") [fernandoux](https://www.fernandoux.com/en/wiki/techniques/optimistic-updates-rollback/). For anything with a text input (a chat message, a reason field), **do not delete the user's input on failure** — keep the value, revert the surrounding state, and re-enable the field [github](https://github.com/TanStack/query/discussions/1268). And for form/field errors specifically, prefer **inline errors over toasts**, because toasts sit far from the input and users often don't read them [smashingmagazine](https://www.smashingmagazine.com/2022/08/error-messages-ux-design/).

---

## Part 2 — TanStack Query implementation patterns (v5)

TanStack Query gives you **two distinct optimistic patterns**, and choosing the right one per interaction is the single most important implementation decision [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates).

### Pattern A — UI optimism via mutation variables (no cache writes, no rollback code)

For an action whose result is only reflected in *one place* (the button/row the user clicked), render the optimistic state directly from `useMutation`'s `variables` and `isPending`. **You never touch the cache and never write rollback logic** — when the mutation settles, `isPending` flips false and the real data takes over [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates):

```js
const { isPending, variables, mutate, isError } = useMutation({
  mutationFn: sendMessage,
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['messages'] }),
})
// render: existing messages, plus a greyed pending item while isPending
{isPending && <li style={{ opacity: 0.5 }}>{variables.text}</li>}
{isError && <RetryButton onClick={() => mutate(variables)} />}
```

TanStack's explicit rule of thumb: if only one place needs the optimistic result, this approach "requires less code and is generally easier to reason about… you don't need to handle rollbacks at all." Use cache manipulation only when *multiple* surfaces must know about the update [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates). **For a solo founder with 30 call sites, this is your default for toggles, task checkoffs, reactions, votes, and RSVP** — each is reflected in the component the user tapped.

### Pattern B — Cache optimism via `onMutate` / `onError` / `onSettled` (with rollback)

When an update must appear across multiple components (e.g. a reaction that shows in the message list *and* a reaction summary), write the cache and handle rollback. The canonical v5 shape [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates):

```js
useMutation({
  mutationFn: updateTodo,
  onMutate: async (newTodo, ctx) => {
    await ctx.client.cancelQueries({ queryKey: ['todos'] })      // stop in-flight refetch
    const previous = ctx.client.getQueryData(['todos'])           // snapshot
    ctx.client.setQueryData(['todos'], old => [...old, newTodo])  // optimistic write (immutable!)
    return { previous }                                           // context → onError/onSettled
  },
  onError: (err, newTodo, onMutateResult, ctx) =>
    ctx.client.setQueryData(['todos'], onMutateResult.previous),  // rollback
  onSettled: (data, err, vars, onMutateResult, ctx) =>
    ctx.client.invalidateQueries({ queryKey: ['todos'] }),        // reconcile with server
})
```

Three non-negotiables the docs stress: **`cancelQueries` first** (otherwise an in-flight refetch "clobbers" your optimistic update when it resolves) [tanstack](https://tanstack.com/query/latest/docs/reference/QueryClient); **`setQueryData` must be immutable** (never mutate `oldData` in place) [tanstack](https://tanstack.com/query/latest/docs/reference/QueryClient); and the value returned from `onMutate` arrives in `onError`/`onSettled` as the rollback context [tanstack](https://tanstack.com/query/latest/docs/framework/react/reference/useMutation).

### Rapid double-toggle race conditions

Toggles are prone to flicker when a user taps twice fast and concurrent invalidations collide. TkDodo's fix: cancel queries in `onMutate` (as above), and guard the invalidation so only the *last* settling mutation reconciles [tkdodo](https://tkdodo.eu/blog/concurrent-optimistic-updates-in-react-query):

```js
onSettled: () => {
  if (queryClient.isMutating({ mutationKey: ['module-toggle'] }) === 1) {
    queryClient.invalidateQueries({ queryKey: ['modules'] })
  }
}
```

For actions where ordering matters, TanStack's `scope: { id: 'x' }` serializes mutations so they run one at a time instead of in parallel [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/mutations).

### List-item creation with temp IDs

For creating a poll option, message, or task, generate a client-side temp ID, insert immediately, then **replace the temp item with the server's real record in `onSuccess`** and filter it out on error [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/mutations):

```js
onMutate: async (vars, ctx) => {
  const optimistic = { id: uuid(), ...vars }
  ctx.client.setQueryData(['todos'], old => [...old, optimistic])
  return { optimistic }
},
onSuccess: (real, vars, { optimistic }, ctx) =>
  ctx.client.setQueryData(['todos'], old =>
    old.map(t => t.id === optimistic.id ? real : t)),
onError: (err, vars, { optimistic }, ctx) =>
  ctx.client.setQueryData(['todos'], old =>
    old.filter(t => t.id !== optimistic.id)),
```

### Shared hooks across web + React Native/Expo

Your shared hooks package is exactly what TanStack's `setMutationDefaults` is for. Define the `mutationFn` + `onMutate`/`onError`/`onSettled` once per mutation key in the shared package; both apps consume them via `useMutation({ mutationKey: ['addTodo'] })` [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/mutations). This also future-proofs offline: if you ever persist mutations, defaults are *required* because functions aren't serializable [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/mutations).

For React Native/Expo, wire the online detector once so paused mutations resume correctly :

```js
import { onlineManager } from '@tanstack/react-query'
import * as Network from 'expo-network'
onlineManager.setEventListener(setOnline => {
  const sub = Network.addNetworkStateListener(s => setOnline(!!s.isConnected))
  return sub.remove
})
```

Note the `networkMode` knob (`'online' | 'always' | 'offlineFirst'`) controls whether mutations pause when offline — relevant if you want mobile RSVP/check-in to queue rather than fail on flaky campus wifi [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode).

---

## Part 3 — Applied to Signet: per-interaction recommendations

| Interaction | Verdict | Pattern | What changes instantly / what stays blocking |
|---|---|---|---|
| Module on/off toggles | **Optimistic** | A (variables) + toggle race guard | Switch flips instantly; on failure snap back + toast |
| Notification pref toggles | **Optimistic** | A (variables) | Switch flips instantly; on failure snap back + toast |
| Task completion | **Optimistic** | A (variables) | Checkmark + strike-through instantly; revert + toast on fail |
| Chat message send | **Optimistic** | A (variables) or B (temp ID) | Greyed message appears instantly; "Send failed → Retry" on fail |
| Chat reactions | **Optimistic** | B (cache, shows in 2 places) | Emoji badge increments instantly; decrement + toast on fail |
| Chat pins | **Optimistic** | B (cache) | Pin indicator appears instantly; revert on fail |
| Poll voting | **Optimistic** | B (cache, tally updates) | Vote highlights + tally bumps instantly; revert + toast on fail |
| Event RSVP | **Optimistic** | A (variables) | Status flips instantly; revert + toast on fail |
| Points/task adjust (reason) | **Pessimistic-lite** | Blocking submit button only | Button spinner; keep reason text on fail; inline error |
| QR attendance check-in | **Pessimistic-lite** | Blocking, server-validated | Button spinner until server validates code; explicit success |
| Stripe dues payment | **Pessimistic (blocking)** | Disabled button + spinner | No optimistic state; explicit confirmation only after server |

### The optimistic group (toggles, task completion, reactions, pins, votes, RSVP, chat send)

**These should stop showing a full loading state and stop graying out the surrounding UI.** Replace the current blocking mutation with Pattern A wherever the change is reflected only in the tapped component (toggles, task checkoff, RSVP, message send), and Pattern B where it appears in more than one place (reactions, pins, poll tallies).

- **What changes in the first 0-100ms:** the switch flips, the checkmark and strike-through appear, the reaction badge increments, the vote tally bumps, the RSVP status changes, the sent message appears greyed. Nothing grays out; nothing spins.
- **Success confirmation:** nothing extra — the instant change *is* the confirmation, matching Linear's "no spinner" model [performance](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown). For the greyed pending chat message, it simply solidifies to full opacity.
- **Rollback-on-failure UX:** the state snaps back to its prior value and a **toast fires with a retry action** — never a silent revert [sitepoint](https://www.sitepoint.com/react-useoptimistic-production-patterns-for-instant-ui-updates/) [fernandoux](https://www.fernandoux.com/en/wiki/techniques/optimistic-updates-rollback/). For the chat message, follow Superhuman: keep the message visible in a "Send failed" error state with a Retry button rather than deleting it [superhuman](https://help.superhuman.com/hc/en-us/articles/43485254948627-Failed-Sends) [github](https://github.com/TanStack/query/discussions/1268).

### The pessimistic-lite group (points adjustment with reason, QR check-in)

Both stay blocking, but **scope the spinner to the action button — do not gray out the surrounding UI.** The reasoning: a points/task adjustment carries a **required audit reason**, which signals the server is the source of truth and may reject the write; and QR check-in requires the server to validate that the code is current/valid. Both are "server-side validation the client can't replicate," where an optimistic flash-then-revert is worse than a short wait [rohanshewale](https://rohanshewale.me/blog/2025/11/optimistic-ui-patterns/) [sitepoint](https://www.sitepoint.com/react-useoptimistic-production-patterns-for-instant-ui-updates/).

- **UX:** button shows a spinner and is disabled to prevent double-submit; the rest of the screen stays interactive. On failure, **keep the reason text intact**, re-enable the field, and show an **inline error** near the input (not a toast) [smashingmagazine](https://www.smashingmagazine.com/2022/08/error-messages-ux-design/) [github](https://github.com/TanStack/query/discussions/1268). *(Note: the "audit-reason field → pessimistic" call is inferred from server-validation guidance, not a source that names audit fields specifically — see gaps. If your points adjustments are purely client-authoritative and never rejected, you could make them optimistic like a toggle.)*

### The hard-blocking case (Stripe dues payment)

**Leave this exactly as a blocking mutation** — this is the one place your current pattern is correct. Follow Stripe's own guidance: disable the pay button on tap, show a loading spinner, prevent double submission, and show confirmation *only after* the server confirms [stripe](https://stripe.com/resources/more/mobile-checkout-ui) [stripe](https://docs.stripe.com/payments/build-a-two-step-confirmation). Never show a "paid" state optimistically.

---

## Handing this to an AI coding agent across ~30 call sites

Frame the refactor for the agent as three buckets, in this order:

1. **Build one shared optimistic helper in the hooks package** using `setMutationDefaults` per mutation key, so web and mobile inherit identical `onMutate`/`onError`/`onSettled` behavior [tanstack](https://tanstack.com/query/latest/docs/framework/react/guides/mutations). Wire `onlineManager` once in the Expo app .
2. **Convert the optimistic group** — instruct the agent to replace "full loading state + gray-out" with Pattern A (variables/`isPending`) for single-surface actions and Pattern B (cache snapshot + rollback) for reactions/pins/poll tallies, always cancelling queries first and adding a failure toast with retry. Add the `isMutating(...) === 1` guard on the two toggle hooks to prevent double-tap flicker [tkdodo](https://tkdodo.eu/blog/concurrent-optimistic-updates-in-react-query).
3. **Explicitly exclude** Stripe payment (keep blocking, disabled button) and the two pessimistic-lite hooks (scope spinner to button, inline error, preserve input) — tell the agent *not* to make these optimistic.

Give the agent the two code templates from Part 2 verbatim; they are the current v5 syntax and cover every call site you have.

---

## Where more research would sharpen this

Two points rest on inference rather than direct sources and would change specific recommendations if wrong: **(1) whether Signet's points/task adjustments are ever server-rejected** — if they're purely client-authoritative with no rejection path, they can safely become optimistic toggles rather than pessimistic-lite; the current "block it" call is a conservative default drawn from general server-validation guidance [rohanshewale](https://rohanshewale.me/blog/2025/11/optimistic-ui-patterns/). **(2) QR check-in's exact server contract** — if the code validity check is fast and rarely fails, an optimistic "checked in" with rollback is viable; if it's the app's attendance-integrity mechanism, keep it blocking. Neither gap blocks implementation — both are internal product decisions you can answer faster than any further web research could.