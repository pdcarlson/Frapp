# Master plan — chat-first redesign

> **You are reading the canonical context for the Frapp redesign.** Per-chunk briefs in `chunks/` reference this document by section. Don't skip ahead to a chunk without reading at least the *Product positioning* and *System architecture* sections here first.

## Context

A design bundle was handed off from claude.ai/design (`uUVhoSAtPSXszJas884LAw`) showing a comprehensive rethink of `apps/web`. **The design is not canonical.** After reviewing it, the product direction has shifted in three important ways that override the design's assumptions:

1. **Chat is the magnum opus, not a module.** The design treats chat as one of twelve modules. We're inverting that: chat is the spine of the app, and every other capability (events, tasks, dues, points, polls) is a *chat integration* — surfaced inline in conversation, not behind a separate nav tab. The mobile app especially opens directly into chat.
2. **Real free tier on chat.** Anyone can sign up, create a chapter, invite members, and chat — no Stripe gate. The paid tier gates the ops integrations (events with check-in, dues invoicing, points ledger, reports). This is the wedge.
3. **Customization runs deeper than an accent color.** Chapter colors theme the entire experience (sidebar, headers, chat bubble accents, message highlights — not just role chips). Onboarding autofills chapter identity from a Greek-life directory so a new officer types "Sigma Phi Epsilon @ UCLA" and gets Greek letters, designation, founded year, school short pre-filled.

Audience: **normal chapters across the full Greek spectrum** — IFC, NPC, NPHC, MGC, professional, service, honor, and pre-charter colonies. Customization is the product because every chapter runs differently.

The design bundle remains useful as a *visual* reference — the bone/bronze/ink palette, ledger-line motifs, eyebrow micro-labels, archetype catalog, and settings surface are all good. Chunk 1 copies it in-repo (`design-handoff/`) so future chunks can reference it.

---

## Product positioning

- **"Pick one thing to be perfect at" — chat.** Every UX decision routes through "does this make chat better?" Mobile lands on chat. Web's home is a chat catch-up. Ops events/tasks/dues exist primarily as inline chat artifacts.
- **Free tier**: unlimited chat, unlimited members, unlimited chapters. No credit card. Drives adoption among casual chapters who currently use GroupMe.
- **Paid tier ($/chapter/month)**: ops integrations unlock — events with QR check-in, points ledger, dues invoicing/Stripe collection, custom workflows, exports/reports, backwork library. 14-day trial on first activation.
- **Vocabulary-first**: rush vs recruitment vs intake; pledge vs aspirant vs candidate; class vs line vs cohort. Resolved per chapter, applied everywhere including chat channel names and slash-command labels.
- **Officer onboarding wizard with autofill**: first-officer flow is school search → chapter search → archetype confirm → invite members. Five minutes from signup to first chat message.
- **Member-visible audit log**: officer changes (dues, modules, roles) post into a `#chapter-audit` system channel that all members can read. Trust by default.
- **Full chapter theming**: chapter picks two colors (dark and accent). Sidebar tint, header band, message-accent stripe, mention pills, link colors, and reaction highlights all derive from those colors via a controlled palette generator (respects WCAG against bone background and ink sidebar).

---

## Architecture

### Chat as the spine

Chat is non-optional. It cannot be disabled. Every chapter has at minimum:
- `#general` — everyone, default landing
- `#announcements` — exec-write, member-read, push by default
- `#chapter-audit` — system-write only, member-read (audit log feed)
- DMs and group DMs — always on

When an ops module is enabled, it doesn't get a top-level nav tab first — it gets:
1. A slash command in chat (`/event`, `/task`, `/poll`, `/dues`, `/points`, `/hours`).
2. A rich message renderer that turns the artifact into an inline card with primary actions (RSVP / Done / Vote / Pay / Confirm / Submit).
3. A system channel where the module's notifications land (`#events`, `#dues`, etc.) so the firehose doesn't drown `#general`.
4. *Optionally*, a dashboard page for the longer-form view (calendar, ledger, kanban). The dashboard page is secondary to the chat experience, not primary.

