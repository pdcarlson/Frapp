# Chat catch-up — the chapter pulse artifact

The chat-first product removed the standalone `/home` dashboard; `/chat` is the post-sign-in
landing (see [`../../ui/web-dashboard/screens.md`](../../ui/web-dashboard/screens.md)). The value
that dashboard carried — *chapter health at a glance* — was promised as an "inline chat artifact"
but never specified, so it has been homeless since the redesign. This file is that specification.

**Status: accepted design, unbuilt.** Nothing here ships until the follow-up issues are promoted.
The contract below is written so an implementation PR can be reviewed against it.

## The artifact

A **pulse card**: one server-originated chat message, `kind: "pulse"`, summarizing chapter-health
signals with one action per signal. It is a *read-only aggregation* over data the chapter already
has — no new table, no new store, the same rule [`../activity-feed.md`](../activity-feed.md) states
for the activity aggregation.

It is deliberately **not** a dashboard rebuilt inside a message. A pulse card answers "what needs me
this week?", not "show me everything".

### Why `pulse` and not `health`

`health` is already taken, and by something meaningfully different: the `health` API module and
`GET /health` report **service liveness**, and
[`../observability.md`](../observability.md#metrics) draws an explicit line between "whether the
service is healthy" and "whether the product is working". A `kind: "health"` chat card would sit on
the wrong side of a distinction that spec already maintains. `pulse` is unambiguous in both places.

## Signals

Five signals, all derived from data that exists today.

The **permission gate** is *who may be shown the figure*, not how the server obtains it. The sweep
runs server-side under `service_role` and can read anything; the gate is the disclosure rule, and it
is derived from what that viewer could obtain for themselves through the API. That distinction
matters because **two** of these endpoints — tasks and service entries — narrow their results
*inside the handler*, below a class-level `@RequirePermissions(members:view)`, so reading the
decorator alone gives the wrong answer. (`/invoices/overdue` is the honest case: it declares
`billing:view` on the route, and `PermissionsGuard` merges route- and class-level lists.)

Each gate below is therefore the *additional* permission beyond the class-level `members:view` that
every one of these routes already requires. Every seeded role holds `members:view`, so on default
configuration the gate column is the whole answer; a custom role granting `tasks:manage` without
`members:view` would be shown a figure it could not fetch itself.

| Signal | Source | Who may be shown it | Module gate |
| --- | --- | --- | --- |
| Events in the next 7 days | `GET /v1/events` | `members:view` | `events` |
| Members who joined since the last pulse | `GET /v1/members` | `members:view` | — (always on) |
| Open tasks past their due date, chapter-wide | `GET /v1/tasks` | **`tasks:manage`** | `tasks` |
| Service-hour entries awaiting approval, chapter-wide | `GET /v1/service-entries` | **`service:approve`** | **`hours`** |
| Dues invoices past due | `GET /v1/invoices/overdue` | `billing:view` | `dues` |

The three bolded gates are the non-obvious ones, and each is load-bearing:

- **Tasks.** `task.controller.ts` resolves `isAdmin` from `tasks:manage` and
  `task.service.ts` returns `findByAssignee(chapterId, userId)` for everyone else — a plain member
  can only ever see their own tasks, never a chapter-wide overdue count.
- **Service hours.** `service-entry.controller.ts` does the same against `service:approve`, with the
  comment "Non-admins only ever see their own history". The approval *queue* therefore requires
  `service:approve` to see at all, not merely to act on.
- **Module key.** The Service Hours module is `hours` in `MODULE_CATALOG`, enforced as
  `@RequireModule('hours')`. `service` is an *archetype* key and a nav-item id, not a module key —
  and `isModuleEnabled` is `enabledModules?.[key] !== false`, so a key that does not exist reads as
  **enabled**. Gating on `service` fails open and silently, which is worse than failing loudly.

Points are deliberately excluded. The points leaderboard is already a first-class surface and a
standing `points` card kind; restating it weekly adds noise without adding an action.

## Channel scoping — the load-bearing rule

**The payload is the security boundary, not the renderer.** A `chat_messages` row is readable by
everyone who passes `canAccessChannel` for its channel, so a card that *contains* a figure has
disclosed that figure to the channel's whole audience regardless of what any client chooses to draw.
Per-viewer filtering in a renderer is not a control.

A pulse card therefore includes a signal only when **every member who can read the target channel**
is entitled to it.

### Deciding entitlement correctly

For a `ROLE_GATED` channel the test is **not** "does `required_permissions` contain the permission".
`canAccessChannel` resolves a `ROLE_GATED` read as
`required.some((permission) => permissions.includes(permission))` — **any-of**. The audience is
bounded by the list's *broadest* entry, not its narrowest. The correct test is:

> Every entry in `required_permissions` must itself imply the signal's permission (holders of `*`
> are always entitled, so the wildcard never widens the audience beyond the entitled set).

