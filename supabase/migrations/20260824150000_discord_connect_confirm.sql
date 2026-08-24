-- The Discord connect CONFIRMATION step.
--
-- WHAT WAS WRONG
--
-- `20260824140000` bound a guild to a chapter the moment Discord's callback
-- came back clean. Both facts it checked were real and correctly sourced -- the
-- guild came off the token exchange, and Manage Server was read from
-- `GET /users/@me/guilds` under the authorizing human's own token -- but between
-- them they prove only this:
--
--     "a human with Manage Server installed the Signet bot into guild G."
--
-- They do NOT prove:
--
--     "that human intended CHAPTER X to read guild G."
--
-- The chapter came from the `state` row alone, and minting a state is an
-- ordinary permitted action for any `channels:manage` holder in any tenant. So
-- an attacker could self-serve a chapter, call `POST /v1/discord/connect`, send
-- the resulting authorize URL to an admin of any Discord community, and -- if
-- that person clicked through Discord's genuine consent screen for the genuine
-- Signet app -- end up reading that community's entire history into their own
-- chapter. Discord's screen names Signet; it does not name the chapter, so
-- there was no point at which the victim could have seen what they were
-- agreeing to.
--
-- Two independent reviewers found this before merge. It is a confused-deputy
-- bug, not a broken check.
--
-- WHAT FIXES IT, AND WHY THIS PARTICULAR SHAPE
--
-- The callback no longer writes `discord_connections`. It parks what it learned
-- on the state row as a PENDING connection and mints a second one-time secret,
-- the confirm token, which is handed to exactly one place: the query string of
-- the redirect that the browser which completed the OAuth follows. Activation
-- then requires an ordinary authenticated request that presents that token AND
-- whose `x-chapter-id` matches the chapter the pending row names.
--
-- Replay the attack against it:
--
--   * The attacker minted the state, so they know it -- and it buys nothing,
--     because the state is spent by the callback and is not what activates.
--   * The confirm token went to the VICTIM's browser. The attacker never sees
--     it, and it is a v4 uuid, so it cannot be guessed.
--   * The victim's browser does present it -- against the victim's own session,
--     whose active chapter is not the attacker's. The chapter check refuses,
--     and nothing is written.
--
-- For the legitimate admin nothing changes but one automatic round trip: they
-- started the flow in their own chapter, so their session and the pending row
-- agree and the dashboard confirms on arrival without asking them anything.
--
-- Every statement is guarded, so the file is re-runnable (`db push --local` is
-- treated as idempotent -- AGENTS.md § Gotchas).

-- ---------------------------------------------------------------------------
-- 1. The pending connection.
--
-- Parked on `discord_oauth_states` rather than in a table of its own. A pending
-- connection has exactly the lifetime of the handshake that produced it, is
-- meaningless without the row that names its chapter, and must die with it --
-- three properties a separate table would have to re-establish with a foreign
-- key and a cascade, to hold at most one row per handshake.
--
-- Every column here is written by the callback from Discord's own answers, and
-- never from anything the browser sent.
alter table public.discord_oauth_states
  add column if not exists pending_guild_id text,
  add column if not exists pending_guild_name text,
  add column if not exists pending_guild_icon text,
  add column if not exists pending_discord_user_id text,
  add column if not exists pending_discord_username text,
  add column if not exists pending_permissions text,
  add column if not exists pending_scopes text;

-- ---------------------------------------------------------------------------
-- 2. The confirm token.
--
-- A SECOND secret, deliberately -- not the state re-used. The state is known to
-- whoever started the flow, which in the attack is the attacker; this one is
-- created after the callback and delivered only to the browser that completed
-- it. Re-using the state would leave the hole exactly where it was.
--
-- v4 uuid from `gen_random_uuid()`, minted server-side, never derived from
-- anything a caller sent -- the same properties the state itself relies on.
alter table public.discord_oauth_states
  add column if not exists confirm_token uuid;

-- Its own expiry, and a much shorter one than the handshake's.
--
-- The 15-minute state TTL covers a human reading Discord's consent screen and
-- getting through 2FA. This window covers a redirect the browser follows
-- immediately, so anything beyond a couple of minutes is a pending guild
-- sitting activatable for no reason.
alter table public.discord_oauth_states
  add column if not exists confirm_expires_at timestamptz;

-- Set when the pending connection is activated. Non-null means spent: a second
-- confirm with the same token updates zero rows and is refused, exactly as
-- `consumed_at` does for the state.
alter table public.discord_oauth_states
  add column if not exists confirmed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. The confirm lookup.
--
-- `confirm_token` is the whole predicate -- the request presents it and nothing
-- else identifying. UNIQUE rather than a plain index, because two rows sharing
-- one would make "the pending connection this token names" ambiguous, and the
-- resolution of that ambiguity would decide which chapter gets a guild.
--
-- Partial, so the many rows that never reach the callback (an abandoned
-- handshake, a denied consent) stay out of it entirely.
create unique index if not exists idx_discord_oauth_states_confirm_token
  on public.discord_oauth_states (confirm_token)
  where confirm_token is not null;