Example: a treasurer types `/dues remind overdue` in `#general`. A rich card appears summarizing 4 overdue members with one "Send DM reminder" button per row. Tapping it sends a templated DM with a Pay button to each member. No tab-switching, no separate workflow.

Every module ships with: slash command(s), rich renderer, system channel, and an optional dashboard surface.

### Module catalog (revised)

- **Always-on (free)**: `chat`, `members` (directory + invites), `announcements`, `audit-log`, `chapter-settings`.
- **Paid integrations**: `events`, `tasks`, `points`, `hours`, `dues`/`billing`, `polls`, `rush`/`recruitment`/`intake`, `backwork`, `documents`, `reports`, `onboarding`-pathway, `geofences`.

Disabling a paid module hides its slash commands, mutes its system channel, and hides its dashboard page.

### Data model (DB-first)

New columns on `public.chapters`:
- `org_archetype text not null default 'ifc'` — `ifc | npc | nphc | mgc | professional | service | honor | colony`
- `enabled_modules jsonb not null default '{"chat":true,"members":true,"announcements":true,"audit-log":true}'`
- `vocabulary jsonb not null default '{}'`
- `branding jsonb not null default '{}'` — `{ greek_letters, designation, school_short, founded_at, colors: { dark, accent } }`
- `theme_palette jsonb not null default '{}'` — derived palette, regenerated on color change
- `directory_id uuid references chapter_directory(id)` — autofill source link, nullable
- `subscription_status` keeps existing enum but no longer gates chat / members / announcements
- `beta_config jsonb not null default '{"enabled":true,"style":"sidebar_pill"}'`

New tables (all `chapter_id` scoped, RLS via chapter membership):
- `chapter_directory` — `(id, org_letters, org_name, archetype, chapter_designation, university, university_short, founded_year, default_colors jsonb, website, source)`. Seeded from a curated CSV (top ~2000 US chapters MVP).
- `chapter_custom_fields` — `(id, chapter_id, key, label, type, required, visibility, sensitive, options jsonb, sort)`. `visibility ∈ {self, chapter, exec, president}`.
- `chapter_custom_roles` — `(id, chapter_id, key, label, rank, capabilities text[], core boolean)`.
- `chapter_workflows` — `(id, chapter_id, key, enabled, threshold int, params jsonb)`.
- `chapter_dues_config` — `(chapter_id PK, cadence, active_amount_cents, new_member_amount_cents, alumni_amount_cents, installments_allowed, late_fee_cents, grace_days, scholarship_pool_cents)`.
- `chapter_audit_log` — `(id, chapter_id, actor_user_id, action, target_type, target_id, scope, diff jsonb, created_at, member_visible boolean)`. Append-only. Mirrored to `#chapter-audit` channel.

Chat-spine tables (mostly exist; verify and extend):
- `chat_messages` gains `kind text not null default 'text'` — `text | event | task | poll | dues | points | hours | system_audit`. Plus `payload jsonb`, `client_message_id text`, `deleted_at`.
- `chat_messages.actions jsonb` for inline action button state (RSVPed, paid, voted).
- New `chat_message_actions` table for per-user action history per message.

### API surface (NestJS — cold path)

- `apps/api/src/modules/chapter-config/` — GET/PATCH chapter config (merged archetype defaults + chapter overrides). Every PATCH writes audit row and posts to `#chapter-audit`.
- `apps/api/src/modules/chapter-directory/` — search endpoint `GET /chapter-directory/search?q=...&university=...`.
- `apps/api/src/modules/chat/` — REST backfill only: `GET /chat/channels/:id/messages?since=<id>` for reconnect replay. Hot inserts do NOT live here.
- `POST /chapters/:id/theme-palette` — recomputes derived palette from `branding.colors`. Returns the full token map for the client to cache.

### Client state

