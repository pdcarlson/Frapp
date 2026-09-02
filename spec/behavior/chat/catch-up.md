# Chat catch-up — the chapter pulse artifact

The chat-first product removed the standalone `/home` dashboard; `/chat` is the post-sign-in
landing (see [`../../ui/web-dashboard/README.md`](../../ui/web-dashboard/README.md)). The value
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
*inside the handler*, below a `members:view` decorator, so reading the decorator alone gives the
wrong answer. (`/invoices/overdue` is the honest case: it declares `billing:view` on the route, and
`PermissionsGuard` merges route- and class-level lists.)

Where that `members:view` is declared differs per controller and is worth knowing before you go
looking for it: `TaskController` carries it at the **class** level, while `ServiceEntryController`
carries `@UseGuards(ChapterGuard)` + `@RequireModule('hours')` on the class and declares
`@UseGuards(PermissionsGuard)` + `@RequirePermissions(MEMBERS_VIEW)` on the **route**. Both end up
requiring it; only one shows it on the class.

Each gate below is therefore the *additional* permission beyond the `members:view` floor every one
of these routes already enforces. Every **seeded** role holds `members:view`, so on default
configuration the gate column is the whole answer.

Chapters can define custom roles with arbitrary permission sets, and `memberHasAnyPermission` is
exact-string matching plus `*` — there is no implicit grant. Two consequences an implementation must
handle rather than assume away: a member holding `tasks:manage` but not `members:view` would be
shown a figure they could not fetch themselves, and a chapter with a **member** lacking
`members:view` (someone in a "Pledge" or "Inactive" role) fails the entitlement test for *every*
signal in `#general`, so that chapter gets no pulse at all. **That is correct behavior, not a bug**
— the alternative is disclosing to someone the chapter deliberately restricted — but it means the
two-signal floor described below is a default-configuration statement, not a guarantee.

Note that entitlement is evaluated over **members who exist**, not roles that are defined. A
declared-but-unassigned role has no holders and so cannot suppress a signal.

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

**Resolve the channel's actual audience and check every member in it.** That is the whole rule, and
it is deliberately the same sentence as the principle above rather than a shortcut derived from it:

> Include signal `P` only if **every member who can currently read the channel** holds `P` or `*`.

Do **not** try to decide this by inspecting `required_permissions` alone. `canAccessChannel`
resolves a `ROLE_GATED` read as `required.some((permission) => permissions.includes(permission))` —
**any-of** — so the audience is bounded by the list's *broadest* entry, not its narrowest, and the
obvious `required_permissions.includes('billing:view')` check is exactly backwards. A channel
declared `['billing:view', 'members:view']` must **not** receive the dues signal: every seeded role
holds `members:view`, so it is readable chapter-wide.

Nor is the inverse — "every entry in `required_permissions` must equal `P`" — usable. Permissions
are exact strings with no implicit grant (`memberHasAnyPermission` is set membership plus `*`), so
that test admits only `[P]` or `['*']`, and would disqualify a sensible officers channel declared
`['tasks:manage','service:approve','billing:view']` from carrying *any* of those three signals. The
audience test handles that channel correctly: if the only members who can read it are officers
holding all three, all three signals qualify; if a treasurer holding only `billing:view` can read
it, the tasks and service sections drop for that channel and the dues section stays.

Resolving the audience composes two queries the API already has: the roster
(`MemberService.findByChapter`) and per-member permissions
(`RbacService.getEffectivePermissions`, or `flattenPermissionSets` over the chapter's roles for a
bulk pass). There is no single "audience of channel X" helper today. It is per-chapter and
per-channel — which is the point. Entitlement is a property of who is actually in the room, not of
how the channel was declared.

**The check is point-in-time, but the row is forever.** Entitlement is evaluated when the card is
posted; the `chat_messages` row stays readable afterwards under whatever access rules apply *then*.
Widening a channel's `required_permissions`, or moving a member into a role that can read it,
retroactively exposes every officer card already sitting in its history. Nothing in the current
schema expires or re-checks a posted card. An officers-channel implementation of open question 1
has to accept that (a channel whose audience only ever widens deliberately) or plan for it —
shorter-lived cards, or figures coarse enough that staleness defuses them.

Getting this backwards is a known bug class in this
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
signals have nowhere to go**, and the pulse in `#general` is at most a two-signal card (events, new
members) — fewer if the chapter has a custom role without `members:view`, per the note above. The
officer signals are omitted, never downgraded into a public channel.

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
is logged as a failure, while a zero is not.

The two rules deliberately share one *rendering* — the section is absent either way, and the reader
is never shown "0 invoices overdue" or an "Invoices unavailable" row. They must not share an
**operational** signal: a failed read logs a warning naming the signal, a zero logs nothing. The
observability side is where "quiet week" and "broken query" are told apart, and it is the only place
they can be. This is the posture the report-retention sweep takes in
[`../../../docs/internal/ops/DEPLOYMENT.md`](../../../docs/internal/ops/DEPLOYMENT.md) — a sweep that
silently reaps nothing must not look like a healthy one.

