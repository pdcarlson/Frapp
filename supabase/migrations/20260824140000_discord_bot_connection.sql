-- The Discord bot connection (phase 3 of the migration tool).
--
-- Phases 1-2 built one way in: the admin runs DiscordChatExporter on their own
-- machine and their browser uploads the result. This adds a SECOND way in — a
-- single Signet-owned bot the chapter installs through Discord's ordinary "Add
-- to Server" OAuth flow, after which the API reads the history itself.
--
-- **Phase 2's upload path is not replaced and nothing here deletes it.** It
-- stays as the fallback for the day Discord throttles or refuses one shared bot
-- across every chapter, which is a real possibility at scale and not one we can
-- unwind quickly if the only path is gone. `discord_imports.source` is what
-- lets one job table serve both, and every downstream step — consent, channel
-- mapping, the role worksheet, the purge — is shared verbatim.
--
-- WHY THE ONLY PER-CHAPTER "CREDENTIAL" HERE IS A GUILD ID
--
-- The bot token is ONE global secret held by Signet (`DISCORD_BOT_TOKEN` in
-- Infisical, same shape as the Stripe keys — one value per environment, not one
-- per tenant). No chapter ever sees it, no admin ever pastes it, and nothing in
-- this schema stores it. What a chapter contributes is a guild id: a public
-- snowflake that is worthless on its own, because the bot only answers for a
-- guild it was actually installed into.
--
-- That is what makes the ROW below the tenant boundary rather than a hint, and
-- why it is written only by the OAuth callback after Discord itself has
-- confirmed two independent facts: that the bot was installed into that guild
-- (the guild object comes back on the token exchange, not from the redirect's
-- query string), and that the authorizing human holds Manage Server or
-- Administrator on it (read from `GET /users/@me/guilds` under their own
-- access token). Neither fact is taken from the browser.
--
-- THE CROSS-TENANT SHAPE THIS INTRODUCES, STATED PLAINLY
--
-- One bot process now holds read access to every connected chapter's Discord
-- history at once. That is a genuinely new risk surface and the reason the
-- import path re-derives the guild from the API on every slice instead of
-- trusting `discord_import_channels`: a channel row is only ever worked if
-- `GET /channels/{id}` reports it living in the guild THIS chapter connected.
-- See `discord-export-worker.service.ts`.
--
-- Every statement is guarded, so the file is re-runnable (`db push --local` is
-- treated as idempotent -- AGENTS.md § Gotchas).

-- ---------------------------------------------------------------------------
-- 1. The chapter ↔ guild mapping.
--
-- One connection per chapter (`unique (chapter_id)`), because an import names
-- no guild: it reads the chapter's connection. A chapter with two guilds would
-- make "which one" a question every caller has to answer, and the product has
-- no surface that asks it.
--
-- `guild_id` is deliberately NOT globally unique. Two chapters connecting the
-- same guild looks alarming and is not: each connection independently required
-- a human with Manage Server on that guild to complete the OAuth flow, and a
-- human with Manage Server can already export the whole guild by hand with
-- DiscordChatExporter. Uniqueness here would prevent nothing an attacker can
-- do and would break the legitimate case (a chapter re-created in Signet, an
-- umbrella org running two chapters out of one server). Do not add it under
-- the impression it is a tenant control — the tenant control is that the guild
-- is read through `chapter_id`, never supplied by a caller.
create table if not exists public.discord_connections (
  id         uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- The guild the bot was installed into, as Discord reported it on the token
  -- exchange. Snowflakes are up to 20 digits and are always handled as text —
  -- they exceed 2^53 and any JSON round trip through a number loses the low
  -- bits, which for a snowflake means a different guild.
  guild_id   text not null,
  guild_name text,
  guild_icon text,
  -- Who completed the OAuth flow, on both sides. The Signet user so the audit
  -- reads in product terms; the Discord user so an operator can tell which
  -- account's Manage Server was relied on. SET NULL matches `discord_imports`:
  -- account deletion must not be blocked by this row.
  connected_by uuid references public.users(id) on delete set null,
  connected_discord_user_id text,
  connected_discord_username text,
  -- The guild permission bitfield the authorizing user held at connect time,
  -- as a decimal string (Discord sends it as a string for the same 2^53
  -- reason). Recorded for the audit trail, NOT re-read as an authorization:
  -- permission was checked once, at connect, against Discord's own answer.
  -- A stale copy of a bitfield is not a permission check and must never be
  -- treated as one.
  authorizer_permissions text,
  -- What the bot was actually granted in the install, so an operator can tell a
  -- connection made under the current scopes from one made before they changed.
  granted_scopes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discord_connections_chapter_unique unique (chapter_id)
);

