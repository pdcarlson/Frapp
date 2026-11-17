-- The daily ceilings on emailed invites and on starting chapters
-- (`daily-send-limits.ts` in the API, spec/behavior/README.md § Daily limits),
-- counted and written in one step, one writer at a time.
--
-- WHAT CHANGES
--
-- 1. `invites.email_failed_at`: when the provider refused an invite's email.
--    The API sets it after a failed send. An invite with it set doesn't count
--    toward the emailed-invite ceilings, because no email went out; its
--    token stays valid to share by hand. Null on every existing row, so every
--    email already sent keeps counting.
--
-- 2. `create_emailed_invites`: the emailed-invite insert. It takes a
--    transaction-scoped advisory lock on the chapter, then on the sender
--    (always that order), counts the emailed invites of each made since
--    `p_since` whose send hasn't failed, and inserts the batch only when it
--    fits under both limits. Otherwise it inserts nothing and answers when
--    each counted invite was made, so the API can say how long to wait. A
--    second batch for the same chapter or sender waits for the first to
--    commit, then counts its rows, so batches sent at once can't together
--    pass a ceiling. Rows inserted here count as soon as they commit, before
--    their emails are sent; a failed send is then marked and stops counting.
--    The limits are the API's (`p_chapter_limit`, `p_inviter_limit`), passed
--    in, so the numbers live in one place.
--
-- 3. `chapters_daily_start_ceiling`: a before-insert trigger on `chapters`
--    that takes an advisory lock on the starter (`legal_accepted_by`), counts
--    the chapters they started in the last 24 hours, and refuses a fourth
--    with SQLSTATE `FR429`, which the API answers 429. The API counts the
--    same rows first, to word the refusal; this is what holds when two
--    onboarding submits arrive together. A chapter with no starter (seeds,
--    tests) is not counted. The 3 here must match
--    `CHAPTERS_STARTED_PER_USER_PER_DAY`.
--
-- The locks are `pg_advisory_xact_lock` on a hash of a namespaced key, held
-- to the end of the insert's transaction. Nothing else takes them.

alter table public.invites
  add column if not exists email_failed_at timestamptz;

comment on column public.invites.email_failed_at is
  'When the email provider refused this invite''s email (POST /v1/invites/email). Set, it no longer counts toward the daily emailed-invite ceilings; the token stays valid. See 20261117172019_daily_limits_counted_under_lock.sql.';

create or replace function public.create_emailed_invites(
  p_chapter_id uuid,
  p_created_by uuid,
  p_invites jsonb,
  p_since timestamptz,
  p_chapter_limit integer,
  p_inviter_limit integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_needed integer := jsonb_array_length(p_invites);
  v_chapter timestamptz[];
  v_inviter timestamptz[];
  v_rows jsonb;
begin
  -- Chapter, then sender, in every call: two calls never wait on each other
  -- in opposite orders.
  perform pg_advisory_xact_lock(
    hashtextextended('invite_email_chapter:' || p_chapter_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('invite_email_sender:' || p_created_by::text, 0)
  );

  select coalesce(array_agg(i.created_at order by i.created_at), '{}')
    into v_chapter
    from public.invites i
   where i.chapter_id = p_chapter_id
     and i.email is not null
     and i.email_failed_at is null
     and i.created_at > p_since;

  select coalesce(array_agg(i.created_at order by i.created_at), '{}')
    into v_inviter
    from public.invites i
   where i.created_by = p_created_by
     and i.email is not null
     and i.email_failed_at is null
     and i.created_at > p_since;

  if cardinality(v_chapter) + v_needed > p_chapter_limit
     or cardinality(v_inviter) + v_needed > p_inviter_limit then
    return jsonb_build_object(
      'outcome', 'over',
      'chapter', to_jsonb(v_chapter),
      'inviter', to_jsonb(v_inviter)
    );
  end if;

  with inserted as (
    insert into public.invites (token, chapter_id, role, expires_at, created_by, email)
    select a.token, p_chapter_id, a.role, a.expires_at, p_created_by, a.email
      from jsonb_to_recordset(p_invites)
             as a(token text, role text, expires_at timestamptz, email text)
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
    into v_rows
    from inserted;

  return jsonb_build_object('outcome', 'ok', 'invites', v_rows);
end;
$$;

comment on function public.create_emailed_invites(uuid, uuid, jsonb, timestamptz, integer, integer) is
  'Inserts a batch of emailed invites for one chapter and sender when it fits under both daily ceilings, counted under advisory locks; otherwise inserts nothing and answers the counted times (POST /v1/invites/email). See 20261117172019_daily_limits_counted_under_lock.sql.';

revoke execute on function public.create_emailed_invites(uuid, uuid, jsonb, timestamptz, integer, integer) from public;

create or replace function public.chapters_daily_start_ceiling()
returns trigger
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_started integer;
begin
  if new.legal_accepted_by is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('chapter_start:' || new.legal_accepted_by::text, 0)
  );
  select count(*) into v_started
    from public.chapters c
   where c.legal_accepted_by = new.legal_accepted_by
     and c.created_at > now() - interval '24 hours';
  if v_started >= 3 then
    raise exception
      'chapters_daily_start_ceiling: % chapters started in the last 24 hours',
      v_started
      using errcode = 'FR429';
  end if;
  return new;
end;
$$;

comment on function public.chapters_daily_start_ceiling() is
  'Refuses (FR429) a chapter whose starter (legal_accepted_by) started 3 in the last 24 hours, counted under an advisory lock. See 20261117172019_daily_limits_counted_under_lock.sql.';

revoke execute on function public.chapters_daily_start_ceiling() from public;

drop trigger if exists trg_chapters_daily_start_ceiling on public.chapters;
create trigger trg_chapters_daily_start_ceiling
  before insert on public.chapters
  for each row execute function public.chapters_daily_start_ceiling();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.create_emailed_invites(uuid, uuid, jsonb, timestamptz, integer, integer) from anon;
    revoke execute on function public.chapters_daily_start_ceiling() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.create_emailed_invites(uuid, uuid, jsonb, timestamptz, integer, integer) from authenticated;
    revoke execute on function public.chapters_daily_start_ceiling() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.create_emailed_invites(uuid, uuid, jsonb, timestamptz, integer, integer) to service_role;
  end if;
end
$$;