**If no section qualifies, no card is posted.** With rule 4 in place this falls out naturally: a
brand-new chapter, or a genuinely quiet week, produces nothing. A recurring "nothing to report" card
is how an artifact trains its audience to ignore it.

### The plain-text fallback, and where it actually comes from

The card's `content` string carries a readable sentence summarizing the same sections:

```text
This week: 2 events, 1 new member.
```

That example is the **`#general`** card, so it carries only the two `members:view` signals. An
officer-channel card would add the gated sections. Getting this wrong in the `content` string is the
same disclosure bug as getting it wrong in the payload — `content` *is* payload, and on most
surfaces it is the only part the reader sees.

It is **not** optional, but the mechanism is not the one a reader might assume.
`MessageRenderer` has a `default:` branch routing unknown kinds to `TextRenderer`, and that is a
real guard — but on web it is **unreachable for a genuinely new kind**, because
`packages/chat-core/src/types.ts` carries its own copy of the kind list behind `coerceKind`
(`find(k => k === kind) ?? "text"`), applied in `normalizeRow` before any renderer runs. An
unrecognized kind is rewritten to `text` upstream, so the row renders as its `content` — the same
user-visible outcome, by a different path.

That matters because **`CHAT_MESSAGE_KINDS` is declared in three places** and adding a kind means
adding it to all three:

| Declaration | Consumed by | Symptom if missed |
| --- | --- | --- |
| `apps/api/src/domain/entities/chat.entity.ts` | `@IsIn(...)` in `chat.dto.ts` — **the live send gate** | API rejects the send, loudly |
| `packages/validation/src/index.ts` | `SendChatMessageSchema`. Currently referenced by nothing but its own `z.infer` — it is the shared contract for non-Nest consumers, not an active gate | Nothing fails today; the shared contract silently diverges |
| `packages/chat-core/src/types.ts` | `coerceKind` in `normalizeRow` | Row arrives rewritten to `text`, so the renderer never fires no matter how correct it is |

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

Per-user dismissal wants `chat_message_actions`: already per-user, unique on
`(message_id, user_id, action_type)`, upsertable like a poll vote (ADR-07), no new table.

**But it is not private, and that matters here.** That table's `SELECT` policy is
`auth.role() = 'authenticated' AND can_read_chat_message(message_id)`, so every member who can read
the channel can read every action row on the message — `user_id` and `action_type` included — and
the web client already holds a global Realtime subscription on the table, so each dismissal
broadcasts live. "Who dismissed the chapter-health card" would become chapter-public and
attributable by name. That is the opposite of the posture [`README.md`](./README.md) takes for
personal gestures, where bookmarks are private to the bookmarker, not visible even to admins.

By this document's own rule — the row is the payload, and renderer-side hiding is not a control —
that has to be decided, not assumed. See open question 4.

Dismissal is per user per card either way, not a chapter-wide mute; a chapter-wide off switch is the
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
   pulse is at most a two-signal card. Options: seed a `ROLE_GATED` officers channel at onboarding
   (the audience test above then decides per signal, so a channel readable only by members holding
   all three carries all three); DM the officer sections to permission-holders; or accept a
   two-signal pulse. This decision should be made before #821 is promoted.
2. **Cadence.** Weekly is proposed. Daily is too noisy for a digest; monthly is too slow to act on.
3. **Surface parity.** Mobile has no chat timeline at all today (see #253) — `apps/mobile` reads no
   `chat_messages` anywhere. So mobile parity is not "add a renderer"; it is blocked on the mobile
   chat surface existing. Ship web-only first, or hold?
4. **Is a dismissal private?** `chat_message_actions` makes every dismissal readable by the whole
   channel (see above), which conflicts with how bookmarks are treated. Options: accept it as public
   (dismissing a digest is low-stakes); add a private store; or drop dismissal from v1 and rely on
   the metrics to tell us whether it is needed. Dropping it is the cheapest and loses least.

## Implementation follow-ups

Tracked separately so this spec can be accepted independently of any build:

- [#821](https://github.com/pdcarlson/Frapp/issues/821) — pulse aggregation service + weekly sweep (API).
- [#822](https://github.com/pdcarlson/Frapp/issues/822) — `pulse` card renderer (web).
- [#823](https://github.com/pdcarlson/Frapp/issues/823) — `pulse` card rendering on mobile.

## See also

- [`README.md`](./README.md#message-kinds-and-actions) — the kind registry this adds to.
- [`integrations.md`](./integrations.md) — slash-command catalog and renderer registry.
- [`../activity-feed.md`](../activity-feed.md) — the separate read-only activity aggregation.