A channel declared `['billing:view', 'members:view']` therefore does **not** qualify for the dues
signal, even though `billing:view` appears in the list: every seeded role holds `members:view`, so
the channel is readable chapter-wide. Getting this backwards is a known bug class in this
repo — `ALUMNI_CHANNEL_PERMISSION` in `@repo/validation` documents the same mistake, warning that
`members:view` is "exactly the value a chapter would put on a private `#exec-board`".

### There is no officer channel

`DEFAULT_CHANNELS` seeds **four** channels on every chapter: `#general` (`PUBLIC`),
`#announcements` (`PUBLIC`, read-only), `#chapter-audit` (`PUBLIC`, read-only), and `#alumni`
(`ROLE_GATED`, `required_permissions: ['members:view', 'alumni:post']`). Plus DMs.

**None of them is officer-only**, and `#alumni` is a trap: it is the only seeded `ROLE_GATED`
channel, so an implementation that picks a target by `type === 'ROLE_GATED'` will find it in every
chapter — and by the any-of rule above its audience is every member holding `members:view`, *plus*
former members in the Alumni role. It must never carry the officer signals.

The consequence is the central open question below, not something an implementation should
improvise around: **in a chapter that has created no role-gated officers channel, three of the five
signals have nowhere to go**, and the pulse in `#general` is a two-signal card (events, new
members). The officer signals are omitted, never downgraded into a public channel.

## Target channel

The pulse posts to **`#general`**, one card per chapter per cycle.

This is stated because every other rule here is conditioned on it, and the alternatives are actively
wrong: `#announcements` pushes to every member by default and is `is_read_only`, which would make a
weekly digest a weekly mandatory push whose CTAs sit in a channel nobody can reply in; and posting
one card per accessible channel would multiply the `pulse-posted` count and break the primary
metric below. If open question 1 is resolved by seeding an officers channel, the officer-gated
signals move there as a **second** card, and this section is what gets amended.

## Composition

A section is dropped — never rendered as a zero — when any of these hold:

1. Its module is disabled for the chapter (`chapters.enabled_modules`).
2. The channel's audience is not entitled to it (above).
3. Reading it failed.
4. It read successfully and the count is zero.

Rules 3 and 4 are separate on purpose, and the pair is the easiest thing here to get wrong. Rule 4
is why a quiet week produces no section rather than a `0`. Rule 3 is why a *broken* week also
produces no section — and the two must not be conflated in the other direction either: a failed read
is logged as a failure, while a zero is not. "0 invoices overdue" and "could not read invoices" must
never reach the same rendering *or* the same log line. This is the posture the report-retention
sweep takes in [`../../../docs/internal/ops/DEPLOYMENT.md`](../../../docs/internal/ops/DEPLOYMENT.md)
— a sweep that silently reaps nothing must not look like a healthy one.

**If no section qualifies, no card is posted.** With rule 4 in place this falls out naturally: a
brand-new chapter, or a genuinely quiet week, produces nothing. A recurring "nothing to report" card
is how an artifact trains its audience to ignore it.

### The plain-text fallback, and where it actually comes from

The card's `content` string carries a readable sentence summarizing the same sections:

```text
This week: 2 events, 3 tasks overdue, 1 new member.
```

It is **not** optional, but the mechanism is not the one a reader might assume.
`MessageRenderer` has a `default:` branch routing unknown kinds to `TextRenderer`, and that is a
real guard — but on web it is **unreachable for a genuinely new kind**, because
`apps/web/lib/chat/types.ts` carries its own copy of the kind list behind `coerceKind`
(`find(k => k === kind) ?? "text"`), applied in `normalizeRow` before any renderer runs. An
unrecognized kind is rewritten to `text` upstream, so the row renders as its `content` — the same
user-visible outcome, by a different path.

That matters because **`CHAT_MESSAGE_KINDS` is declared in three places** and adding a kind means
adding it to all three:

| Declaration | Consumed by | Symptom if missed |
| --- | --- | --- |
| `apps/api/src/domain/entities/chat.entity.ts` | `@IsIn(...)` in `chat.dto.ts` — **the live send gate** | API rejects the send, loudly |
| `packages/validation/src/index.ts` | `SendChatMessageSchema`. Currently referenced by nothing but its own `z.infer` — it is the shared contract for non-Nest consumers, not an active gate | Nothing fails today; the shared contract silently diverges |
| `apps/web/lib/chat/types.ts` | `coerceKind` in `normalizeRow` | Row arrives rewritten to `text`, so the renderer never fires no matter how correct it is |

