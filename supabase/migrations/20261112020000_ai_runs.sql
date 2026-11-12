-- AI runs (#4310; ADR-28 decision 10, spec/architecture/README.md § 13).
--
-- One table for every background AI job: drafting minutes, transcribing a
-- recording, indexing a document, and later the proactive features. A feature
-- adds a kind and a handler in the API and nothing here.
--
-- The worker copies the Discord import's lease (`discord_imports`): a run is
-- claimed by writing a fresh `lock_token` and a `lease_expires_at`, every later
-- write by the worker is conditional on that token, and a run whose lease ran
-- out is claimable again. The claim itself is one function here rather than a
-- read-then-compare-and-set in the API, so that raising the attempt count, and
-- failing a run that has used its attempts, happen in the same statement as the
-- claim, and so the PGlite gate runs the exact SQL the API calls.
--
-- The row holds ids and counts only. `input_ref` and `result_ref` are checked
-- by `ai_run_ref_is_ids_only`: an object whose values are uuids, numbers,
-- booleans, nulls or arrays of those. No prompt, answer, note or any other text
-- a member wrote can be stored on a run (ADR-28 decision 8).
--
-- RLS is on with no policies: the API reads and writes with the service role,
-- and decides who may read a run (the member who started it, the member it acts
-- for, or an officer the kind's handler names).

create or replace function public.ai_run_ref_is_ids_only(p_ref jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_item jsonb;
  v_uuid constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_ref is null or jsonb_typeof(p_ref) <> 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(p_ref)) > 32 then
    return false;
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_ref) e loop
    if v_key !~ '^[a-z][a-z0-9_]{0,62}$' then
      return false;
    end if;

    if jsonb_typeof(v_value) = 'array' then
      if jsonb_array_length(v_value) > 500 then
        return false;
      end if;
      for v_item in select a.value from jsonb_array_elements(v_value) a loop
        if not (
          jsonb_typeof(v_item) in ('number', 'boolean', 'null')
          or (jsonb_typeof(v_item) = 'string' and (v_item #>> '{}') ~ v_uuid)
        ) then
          return false;
        end if;
      end loop;
    elsif not (
      jsonb_typeof(v_value) in ('number', 'boolean', 'null')
      or (jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') ~ v_uuid)
    ) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

comment on function public.ai_run_ref_is_ids_only(jsonb) is
  'True when a jsonb value is an object of at most 32 snake_case keys whose values are uuids, numbers, booleans, nulls, or arrays (at most 500) of those. Guards ai_runs.input_ref and result_ref so a run holds ids and counts, never text. See 20261112020000_ai_runs.sql.';

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- A handler's name in the API's registry (`minutes_draft`). Not a fixed
  -- list here, so a new kind needs no migration.
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,47}$'),
  -- Built by the feature from ids (`meeting:<uuid>`), never from text.
  dedupe_key text not null
    check (dedupe_key ~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$'),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  -- Who asked for the run, if a member did. Null for one the system started.
  requested_by uuid references public.users(id) on delete set null,
  -- The member the run reads as (spec/behavior/ai.md § Whose access an AI run
  -- uses). Null means the run acts for no one and may not read the corpus.
  acting_user_id uuid references public.users(id) on delete set null,
  input_ref jsonb not null default '{}'::jsonb
    check (public.ai_run_ref_is_ids_only(input_ref)),
  result_ref jsonb
    check (result_ref is null or public.ai_run_ref_is_ids_only(result_ref)),
  -- Claims so far. Raised by every claim, so a worker that dies mid-run still
  -- uses up a try.
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  failure_reason text check (failure_reason in (
    'unknown_kind',
    'ai_unavailable',
    'not_permitted',
    'source_gone',
    'spend_limit',
    'invalid_result',
    'handler_failed',
    'attempts_exhausted'
  )),
  -- The lease, as on `discord_imports`. `lease_expires_at` without a token is
  -- a pause before the next try.
  lock_token uuid,
  locked_by text check (locked_by is null or char_length(locked_by) <= 64),
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint ai_runs_dedupe unique (chapter_id, kind, dedupe_key),
  constraint ai_runs_failure_reason_iff_failed
    check ((status = 'failed') = (failure_reason is not null)),
  constraint ai_runs_lock_only_while_running
    check (lock_token is null or status = 'running'),
  constraint ai_runs_finished_iff_terminal
    check ((status in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null))
);

alter table public.ai_runs enable row level security;

comment on table public.ai_runs is
  'One row per background AI job (#4310, ADR-28). Ids and counts only. Claimed by the API worker through claim_ai_run with a lease, as discord_imports are. RLS on, no policies: the API reads and writes with the service role.';

-- The claim's scan: only runs that can still be claimed, oldest first.
create index if not exists idx_ai_runs_claimable
  on public.ai_runs (created_at, id)
  where status in ('queued', 'running');

-- "My runs", newest first.
create index if not exists idx_ai_runs_requester
  on public.ai_runs (chapter_id, requested_by, created_at desc);

-- The daily prune of finished runs.
create index if not exists idx_ai_runs_finished
  on public.ai_runs (finished_at)
  where status in ('succeeded', 'failed', 'cancelled');

-- Enqueue once per (chapter, kind, dedupe key). A second call returns the run
-- the first one made, whatever its status. Under two concurrent calls the
-- loser's `on conflict do nothing` waits for the winner's commit, and its
-- select, a new statement, then sees the winner's row.
create or replace function public.enqueue_ai_run(
  p_chapter_id uuid,
  p_kind text,
  p_dedupe_key text,
  p_requested_by uuid,
  p_acting_user_id uuid,
  p_input_ref jsonb,
  p_max_attempts integer
)
returns setof public.ai_runs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    insert into public.ai_runs as r (
      chapter_id, kind, dedupe_key, requested_by, acting_user_id, input_ref, max_attempts
    )
    values (
      p_chapter_id, p_kind, p_dedupe_key, p_requested_by, p_acting_user_id,
      coalesce(p_input_ref, '{}'::jsonb), p_max_attempts
    )
    on conflict (chapter_id, kind, dedupe_key) do nothing
    returning r.*;

  if not found then
    return query
      select r.*
        from public.ai_runs r
       where r.chapter_id = p_chapter_id
         and r.kind = p_kind
         and r.dedupe_key = p_dedupe_key;
  end if;
end;
$$;

comment on function public.enqueue_ai_run(uuid, text, text, uuid, uuid, jsonb, integer) is
  'Creates the run for (chapter, kind, dedupe key), or returns the one that already exists. See 20261112020000_ai_runs.sql.';

-- Claim the oldest claimable run for one worker, or return no row.
--
-- Claimable: queued or running, with no lease or a lease that ran out at
-- `p_now` (a dead worker's run, or a pause that ended). `for update skip
-- locked` keeps two workers in the same instant off the same row: the second
-- skips the row the first holds and takes the next one, or none.
--
-- A claim raises `attempt_count`. A run that has already used `max_attempts`
-- is not run again: it ends as failed with `attempts_exhausted`, and the claim
-- moves on to the next run (at most 20 such in one call, so a backlog of dead
-- runs cannot hold one call for long).
create or replace function public.claim_ai_run(
  p_worker_id text,
  p_now timestamptz,
  p_lease_seconds integer
)
returns setof public.ai_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.ai_runs;
  v_exhausted integer := 0;
begin
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 3600 then
    raise exception 'claim_ai_run: lease must be 10 to 3600 seconds'
      using errcode = 'check_violation';
  end if;

  loop
    select r.* into v_run
      from public.ai_runs r
     where r.status in ('queued', 'running')
       and (r.lease_expires_at is null or r.lease_expires_at <= p_now)
     order by r.created_at, r.id
     limit 1
     for update skip locked;

    if not found then
      return;
    end if;

    if v_run.attempt_count >= v_run.max_attempts then
      update public.ai_runs
         set status = 'failed',
             failure_reason = 'attempts_exhausted',
             lock_token = null,
             locked_by = null,
             lease_expires_at = null,
             finished_at = p_now,
             updated_at = p_now
       where id = v_run.id;
      v_exhausted := v_exhausted + 1;
      if v_exhausted >= 20 then
        return;
      end if;
      continue;
    end if;

    return query
      update public.ai_runs r
         set status = 'running',
             attempt_count = r.attempt_count + 1,
             lock_token = gen_random_uuid(),
             locked_by = p_worker_id,
             lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
             started_at = coalesce(r.started_at, p_now),
             updated_at = p_now
       where r.id = v_run.id
      returning r.*;
    return;
  end loop;
end;
$$;

comment on function public.claim_ai_run(text, timestamptz, integer) is
  'Leases the oldest claimable AI run to p_worker_id and raises its attempt count, failing runs that used every attempt on the way. Returns the claimed run, or no row. See 20261112020000_ai_runs.sql.';

-- Service role only, as every RPC the API alone calls.
revoke execute on function public.ai_run_ref_is_ids_only(jsonb) from public;
revoke execute on function public.enqueue_ai_run(uuid, text, text, uuid, uuid, jsonb, integer) from public;
revoke execute on function public.claim_ai_run(text, timestamptz, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.ai_run_ref_is_ids_only(jsonb) from anon;
    revoke execute on function public.enqueue_ai_run(uuid, text, text, uuid, uuid, jsonb, integer) from anon;
    revoke execute on function public.claim_ai_run(text, timestamptz, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.ai_run_ref_is_ids_only(jsonb) from authenticated;
    revoke execute on function public.enqueue_ai_run(uuid, text, text, uuid, uuid, jsonb, integer) from authenticated;
    revoke execute on function public.claim_ai_run(text, timestamptz, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ai_run_ref_is_ids_only(jsonb) to service_role;
    grant execute on function public.enqueue_ai_run(uuid, text, text, uuid, uuid, jsonb, integer) to service_role;
    grant execute on function public.claim_ai_run(text, timestamptz, integer) to service_role;
  end if;
end
$$;