- `packages/org-archetypes/` (TypeScript port of `design-handoff/project/org-config.jsx`) exporting `ARCHETYPES`, `MODULE_CATALOG` (revised), `ROLE_PACKS`, `CUSTOM_FIELDS_SEED`, `WORKFLOWS_SEED`, `VOCABULARY_DEFAULTS`. Shared by web, mobile, API.
- `packages/chapter-theme/` exporting `derivePalette({dark, accent})` (returns full token map; validates WCAG; falls back to bronze for failing tokens only).
- `packages/chat-integrations/` exporting slash-command schemas and rich-message renderer registry.
- New hooks: `apps/web/lib/hooks/{use-org-config.ts,use-chapter-theme.ts}`.
- New helper: `apps/web/lib/vocabulary.ts` — `vocab(key, chapterConfig)`.
- Existing `useChapterStore` and `chapter-bootstrap.tsx` unchanged (the wizard in Chunk 3 replaces the latter).

### Module gating

`nav-config.ts` gets `module` field per item. New `<ModuleGatedNavItem>` checks `orgConfig.modules[item.module]`. Items hidden when module off — never disabled-greyed. Slash commands in chat are also filtered through the same gate.

---

## System architecture for the chat hot path

Chat is the spine, so the architecture is biased for chat latency, reliability, and offline tolerance. The current stack (NestJS REST + Supabase Postgres/Realtime/Storage + Stripe + Expo Push) is the right *shape*, but the request routing splits.

**Hot path vs cold path.** Two write paths, two latency budgets:
- **Hot (chat)**: send message, add reaction, RSVP/vote/pay/confirm an inline card, presence/typing. Budget: <100ms p50, <300ms p99. Optimistic on client, eventually consistent on server.
- **Cold (admin/ops)**: chapter config changes, Stripe webhooks, exports, reports, bulk member imports, audit log writes. Budget: <2s. Strongly consistent, full validation.

**Routing.** Chat hot path bypasses NestJS:
- `POST /chat/messages`, `POST /chat/messages/:id/reactions`, `POST /chat/messages/:id/actions`, `PATCH /chat/channels/:id/read-cursor` → **Supabase Edge Functions** (Deno, deployed close to users). Edge function does Zod validation, RLS-trusted insert, Realtime broadcast.
- Everything else stays in NestJS where guards, DTOs, and test infrastructure already live.

**Realtime channels.**
- **Messages**: Supabase Postgres Changes on `chat_messages` filtered by `chapter_id` + subscribed channels.
- **Reactions + action state**: Postgres Changes on `chat_message_actions`.
- **Typing + presence**: Supabase Realtime Broadcast (ephemeral, not DB-backed).
- **System notifications**: NestJS-side trigger on `chapter_audit_log` insert → posts `system_audit` message → Postgres Change → render in `#chapter-audit`.

**Optimistic updates everywhere on hot path.** TanStack Query `onMutate` writes the optimistic message/reaction/RSVP into cache immediately; `onError` rolls back with a toast. Realtime broadcast eventually reconciles by client-generated UUID (idempotent merge).

**Offline-first composer (mobile + web).**
- Drafts persist in IndexedDB (web, via Dexie) and AsyncStorage/SQLite (mobile).
- Outbound message queue persists between sessions. Each queued message has a client-generated UUID; on reconnect, queue flushes in order; Edge Function dedupes on `client_message_id`.
- Inbound message cache: last N messages per channel. On reconnect, request "messages since last cursor" backfill before resubscribing to Realtime.

**Reconnection.** Websocket drops are assumed:
- Exponential backoff (1s → 30s).
- On reconnect: read last-seen message ID per channel, REST backfill, then resubscribe to Realtime.
- Unobtrusive "Reconnecting…" pill near the channel header.

**Slash command dispatch.**
- Simple commands (`/poll`, `/announce`) → Edge Function `chat-send` with `kind="poll"|"announcement"`. One round-trip.
- Heavy commands (`/dues remind overdue`) → NestJS RPC. Client inserts a `kind="loading"` placeholder card optimistically; NestJS computes, replaces card via Realtime.