The middle row is the dangerous one precisely *because* nothing fails: skipping it ships a divergence
that only bites a future consumer.

## Posting

Server-originated, using the mechanism the `event` / `task` / `points` cards already use:
`ChatService.sendMessage({ …, kind: 'pulse', system_originated: true })`, with `pulse` added to
`SERVER_ONLY_KINDS` so a client cannot forge one. No migration is required —
`chat_messages.kind` is an unconstrained `text` column.

Cadence is weekly, posted by a sweep in `apps/api/src/modules/scheduled-jobs/` following the
existing `@Cron` handlers and their per-chapter failure isolation. Those run on the server clock in
UTC: there is no chapter-level timezone in the schema (`quiet_hours_tz` is per-user, on
`user_settings`), so a chapter-local posting time depends on
[#739](https://github.com/pdcarlson/Frapp/issues/739). Until that lands the honest behavior is a
fixed weekly UTC tick, and it should be documented as such rather than described as "Monday
morning".

## Actions

Each rendered section carries exactly one CTA into the module that owns it — the "bridge from chat
into paid ops modules" this artifact exists to create:

| Section | CTA | Destination |
| --- | --- | --- |
| Events this week | View schedule | `/events` |
| Overdue tasks | Open tasks | `/tasks` |
| Awaiting approval | Review queue | `/service` |
| Overdue dues | Review invoices | `/billing` |
| New members | View directory | `/members` |

Because a section is only ever shown to viewers entitled to its figure, a CTA always leads somewhere
the viewer can act. The destination screen still enforces its own permissions.

### Dismissal

Per-user dismissal rides `chat_message_actions`, which is already per-user and unique on
`(message_id, user_id, action_type)` — a `dismiss` action, upserted like a poll vote (ADR-07). No
new table. Dismissal is per user per card, not a chapter-wide mute; a chapter-wide off switch is the
module toggle.

## Success metrics

Measured through the existing analytics boundary
([`../observability.md`](../observability.md)), keyed by the chapter pseudonym, properties
content-free scalars only:

| Event | Recorded when | Properties |
| --- | --- | --- |
| `pulse-posted` | A card is posted | `sections`, `channel_type` |
| `pulse-cta-clicked` | A viewer follows a CTA | `section` |
| `pulse-dismissed` | A viewer dismisses a card | `sections` |

These are **not** activation-funnel milestones and must not be written to
`chapter_activation_milestones`: that table's unique `(chapter_id, milestone)` key encodes "first
time ever", which is the wrong shape for a recurring artifact.

The question they answer: does a pulse card change officer behavior, or is it wallpaper?
CTA-click-through per posted card is the primary signal; a dismissal rate that climbs week over week
is the kill signal. Instrumentation is deliberately out of scope for the first implementation PR —
it lands with the surface it measures, not before.

## Open questions for the owner

1. **Officer channel — the one that gates the artifact's value.** Three of the five signals
   (tasks, service, dues) are officer-gated, and no seeded channel can carry them, so the `#general`
   pulse is a two-signal card. Options: seed a `ROLE_GATED` officers channel at onboarding whose
   `required_permissions` are *all* officer-level; DM the officer sections to permission-holders; or
   accept a two-signal pulse. This decision should be made before #821 is promoted.
2. **Cadence.** Weekly is proposed. Daily is too noisy for a digest; monthly is too slow to act on.
3. **Surface parity.** Mobile has no chat timeline at all today (see #253) — `apps/mobile` reads no
   `chat_messages` anywhere. So mobile parity is not "add a renderer"; it is blocked on the mobile
   chat surface existing. Ship web-only first, or hold?

## Implementation follow-ups

Tracked separately so this spec can be accepted independently of any build:

- [#821](https://github.com/pdcarlson/Frapp/issues/821) — pulse aggregation service + weekly sweep (API).
- [#822](https://github.com/pdcarlson/Frapp/issues/822) — `pulse` card renderer (web).
- [#823](https://github.com/pdcarlson/Frapp/issues/823) — `pulse` card rendering on mobile.

## See also

- [`README.md`](./README.md#message-kinds-and-actions) — the kind registry this adds to.
- [`integrations.md`](./integrations.md) — slash-command catalog and renderer registry.
- [`../activity-feed.md`](../activity-feed.md) — the separate read-only activity aggregation.
