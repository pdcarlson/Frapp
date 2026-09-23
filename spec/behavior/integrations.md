# Ops Integrations

Frapp's ops modules (Events, Tasks, Points, Dues, Rush, Backwork, Reports, Onboarding pathway) follow a single **modules-as-integrations** pattern with chat as the primary surface. This file is the canonical integration pattern shared by every module; per-module rules live in each module's own behavior file (e.g. [`events.md`](events.md), [`tasks.md`](tasks.md), [`points.md`](points.md), [`billing.md`](billing.md), [`rush.md`](rush.md), [`backwork.md`](backwork.md), [`reports.md`](reports.md), [`onboarding.md`](onboarding.md)).

## Integration Pattern

Each module is delivered as a consistent set of surfaces:

- **Slash command(s)** in chat — the primary way members create and act on the module's artifacts.
- **Rich message renderer** — one renderer per artifact type (`kind="<module>"`), keyed off the artifact `kind`. A module may register several (e.g. dues needs both `dues_invoice` and `dues_reminder`).
- **Optional dashboard surface** — a longer-form view (calendar, kanban, leaderboard) only when it materially adds value. The dashboard is always secondary to chat.

A module gets **no system channel of its own** (decided 2026-09-23, #576). This spec used to promise a `#<module>` channel per enabled module (`#events`, `#dues`, …), created on enable and muted on disable. It was dropped before any was built: nothing posted to such a channel, up to twelve paid modules would each have added an empty channel to every member's list, and removing channels already seeded in every chapter would take a destructive data migration. A module's cards land in the channel where its slash command ran, and its reminders go out as pushes or direct messages ([`notifications.md`](notifications.md)). The one system channel is `#chapter-audit` ([`chat/integrations.md`](chat/integrations.md#chapter-audit-system-channel-bridge)).

Chat-side actions go through the NestJS chat routes (`POST /v1/channels/:id/messages`, `POST /v1/channels/messages/:messageId/actions`) — the Edge Functions this section once named were retired by ADR-11 and `supabase/functions/` no longer exists. Heavy compute goes through NestJS RPC; the **client** posts a cache-only `kind="loading"` placeholder, which the Realtime echo of the server's card reconciles in place by `client_message_id`.

## Module Gating

- A module is enabled per chapter via the `enabled_modules` boolean map on chapter config. Free-tier modules are always-on in the sense the UI enforces: `alwaysOn` in `MODULE_CATALOG` locks their Settings toggle, though the config PATCH itself does not yet reject disabling one. Every other module is enabled **unless** `enabled_modules[key]` is explicitly `false` — absence is not disablement — and each archetype seed writes an explicit value for every key at chapter creation; the operations-heavy archetypes turn most paid modules on, while `honor` and `colony` deliberately do not.
- Module state is **always read from chapter config, never from a `window.*` global**. Renderers, dashboards, and RPC payloads import their state and helpers from ES modules — no module state is hung off `window`.
- Disabling a module immediately hides its nav item (gated on `isModuleEnabled`) and removes its slash commands from the chat palette. Its data and the messages it posted are kept, so re-enabling restores it.

## Actor Identity

- Every action button (RSVP, Done, Vote, Pay, Confirm, Grant points, Submit hours, etc.) attributes the actor from the **authenticated session** (`viewer.id` / `req.user.id`). A client-supplied actor id is never trusted.

## Viewer-Scoped Filters

- A filter keyed on "me" / "mine" / "assigned to me" **actually filters by `viewer.id`**, compared against the relevant field (`hostId`, `assigneeId`, `participants`, etc.). A "mine" filter that returns everything is forbidden — it must return only items where the viewer holds the relevant role.

## Aggregation Guards

- **Denominator guards:** every percentage / progress renderer (check-in progress, task completion, points-to-quota, dues collected) wraps its division as `denominator > 0 ? n / d : 0` before producing a width or displayed fraction.
- **First-match fallbacks:** `find` / first-match lookups (upcoming-event card, next-task widget, leaderboard top row) render an explicit empty-state card when the result is `undefined`, never dereference properties on `undefined`.
- **Outstanding-per-segment:** stacked / segmented bars compute outstanding per segment, never the raw amount. For dues, `outstanding = max(0, invoice.amount - (collected ?? paid ?? 0))` and segment width is `outstandingPlan / totalAmount`. Same rule applies to task burndown (outstanding count, not raw) and any other accumulating chart.
- **Dynamic column / row sources:** dashboard column and row keys (Tasks kanban columns, Rush funnel stages, Dues aging buckets, Onboarding pathway milestones) derive from chapter config or the workflow definition, never a hardcoded array.

## Audit-Write Triggers

- A module action that changes chapter state writes a row to `chapter_audit_log`, mirrored to `#chapter-audit` via the audit bridge. The invite-on-send and similar member-facing actions write member-visible audit rows. See [`settings/README.md`](settings/README.md) for the cross-cutting audit and `member_visible` rules.