**Push notification rules** (presence-aware):
- Don't push a user who is online in the affected channel right now.
- Don't push `#chapter-audit` unless explicitly subscribed.
- Bundle bursts: 3+ msgs/60s from one sender → one push.
- Per-channel notification preferences (all / mentions / off), defaulted by channel kind.

**Schema for high-volume chat.**
- `chat_messages` indexed on `(chapter_id, channel_id, created_at desc)`. Partition by `chapter_id` if/when we exceed ~100M rows globally.
- `chat_message_actions` indexed on `(message_id, user_id)` and `(user_id, action_type, created_at desc)`.
- `chat_messages.client_message_id` unique per `(chapter_id, sender_id, client_message_id)` (partial: where `client_message_id is not null`) for idempotent retries.
- Soft-delete only (`deleted_at`). Hard-delete is admin-only cold-path.

**File attachments.** Supabase Storage with signed URLs. Pre-signed upload from client → direct PUT to Storage → callback to Edge Function to attach storage path to message.

**Architecture decisions to record in `spec/architecture.md` (added in Chunk 2):**
- "Why we split chat to Edge Functions." (latency + scale)
- "Why Broadcast for presence/typing." (ephemeral, no DB load)
- "Why optimistic + idempotent client UUIDs." (UX + retry safety)
- "Why presence-aware push." (notification health)

---

## Chapter directory & onboarding wizard

The chapter directory is the wedge that makes signup feel pro. The wizard:

1. **Sign up** — email or OAuth.
2. **Find your chapter** — type school + chapter. Autocomplete from `chapter_directory`. If found: pre-fill step 4. If not found: skip to step 3 for manual entry.
3. **Pick your archetype** — 4-card grid. Pre-selected from directory match if available.
4. **Confirm identity** — Greek letters, designation, school short, founded year, colors. All editable, all pre-filled.
5. **Invite members** — bulk email or share invite link. Skippable but heavily encouraged.

Total time: under 90 seconds for a chapter that exists in the directory. End state drops the officer into `#general` with a system message: "Welcome to ΣΦΕ California Eta. Invite your chapter to get the conversation started."

Subsequent officer-onboarding (enable paid modules, configure dues, set workflows) is *not* mandatory. Exposed as inline nudges in `#chapter-audit` and a dismissible "Set up ops" card on the home/chat landing.

---

## Theming model

`branding.colors = { dark, accent }`. Two colors only. `derivePalette()` returns:
- `--side-bg`: dark tinted toward ink (mix 70% chapter-dark + 30% neutral ink for legibility)
- `--side-accent`: accent
- `--brand-band`: accent at low saturation for header strips
- `--mention-bg`, `--mention-fg`: derived from accent with contrast guarantees
- `--chat-self-bubble`: accent at 8% over bone
- `--reaction-active`: accent
- `--ring`: accent

WCAG validation against both bone (light) and ink (dark) backgrounds. If either fails AA 4.5:1, fall back to bronze for *that token specifically* (not the whole palette).

Theme is rebuilt server-side on color change and cached in `chapters.theme_palette`. Client reads from `useChapterTheme()` and writes CSS variables on `:root` per chapter switch.

---

## Engineering principles (apply to every chunk)

The claude.ai/design prototype under `design-handoff/` is a **visual** reference — its internal code has hardcoded ids, missing fallbacks, non-semantic interactives, NaN-prone inputs, and other defects that exist because it was a static mock-up. **Do not reproduce them in the real implementation.** The principles below codify the corrections every chunk must honor.

### Identity and ownership

- **Actor identity always comes from the authenticated session.** Reactions, message actions, RSVPs, votes, audit rows — every write attributes the actor via `viewer.id` (or the server-side `req.user.id`), never a hardcoded literal. The prototype's `"u_05"` reaction owner is the canonical anti-pattern here.
- **Filters keyed on "me" / "mine" / "assigned-to-me" actually filter** by `viewer.id` against the right field (`hostId`, `assigneeId`, `participants`, etc.). They never short-circuit to `return true`.

