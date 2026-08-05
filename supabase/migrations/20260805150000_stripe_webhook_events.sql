-- Durable Stripe webhook idempotency (FRA-23).
--
-- BillingService.handleWebhookEvent deduplicated deliveries with a process-local
-- `Set<string>` of Stripe event ids. That guard dies with the process: a Render
-- deploy, a crash, or a second API instance loses it, and Stripe's replay then
-- re-applies the same event.
--
-- FRA-242's `chapters.last_stripe_webhook_at` high-water mark does NOT cover
-- this. It deliberately treats two events sharing the same Stripe second as
-- not-stale (sub-second order is unknowable), and a redelivery carries the same
-- `event.created` as the mark it wrote — so the ordering guard passes it
-- through. Event-id dedup and event-time ordering are orthogonal; this table is
-- the former.
--
-- Bookkeeping only: no chapter_id, no FK, nothing member-visible. Rows are
-- written exclusively by the webhook path for the five event types that have
-- side effects; unhandled types never reach here, so the table stays bounded to
-- real billing traffic rather than every event on the Stripe account.

create table stripe_webhook_events (
  -- Stripe's `evt_...` id is the natural key and already unique per account.
  event_id     text        primary key,
  event_type   text        not null,
  status       text        not null default 'processing'
                 check (status in ('processing', 'processed', 'failed')),
  -- Bumped on every re-claim (a failed retry, or a takeover of a stale claim),
  -- so a poison event is visible as a climbing count rather than silence.
  attempts     integer     not null default 1,
  last_error   text,
  claimed_at   timestamptz not null default now(),
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Operational scan: "what is stuck or failing right now", newest first.
create index idx_stripe_webhook_events_status_claimed
  on stripe_webhook_events (status, claimed_at desc);

alter table stripe_webhook_events enable row level security;
-- No client policies: like chapter_directory_requests, this table is API-only
-- (service role). It is internal delivery bookkeeping, not member data, so
-- default-deny with zero policies is the whole access model.

-- ── claim_stripe_webhook_event ────────────────────────────────────────────
--
-- Compare-and-set claim, in one statement so concurrent deliveries serialize.
-- The caller claims BEFORE running side effects; claiming after would leave the
-- exact crash gap this migration exists to close.
--
-- Outcomes:
--   claimed           — caller owns this event and must process it
--   already_processed — a previous delivery completed it; skip
--   in_flight         — another worker holds a fresh claim; skip
--
-- Re-claim (`on conflict do update`) is allowed only for a row that previously
-- FAILED, or one left `processing` by a worker that died — detected by a claim
-- older than p_stale_seconds. Without that lease a mid-handler crash would wedge
-- the event forever, which is the original bug moved down a layer.
--
-- Concurrency: `insert ... on conflict do update ... where` takes a row lock and
-- re-evaluates the predicate under READ COMMITTED, so of N simultaneous
-- deliveries exactly one updates a row; the rest match zero rows, report
-- in_flight, and return without touching billing state.
--
-- `security invoker` (matching apply_invoice_payment): the API always calls this
-- through the service-role SUPABASE_CLIENT, which bypasses RLS. If a caller is
-- ever routed through a user/anon client, the write to this RLS-protected table
-- would be denied — switch to `security definer` + `set search_path = public`
-- before doing so.
--
-- OUT parameters are prefixed `claim_` rather than reusing the column names:
-- a plpgsql OUT variable sharing a name with a column of the table being
-- updated makes every unqualified reference ambiguous.
create or replace function claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_stale_seconds integer
)
returns table (claim_outcome text, claim_attempts integer)
language plpgsql
security invoker
as $$
declare
  v_row stripe_webhook_events;
begin
  insert into stripe_webhook_events as swe (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do update
     set status       = 'processing',
         attempts     = swe.attempts + 1,
         claimed_at   = now(),
         last_error   = null,
         processed_at = null
   where swe.status = 'failed'
      or (swe.status = 'processing'
          and swe.claimed_at < now() - make_interval(secs => p_stale_seconds))
  returning * into v_row;

  if found then
    return query select 'claimed'::text, v_row.attempts;
    return;
  end if;

  -- Lost the claim. Re-read to tell "done" apart from "someone else has it".
  select * into v_row from stripe_webhook_events where event_id = p_event_id;

  if v_row.status = 'processed' then
    return query select 'already_processed'::text, v_row.attempts;
  else
    return query select 'in_flight'::text, v_row.attempts;
  end if;
end;
$$;

-- This RPC gates whether a billing side effect runs, and its authorization
-- (Stripe signature verification) lives in the NestJS webhook path, not in
-- table RLS. Lock EXECUTE to the service role the API uses so it can't be
-- called directly via PostgREST by an `anon`/`authenticated` user. Postgres
-- grants EXECUTE to PUBLIC by default, and Supabase's default privileges
-- additionally grant it straight to anon/authenticated — so all three must be
-- revoked, not just PUBLIC.
revoke execute on function claim_stripe_webhook_event(text, text, integer) from public;

-- anon/authenticated/service_role are Supabase-managed roles, absent in bare
-- Postgres substrates (e.g. PGlite in CI), so guard each on role existence to
-- keep the migration portable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function claim_stripe_webhook_event(text, text, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function claim_stripe_webhook_event(text, text, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_stripe_webhook_event(text, text, integer) to service_role;
  end if;
end
$$;
