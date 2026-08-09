# Chat catch-up — the chapter pulse artifact

The chat-first product removed the standalone `/home` dashboard; `/chat` is the post-sign-in
landing (see [`../../ui/web-dashboard/screens.md`](../../ui/web-dashboard/screens.md)). The value
that dashboard carried — *chapter health at a glance* — was promised as an "inline chat artifact"
but never specified, so it has been homeless since the redesign. This file is that specification.

**Status: accepted design, unbuilt.** Nothing here ships until the follow-up issues are promoted.
The contract below is written so an implementation PR can be reviewed against it.

## The artifact

A **pulse card**: one server-originated chat message, `kind: "pulse"`, summarizing 3–5 chapter-health
signals with one action per signal. It is a *read-only aggregation* over data the chapter already
has — no new table, no new store, the same rule
[`../activity-feed.md`](../activity-feed.md) states.

It is deliberately **not** a dashboard rebuilt inside a message. A pulse card answers "what needs
me this week?", not "show me everything".

### Why `pulse` and not `health`

`health` is already taken, and by something meaningfully different: the `health` API module and
`GET /health` report **service liveness**, and
[`../observability.md`](../observability.md#metrics) draws an explicit line between "whether the
service is healthy" and "whether the product is working". A `kind: "health"` chat card would sit on
the wrong side of a distinction that spec already maintains. `pulse` is unambiguous in both places.

## Signals

Five signals, all backed by endpoints that exist today. A card renders a **subset** — see
composition below — never all five unconditionally.

| Signal | Source | Permission gate | Module gate |
| --- | --- | --- | --- |
| Events in the next 7 days | `GET /v1/events` | `members:view` | `events` |
| Members who joined since the last pulse | `GET /v1/members` | `members:view` | — (always on) |
| Open tasks past their due date | `GET /v1/tasks` | `members:view` | `tasks` |
| Service-hour entries awaiting approval | `GET /v1/service-entries` | `members:view` to see the queue, `service:approve` to act | `service` |
| Dues invoices past due | `GET /v1/invoices/overdue` | `billing:view` | `dues` |

Points are deliberately excluded. The points leaderboard is already a first-class surface and a
standing `points` card kind; restating it weekly adds noise without adding an action.

## Channel scoping — the load-bearing rule

**The payload is the security boundary, not the renderer.** A `chat_messages` row is readable by
everyone who passes `canAccessChannel` for its channel, so a card that *contains* a figure has
disclosed that figure to the channel's whole audience regardless of what any client chooses to
draw. Per-viewer filtering in a renderer is not a control.

Therefore a pulse card includes a signal only when **every member who can read the target channel**
is entitled to it:

- In `#general` (all members), only the `members:view` signals qualify — events, new members,
  overdue tasks.
- The `billing:view` signal qualifies only in a `ROLE_GATED` channel whose `required_permissions`
  imply it.

Consequence worth stating plainly: the always-present channels are `#general`, `#announcements`
(member-read), `#chapter-audit` (member-read) and DMs — **none of them is officer-only**. A chapter
that has not created a role-gated officers channel therefore gets the member-safe pulse and nothing
else. The dues signal is not silently downgraded into a public channel; it is omitted. Giving
officer figures a guaranteed home is an open question below, not something an implementation should
improvise.

## Composition

A section is dropped — never rendered as a zero — when any of these hold:

1. Its module is disabled for the chapter (`chapters.enabled_modules`).
2. The channel's audience is not entitled to it (above).
3. Reading it failed.

Rule 3 is the one that is easy to get wrong. "0 invoices overdue" and "could not read invoices" must
never render identically: a card that reports calm because a query threw is worse than no card. A
failed read omits the section and logs; it does not print a zero. This is the same posture the
report-retention sweep takes in [`../../../docs/internal/ops/DEPLOYMENT.md`](../../../docs/internal/ops/DEPLOYMENT.md)
— a sweep that silently reaps nothing must not look like a healthy one.

**If no section qualifies, no card is posted.** A weekly "nothing to report" card is how an artifact
trains its audience to ignore it, and a brand-new chapter would otherwise receive an empty pulse
before it has any data at all.

### The plain-text fallback is mandatory

`MessageRenderer` (`apps/web/components/chat/renderers/index.tsx`) routes unknown kinds to
`TextRenderer` on purpose, so a kind that ships server-first never blanks the timeline — and mobile
has no registry entry for a new kind at all. The card's `content` string is therefore the **actual
user-visible message** on every surface that has not shipped the renderer yet, exactly as
`event.service.ts` documents for event cards. It carries a readable sentence summarizing the same
sections, not a placeholder:

```text
This week: 2 events, 3 tasks overdue, 1 new member.
```

## Posting

Server-originated, using the mechanism the `event` / `task` / `points` cards already use:
`ChatService.sendMessage({ …, kind: 'pulse', system_originated: true })`, with `pulse` added to
`SERVER_ONLY_KINDS` so a client cannot forge one. No migration is required —
`chat_messages.kind` is an unconstrained `text` column.

Cadence is weekly, posted by a sweep in `apps/api/src/modules/scheduled-jobs/` following the
existing `@Cron` handlers. Those run on the server clock: there is no chapter-level timezone in the
schema (`quiet_hours_tz` is per-user, on `user_settings`), so a chapter-local posting time depends
on [#739](https://github.com/pdcarlson/Frapp/issues/739). Until that lands, a fixed weekly UTC tick
is the honest behavior and should be documented as such rather than described as "Monday morning".

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

A CTA points at a route the viewer may not be able to act in (the queue is visible at
`members:view`, approving needs `service:approve`). That is the existing behavior of every nav
entry and needs no new gate; the destination screen enforces its own permissions.

### Dismissal

Per-user dismissal rides `chat_message_actions`, which is already per-user and indexed on
`(message_id, user_id)` — a `dismiss` action, upserted like a poll vote. No new table. Dismissal is
per user per card, not a chapter-wide mute; a chapter-wide off switch is the module toggle.

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
`chapter_activation_milestones`: that table's unique `(chapter_id, milestone)` key encodes
"first time ever", which is the wrong shape for a recurring artifact.

The question they answer: does a pulse card change officer behavior, or is it wallpaper?
CTA-click-through per posted card is the primary signal; a dismissal rate that climbs week over week
is the kill signal. Instrumentation is deliberately out of scope for the first implementation PR —
it lands with the surface it measures, not before.

## Open questions for the owner

1. **Officer channel.** There is no default officer-only channel, so the `billing:view` signal has
   no guaranteed home (above). Options: seed a `ROLE_GATED` officers channel at onboarding, DM the
   pulse to permission-holders, or accept that dues never appears in the pulse.
2. **Cadence.** Weekly is proposed. Daily is almost certainly too noisy for a five-signal digest;
   monthly is too slow to be actionable.
3. **Surface parity.** Web renders the card and mobile falls back to `content` until a mobile
   renderer ships — acceptable for a first cut, or should both land together?

## Implementation follow-ups

Tracked separately so this spec can be accepted independently of any build:

- [#821](https://github.com/pdcarlson/Frapp/issues/821) — pulse aggregation service + weekly sweep (API).
- [#822](https://github.com/pdcarlson/Frapp/issues/822) — `pulse` card renderer (web).
- [#823](https://github.com/pdcarlson/Frapp/issues/823) — `pulse` card renderer (mobile).

## See also

- [`README.md`](./README.md#message-kinds-and-actions) — the kind registry this adds to.
- [`integrations.md`](./integrations.md) — slash-command catalog and renderer registry.
- [`../activity-feed.md`](../activity-feed.md) — the aggregation this artifact re-homes.