### Catalog lookups and defaults

- **Every lookup against `ARCHETYPES`, `MODULE_CATALOG`, `ROLE_PACKS`, etc. guards for a missing key with a defined fallback** (typically the `ifc` archetype / the always-on module set / the archetype-default role pack). Direct subscript like `ARCHETYPES[org.archetype]` without a fallback is forbidden.
- **Components that render derived columns or rows from a configurable source pull from that source at render time.** Permission matrices, kanban columns, dashboard tabs, etc. derive their column/row key list from the active `pack.roleKeys` (or equivalent) — never a hardcoded local array.

### Seeds and shared state

- **Materializing a chapter's config from seed data deep-clones.** `[...CUSTOM_FIELDS_SEED]` and similar shallow spreads share object references with the seed, so per-chapter edits leak globally. Use a deep clone (e.g. `structuredClone` or `JSON.parse(JSON.stringify(...))` for plain data) when copying `CUSTOM_FIELDS_SEED`, `ROLE_PACKS`, `WORKFLOWS_SEED`, or `VOCABULARY_DEFAULTS` into a chapter record.
- **No `window.*` globals for application state.** Use ES module imports/exports. (The prototype assigns components and seed data to `window` because it runs as static HTML; the real app must not.)

### Input handling

- **Numeric input change handlers guard-parse.** Replace `+e.target.value` with a check that the parsed value is a finite number (`Number.isFinite(parsed)`) before calling the setter. On invalid intermediate state, preserve the previous value rather than storing `NaN`.
- **Renderers that divide guard the denominator.** Progress bars, completion percentages, and similar widgets compute `denominator > 0 ? numerator / denominator : 0` before producing CSS / display values. The prototype's check-in progress bar (`checkedIds.size / attendees.length` with no zero guard) is the canonical anti-pattern.
- **`find` / `first` lookups treat `undefined` as a real state.** Components reading `EVENTS_SEED.find(...)`, `messages.find(...)`, etc. render an explicit fallback UI (empty state, "no upcoming events", "no matching item") when the result is `undefined` rather than dereferencing properties on it.

### Empty states

- **Every list surface has an explicit empty state.** Channels list with no channels → "No channels yet" panel with the next-action CTA, not a blank pane. Same for members directory, events list, tasks board, audit log, etc. The implementation explicitly checks `length === 0` (or `!active`) and renders the empty component.

### Accessibility on interactive elements