-- ---------------------------------------------------------------------------
-- 2. The OAuth state.
--
-- Discord's callback is an unauthenticated top-level browser redirect: it
-- carries no Signet session, no bearer token and no `x-chapter-id`, so the
-- chapter it belongs to has to be recoverable from the `state` parameter alone.
-- That makes `state` the single thing standing between a stray callback and a
-- guild being written onto the wrong chapter, and it therefore has to be
-- unguessable, single-use, and short-lived.
--
-- A row rather than an HMAC-signed blob, deliberately. A signed token needs a
-- new global secret to sign with (and there is no existing one whose reuse
-- would not be a smell), and it cannot be single-use without a store anyway —
-- which is the property that actually matters here, because a replayed
-- callback re-binds a guild. A row gives single-use for free: consuming it is
-- a conditional UPDATE, and the loser of a race sees zero rows.
--
-- The primary key IS the state value. It is a v4 uuid minted server-side and
-- never derived from anything the caller sent.
create table if not exists public.discord_oauth_states (
  id         uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- The admin who started the flow. The callback checks the guild's Manage
  -- Server against whoever authorized on Discord's side, and records this so
  -- the two identities are both in the audit trail.
  created_by uuid references public.users(id) on delete set null,
  -- Where to send the browser once the callback is done. Stored rather than
  -- taken from the callback query string, and validated against the configured
  -- app origin before it is written, so the callback cannot be turned into an
  -- open redirect by a crafted `state`.
  return_path text,
  expires_at timestamptz not null,
  -- Set when the callback consumes it. Non-null means spent: a second callback
  -- with the same state updates zero rows and is refused.
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- The consume path is `where id = $1 and consumed_at is null and expires_at >
-- now()`, which the primary key already serves. This index is for the sweeper
-- that reaps expired rows, so it stays off the hot path.
create index if not exists idx_discord_oauth_states_expiry
  on public.discord_oauth_states (expires_at)
  where consumed_at is null;

-- ---------------------------------------------------------------------------
-- 3. Which way the bytes came in.
--
-- 'upload' is the phase-2 DiscordChatExporter path and is the DEFAULT, so every
-- existing row keeps its meaning with no backfill. 'bot' is this phase.
--
-- The distinction is load-bearing in exactly two places — which worker slice
-- claims the job, and whether `start()` demands uploaded files — and load-
-- bearing nowhere else. Consent, channel mapping, the role worksheet and the
-- purge do not branch on it, which is the point: this phase changes how bytes
-- get from Discord into Signet, not what happens to them afterwards.
alter table public.discord_imports
  add column if not exists source text not null default 'upload';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'discord_imports_source_check'
  ) then
    alter table public.discord_imports
      add constraint discord_imports_source_check
      check (source in ('upload', 'bot'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Per-channel resume, for the bot path.
--
-- The upload path resumes on `(cursor_part_index, cursor_message_index)`
-- because its unit of work is a JSON partition it can index into. The bot path
-- has no partitions: it walks one channel at a time, backwards, asking Discord
-- for the page BEFORE a snowflake. So its resume point is a snowflake, and it
-- belongs on the channel rather than on the job.
--
-- Putting it here rather than adding a second pair of job-level cursor columns
-- is what makes the walk robust to the channel list changing between slices: a
-- job-level index into a sorted list silently means a different channel if a
-- thread is archived mid-import, whereas a per-row cursor cannot be misread.
-- The row's existing `status` is then the whole work queue — the worker takes
-- the first channel that is not yet 'completed' or 'skipped'.
alter table public.discord_import_channels
  add column if not exists cursor_before_snowflake text;

-- Threads.
--
-- Discord threads are channels with their own ids and their own message
-- endpoints, and an archived thread is where a chapter's actual decisions
-- usually ended up — skipping them would quietly drop the best part of the
-- history. But Signet has no threads, and asking an admin to map 200 archived
-- threads one by one is not a mapping step, it is a punishment.
--
-- So a thread is discovered as its own row (it needs its own cursor and its own
-- message count) and INHERITS its parent's mapping decision. The wizard shows
-- only rows where this is null; the service propagates the parent's choice
-- across its threads when the admin answers. That keeps "asked, never
-- inferred" intact: the admin explicitly chose a destination for #general, and
-- a thread inside #general is part of #general — it is not a second
-- destination anyone was guessing at.
alter table public.discord_import_channels
  add column if not exists parent_discord_channel_id text;

-- Discovery order, pinned at discovery rather than derived at read time.
--
-- The worker's queue is "the first row that is not finished", so order only
-- decides what an admin sees and in what sequence history lands. Pinning it
-- keeps a thread listed directly under its parent instead of wherever its
-- snowflake happens to sort, and stops a later change to the sort key
-- reordering a half-finished import.
alter table public.discord_import_channels
  add column if not exists position integer not null default 0;

create index if not exists idx_discord_import_channels_order
  on public.discord_import_channels (import_id, position, discord_channel_id);

-- ---------------------------------------------------------------------------
-- 5. Default-deny RLS, matching every other table in this feature.
--
-- The API reads these on the service-role key, which bypasses RLS; a policy
-- would open a direct-PostgREST surface nothing needs. `discord_oauth_states`
-- in particular must never be readable by a client — its primary key IS the
-- CSRF token, so a SELECT on it is the whole attack.
alter table public.discord_connections enable row level security;
alter table public.discord_oauth_states enable row level security;
