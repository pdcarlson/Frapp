-- The AI usage ledger and its caps (#714; ADR-28 decision 1,
-- spec/behavior/billing.md § AI Usage Pricing).
--
-- One row per provider call the AI gateway makes. The row is written in two
-- steps:
--
-- 1. `reserve_ai_spend`, before the call: the call's worst-case cost (its
--    estimated input plus its whole output ceiling, at the catalog's prices)
--    is held against three caps in one transaction, and the row is inserted
--    as `reserved` only if all three still have room:
--    - the chapter's monthly cap (the calendar month in UTC);
--    - the acting member's daily cap in that chapter (the day in UTC), so one
--      member, or one runaway script, can't spend the chapter's month;
--    - the platform's monthly cap for the provider, across every chapter, so a
--      bug can't spend past Frapp's provider account.
-- 2. `settle_ai_spend`, after the call, before the gateway returns: the real
--    token counts and cost replace the hold.
--
-- What a row counts toward a cap is its settled cost, or its hold while it
-- has none (reserved, or expired: a process that died mid-call may still have
-- been billed). Spend is always a sum over this table: there is no balance
-- column anywhere (billing.md § Implementation invariants).
--
-- The caps' values are the API's (environment variables, `config/ai-spend-
-- config.ts`), passed in on every call, so changing one needs no migration and
-- a later per-chapter cap (#1310) is a different argument, not a new table.
--
-- No text column, and there must never be one (spec/behavior/ai.md § Stored AI
-- text): who, which task, which model, the prompt's version, counts and cost.
--
-- RLS is on with no policies: the API reads and writes with the service role.

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- The acting member (spec/behavior/ai.md § Whose access an AI run uses).
  -- Deleting an account tombstones the users row in place (`anonymize_user`),
  -- so the row keeps pointing at a user with no name or email left; set null
  -- only covers a hard delete. The spend stays with the chapter either way.
  user_id uuid references public.users(id) on delete set null,
  -- The background run the call belongs to, if any. Runs are pruned after 90
  -- days; the spend is kept.
  run_id uuid references public.ai_runs(id) on delete set null,
  -- The catalog task (`minutes.draft`) and its consent family.
  task text not null check (task ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  family text not null check (family in ('meetings', 'ask', 'corpus')),
  -- The adapter that answered: `scripted` in scripted mode, costed at the
  -- catalog's prices so a local run exercises the caps.
  provider text not null check (provider in ('anthropic', 'google', 'scripted')),
  model text not null check (char_length(model) between 1 and 100),
  -- `<feature>@vN`, as the caller sent it. A version, not a prompt.
  prompt_version text not null check (char_length(prompt_version) between 1 and 100),
  status text not null default 'reserved'
    check (status in ('reserved', 'settled', 'expired')),
  -- How the call ended. Set when settled.
  outcome text check (outcome in ('completed', 'refused', 'invalid_output', 'error')),
  error_kind text check (char_length(error_kind) <= 40),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  -- Millionths of a US dollar. The hold, then the settled cost.
  reserved_cost_micro_usd bigint not null check (reserved_cost_micro_usd >= 0),
  cost_micro_usd bigint check (cost_micro_usd >= 0),
  -- True when the provider never said what the call used and the hold was
  -- charged instead (an abandoned stream, a timeout): see `settle_ai_spend`.
  cost_estimated boolean not null default false,
  latency_ms integer check (latency_ms >= 0),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint ai_usage_events_settled_shape check (
    (status = 'settled') = (outcome is not null and cost_micro_usd is not null and settled_at is not null)
  ),
  constraint ai_usage_events_error_kind_only_on_error check (
    error_kind is null or outcome = 'error'
  )
);

alter table public.ai_usage_events enable row level security;

comment on table public.ai_usage_events is
  'One row per AI provider call (#714, ADR-28 decision 1): who, which task and model, the prompt version, token counts and cost in micro-USD. No text. Reserved against the chapter, member and platform caps by reserve_ai_spend before the call, settled by settle_ai_spend after it. RLS on, no policies: the API reads and writes with the service role.';

-- The cap sums read only these three columns besides the key, so each index
-- carries them and a sum can be answered from the index alone.

-- The chapter's month, and the per-period usage query.
create index if not exists idx_ai_usage_events_chapter
  on public.ai_usage_events (chapter_id, created_at)
  include (status, reserved_cost_micro_usd, cost_micro_usd);

-- A member's day in a chapter.
create index if not exists idx_ai_usage_events_member
  on public.ai_usage_events (chapter_id, user_id, created_at)
  include (status, reserved_cost_micro_usd, cost_micro_usd);

-- A provider's month across every chapter.
create index if not exists idx_ai_usage_events_provider
  on public.ai_usage_events (provider, created_at)
  include (status, reserved_cost_micro_usd, cost_micro_usd);

-- The sweep that expires holds nobody settled.
create index if not exists idx_ai_usage_events_reserved
  on public.ai_usage_events (created_at)
  where status = 'reserved';

-- What a row counts toward a cap: its settled cost, or its hold.
create or replace function public.ai_usage_charge(
  p_status text,
  p_reserved bigint,
  p_cost bigint
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_status = 'settled' then coalesce(p_cost, 0) else p_reserved end;
$$;

-- Hold a call's worst-case cost against the three caps, or refuse it.
--
-- Returns one row. `reservation_id` is the new row's id when the hold was
-- granted, and null when it was refused, with `refused` naming the first cap
-- the hold would cross, checked in the order platform, chapter, member (the
-- widest first, so an outage of the provider pool reads as one, not as every
-- chapter's cap). A null cap is no cap. A cap is crossed when spend so far
-- plus the hold would exceed it; a hold that lands exactly on it is granted.
--
-- `platform_spent_before` and `platform_spent_after` are the provider's month
-- before and after this hold, for the API to alert as the pool fills.
--
-- Concurrent holds are serialized per chapter, then per provider, with
-- transaction advisory locks, always taken in that order so two holds never
-- wait on each other in a cycle. Two holds for the same chapter, or for the
-- same provider, can't both see room that only one of them fits in. With no
-- platform cap (scripted calls) the provider is neither locked nor summed,
-- and both spent figures come back 0.
--
-- Scale: every hold on a provider waits for the one before it, and each sums
-- the provider's month from `idx_ai_usage_events_provider`. That is a few
-- milliseconds at the beta's volume. When it is not, a per-provider, per-day
-- rollup kept in the same transaction replaces the month's scan.
create or replace function public.reserve_ai_spend(
  p_chapter_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_task text,
  p_family text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_reserved_cost_micro_usd bigint,
  p_chapter_cap_micro_usd bigint,
  p_member_cap_micro_usd bigint,
  p_platform_cap_micro_usd bigint,
  p_now timestamptz
)
returns table (
  reservation_id uuid,
  refused text,
  platform_spent_before bigint,
  platform_spent_after bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_month_start timestamptz := date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC';
  v_month_end timestamptz := v_month_start + interval '1 month';
  v_day_start timestamptz := date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC';
  v_day_end timestamptz := v_day_start + interval '1 day';
  v_platform bigint;
  v_chapter bigint;
  v_member bigint;
  v_id uuid;
begin
  if p_reserved_cost_micro_usd is null or p_reserved_cost_micro_usd < 0 then
    raise exception 'reserve_ai_spend: the hold must be zero or more'
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_spend:chapter:' || p_chapter_id::text, 0));

  v_platform := 0;
  if p_platform_cap_micro_usd is not null then
    perform pg_advisory_xact_lock(hashtextextended('ai_spend:provider:' || p_provider, 0));

    select coalesce(sum(public.ai_usage_charge(e.status, e.reserved_cost_micro_usd, e.cost_micro_usd)), 0)
      into v_platform
      from public.ai_usage_events e
     where e.provider = p_provider
       and e.created_at >= v_month_start
       and e.created_at < v_month_end;

    if v_platform + p_reserved_cost_micro_usd > p_platform_cap_micro_usd then
      return query select null::uuid, 'platform_cap'::text, v_platform, v_platform;
      return;
    end if;
  end if;

  select coalesce(sum(public.ai_usage_charge(e.status, e.reserved_cost_micro_usd, e.cost_micro_usd)), 0)
    into v_chapter
    from public.ai_usage_events e
   where e.chapter_id = p_chapter_id
     and e.created_at >= v_month_start
     and e.created_at < v_month_end;

  if p_chapter_cap_micro_usd is not null
     and v_chapter + p_reserved_cost_micro_usd > p_chapter_cap_micro_usd then
    return query select null::uuid, 'chapter_cap'::text, v_platform, v_platform;
    return;
  end if;

  if p_user_id is not null and p_member_cap_micro_usd is not null then
    select coalesce(sum(public.ai_usage_charge(e.status, e.reserved_cost_micro_usd, e.cost_micro_usd)), 0)
      into v_member
      from public.ai_usage_events e
     where e.chapter_id = p_chapter_id
       and e.user_id = p_user_id
       and e.created_at >= v_day_start
       and e.created_at < v_day_end;

    if v_member + p_reserved_cost_micro_usd > p_member_cap_micro_usd then
      return query select null::uuid, 'member_cap'::text, v_platform, v_platform;
      return;
    end if;
  end if;

  insert into public.ai_usage_events (
    chapter_id, user_id, run_id, task, family, provider, model, prompt_version,
    reserved_cost_micro_usd, created_at
  )
  values (
    p_chapter_id, p_user_id, p_run_id, p_task, p_family, p_provider, p_model,
    p_prompt_version, p_reserved_cost_micro_usd, p_now
  )
  returning id into v_id;

  return query select v_id, null::text, v_platform,
    case when p_platform_cap_micro_usd is null then 0 else v_platform + p_reserved_cost_micro_usd end;
end;
$$;

comment on function public.reserve_ai_spend(uuid, uuid, uuid, text, text, text, text, text, bigint, bigint, bigint, bigint, timestamptz) is
  'Holds an AI call''s worst-case cost against the platform''s monthly cap for its provider, the chapter''s monthly cap and the member''s daily cap (UTC), serialized per chapter then per provider. Returns the new reserved row''s id, or the cap it would cross. See 20261112165020_ai_usage_ledger.sql.';

-- Settle a hold with what the call really used, or record a call made with no
-- hold (`p_reservation_id` null, which the gateway sends only when the spend
-- seam held nothing).
--
-- `p_bill_reservation` charges the hold itself instead of `p_cost_micro_usd`,
-- and marks the row `cost_estimated`. The API sets it when the call failed
-- without the provider saying what it used, unless the failure proves the
-- provider turned it away at the door (billing.md § Abandoned and unanswered
-- calls).
--
-- A hold that expired is still settled: the call outlived the sweep, and its
-- real cost replaces the hold. Returns `settled` (a hold was settled),
-- `inserted` (a call with no hold was recorded) or `missing` (no such hold in
-- this chapter, or it was already settled), and never raises for the last,
-- because the provider has already been paid by then.
create or replace function public.settle_ai_spend(
  p_reservation_id uuid,
  p_chapter_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_task text,
  p_family text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_outcome text,
  p_error_kind text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_cost_micro_usd bigint,
  p_bill_reservation boolean,
  p_latency_ms integer,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_reservation_id is null then
    insert into public.ai_usage_events (
      chapter_id, user_id, run_id, task, family, provider, model, prompt_version,
      status, outcome, error_kind, input_tokens, output_tokens, cached_input_tokens,
      reserved_cost_micro_usd, cost_micro_usd, latency_ms, created_at, settled_at
    )
    values (
      p_chapter_id, p_user_id, p_run_id, p_task, p_family, p_provider, p_model,
      p_prompt_version, 'settled', p_outcome, p_error_kind, p_input_tokens,
      p_output_tokens, p_cached_input_tokens, 0, p_cost_micro_usd, p_latency_ms,
      p_now, p_now
    );
    return 'inserted';
  end if;

  update public.ai_usage_events e
     set status = 'settled',
         outcome = p_outcome,
         error_kind = p_error_kind,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         cached_input_tokens = p_cached_input_tokens,
         cost_micro_usd = case
           when p_bill_reservation then e.reserved_cost_micro_usd
           else p_cost_micro_usd
         end,
         cost_estimated = coalesce(p_bill_reservation, false),
         latency_ms = p_latency_ms,
         settled_at = p_now
   where e.id = p_reservation_id
     and e.chapter_id = p_chapter_id
     and e.status in ('reserved', 'expired');

  if found then
    return 'settled';
  end if;
  return 'missing';
end;
$$;

comment on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz) is
  'Settles an AI spend hold with the call''s real counts and cost (or charges the hold itself when the provider never reported usage), or records a call made with no hold. Returns settled, inserted or missing. See 20261112165020_ai_usage_ledger.sql.';

-- Expire holds nobody settled: the API process died between the hold and the
-- call's end. An expired hold keeps counting toward the caps at its full
-- amount, because the call may have run and been billed. Returns how many
-- expired, for the API to report.
create or replace function public.expire_ai_spend_holds(
  p_older_than timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.ai_usage_events
     set status = 'expired'
   where status = 'reserved'
     and created_at < p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.expire_ai_spend_holds(timestamptz) is
  'Marks AI spend holds reserved before p_older_than as expired; they keep counting toward the caps at their full hold. Returns the count. See 20261112165020_ai_usage_ledger.sql.';

-- A chapter's usage in a period, one row per task, model and provider: what
-- the allowance and overage are computed from (billing.md § Implementation
-- invariants). Holds not yet settled count at their hold, as the caps do.
create or replace function public.ai_chapter_usage(
  p_chapter_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  task text,
  provider text,
  model text,
  calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  cached_input_tokens bigint,
  cost_micro_usd bigint,
  estimated_cost_micro_usd bigint,
  unsettled_calls bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.task,
         e.provider,
         e.model,
         count(*)::bigint,
         coalesce(sum(e.input_tokens), 0)::bigint,
         coalesce(sum(e.output_tokens), 0)::bigint,
         coalesce(sum(e.cached_input_tokens), 0)::bigint,
         coalesce(sum(public.ai_usage_charge(e.status, e.reserved_cost_micro_usd, e.cost_micro_usd)), 0)::bigint,
         coalesce(sum(
           case when e.status <> 'settled' or e.cost_estimated
             then public.ai_usage_charge(e.status, e.reserved_cost_micro_usd, e.cost_micro_usd)
             else 0 end
         ), 0)::bigint,
         count(*) filter (where e.status <> 'settled')::bigint
    from public.ai_usage_events e
   where e.chapter_id = p_chapter_id
     and e.created_at >= p_from
     and e.created_at < p_to
   group by e.task, e.provider, e.model
   order by e.task, e.provider, e.model;
$$;

comment on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) is
  'A chapter''s AI usage in [p_from, p_to), one row per task, provider and model: calls, token counts, cost in micro-USD (holds count at their hold), the part of it that is estimated, and calls not yet settled. See 20261112165020_ai_usage_ledger.sql.';

-- Service role only, as every RPC the API alone calls.
revoke execute on function public.ai_usage_charge(text, bigint, bigint) from public;
revoke execute on function public.reserve_ai_spend(uuid, uuid, uuid, text, text, text, text, text, bigint, bigint, bigint, bigint, timestamptz) from public;
revoke execute on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz) from public;
revoke execute on function public.expire_ai_spend_holds(timestamptz) from public;
revoke execute on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.ai_usage_charge(text, bigint, bigint) from anon;
    revoke execute on function public.reserve_ai_spend(uuid, uuid, uuid, text, text, text, text, text, bigint, bigint, bigint, bigint, timestamptz) from anon;
    revoke execute on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz) from anon;
    revoke execute on function public.expire_ai_spend_holds(timestamptz) from anon;
    revoke execute on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.ai_usage_charge(text, bigint, bigint) from authenticated;
    revoke execute on function public.reserve_ai_spend(uuid, uuid, uuid, text, text, text, text, text, bigint, bigint, bigint, bigint, timestamptz) from authenticated;
    revoke execute on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz) from authenticated;
    revoke execute on function public.expire_ai_spend_holds(timestamptz) from authenticated;
    revoke execute on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ai_usage_charge(text, bigint, bigint) to service_role;
    grant execute on function public.reserve_ai_spend(uuid, uuid, uuid, text, text, text, text, text, bigint, bigint, bigint, bigint, timestamptz) to service_role;
    grant execute on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz) to service_role;
    grant execute on function public.expire_ai_spend_holds(timestamptz) to service_role;
    grant execute on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) to service_role;
  end if;
end
$$;