- **Interactive controls use semantic elements.** `<button>` for actions, `<a>` (or the framework's `Link`) for navigation. Never `<div onClick>` for a clickable nav row, message-action, settings tab, or list item.
- **Soft-disabled items use `aria-disabled="true"` and `tabIndex={-1}`.** Hard-disabled use the native `disabled` attribute on `<button>`. "Soon" / "coming-in-trial" items in the Modules tab are soft-disabled.
- **Root document layout sets `<html lang="en">`** (or the appropriate locale once internationalization is in scope).

### Aggregations in dashboards

- **Stacked/segmented bars use the outstanding portion of each segment, never the raw amount,** to avoid double-counting against an already-collected total. For dues: `outstanding = invoice.amount - (invoice.collected ?? 0)`, with a `Math.max(0, ...)` guard to clamp negative values. Same rule for points ledgers, task burn-downs, hours rollups, etc.

### Privacy in fixtures and seeds

- **No real identifiers in fixtures or seed data.** Test emails use `@example.com` / `@local.test`. Test names are generic / synthetic. The Greek-life chapter directory seed is the only exception — those are publicly listed chapter identities, not personal data.

### How to use this list

When you start a chunk, read this section. When you write a verification checklist for your PR, check this section. When you find yourself porting prototype code 1:1, stop and re-read this section. Every chunk brief under `chunks/` lists the chunk-specific applications of these rules; this section is the canonical statement of the rule itself.

---

## Chunked roadmap

Each chunk's full brief lives in `chunks/NN-<slug>.md`. The brief is self-contained for a fresh session. Summaries:

| #   | Title                                                          | Depends on    |
| --- | -------------------------------------------------------------- | ------------- |
| 01  | Foundation: design bundle + theme + shell                      | —             |
| 02  | Data model + chapter directory + org-config + Edge Function    | 01            |
| 03  | Onboarding wizard + chapter directory UX                       | 02            |
| 04  | Chat magnum opus — part 1: foundation + hot-path client        | 02 (03 helps) |
| 05  | Chat — part 2: rich messages + slash commands + push           | 04            |
| 06  | Settings shell + Org + Modules tabs                            | 02, 05        |
| 07  | Settings: Theme + Roles + Fields + Workflows + Dues            | 06            |
| 08  | Settings: Beta + Audit + ops-setup nudges                      | 07            |
| 09  | Members directory + custom fields rendering                    | 02, 07        |
| 10  | Ops integrations (10a Events → 10h Onboarding pathway)         | 05            |
| 11  | Mobile (Expo) chat parity with native-grade hot path           | 05            |
| 12  | Marketing site refresh + free tier signup CTA                  | 03            |

10a–10h can be parallelized across sessions once 05 is shipped.

---

## Critical files to reference during every chunk

- Design source of truth: `design-handoff/project/` (Chunk 1 lands it).
- Style tokens reference: `design-handoff/project/styles.css` (lines 1–200 = palette).
- Archetype catalog reference: `design-handoff/project/org-config.jsx`.
- Shell + nav reference: `design-handoff/project/shell.jsx`.
- Settings surface reference: `design-handoff/project/settings*.jsx`.
- Existing shell to replace: `apps/web/components/layout/dashboard-shell.tsx`.
- Existing settings to replace: `apps/web/components/settings/settings-page.tsx`.
- Theme to rewrite: `packages/theme/src/{globals.css,tokens.ts,tailwind.config.ts}`.
- Brand/UX spec to update alongside: `spec/ui-web-dashboard.md`, `spec/ui-brand-identity.md`, `spec/product.md`, `spec/architecture.md`.

Keep these utilities (do not rewrite):
- `packages/theme/src/accent.ts` — WCAG validation. Reused by `chapter-theme` package.
- `apps/web/lib/stores/chapter-store.ts` — active chapter ID. No change.
- `useMyPermissions()` + `<ProtectedNavItem>` — permission gating coexists with module gating.

---

## Verification per chunk

Each chunk's PR should include:
- Screenshots in light + dark mode for visual chunks.
- For data chunks: curl example hitting new endpoints with response.
- For settings/ops chunks: a checklist showing a test chapter can flip the relevant config and see it propagate through chat + dashboard within one reload.
- For Chunks 6+: validation across at least 2 archetypes (e.g. IFC and NPHC) to prove vocabulary substitution.
- Spec docs (`spec/ui-web-dashboard.md`, `spec/product.md`, `spec/architecture.md`) updated in the same PR per the repo's documentation rule.

---

## Open questions (not blocking)

- Chapter directory data acquisition: who curates the seed CSV? Likely a one-time scrape from NIC/NPC/NPHC/MGC websites + manual cleanup. Could be a Chunk 2 sub-task or its own micro-chunk.
- Pricing: chapter/month flat, or per-active-member metered? Affects how trials end. Worth a separate product conversation before Chunk 6.
- DM-only chapters: should users be able to use chat without joining a chapter (1:1 DMs)? Probably no for now — keeps the wedge focused.
- International chapters: vocabulary helper extends naturally; chapter directory seed needs intl coverage if/when relevant.
- Realtime backend: stay on Supabase Realtime indefinitely, or migrate to Ably/Pusher/Centrifugo if/when we exceed its limits? Re-evaluate after we have ~50 active chapters with real concurrency data.
- Edge Function cold-start budget: monitor p99 of `chat-send` after launch; if cold starts hurt p99, consider warming pings or a tiny always-on worker.
- Message search: full-text on `chat_messages.content` is fine at MVP via Postgres `tsvector`. Revisit when a chapter complains.
