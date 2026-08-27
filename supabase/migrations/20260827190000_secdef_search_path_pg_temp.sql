-- Pin `pg_temp` last in `search_path` on every `security definer` function (#985).
--
-- Postgres searches the temporary schema FIRST for unqualified relation names
-- whenever `pg_temp` is not itself listed in `search_path`. A `security definer`
-- function declared `set search_path = public` therefore resolves a bare table
-- name against a caller-created temp table before the real one -- while running
-- with the definer's privileges.
--
-- Four of the seven functions below are authorization code: `can_read_chat_message`
-- backs chat RLS, and the three `realtime_can_read_*_scope` functions gate realtime
-- delivery. A shadowed read there is an authorization decision made against
-- attacker-supplied rows.
--
-- Naming `pg_temp` explicitly, and LAST, is the entire fix: it moves the temp
-- schema to the end of the resolution order instead of Postgres's implicit front
-- position. This mirrors 20260816190000_chat_unread_and_mentions.sql, which applied
-- the same fix to `get_channel_unread_counts` (#983); this migration is that sweep
-- finished across the rest of the repo.
--
-- Reachability, stated honestly: there is no known path to this from the app
-- surface today -- PostgREST exposes no arbitrary SQL and the Supabase client can
-- only invoke defined RPCs. It goes live the moment anything grants broader SQL
-- access. This is defense-in-depth on authorization-critical code, not an incident.
-- It is also what Supabase's advisor reports as "Function Search Path Mutable".
--
-- Bodies are UNCHANGED. Each definition below was extracted verbatim from the
-- applied catalog via `pg_get_functiondef()` rather than copied from the source
-- migrations, so no transcription error can reach an RLS predicate. That also
-- avoids a real trap: `can_read_chat_message` is defined twice in history
-- (20260803150000, then superseded by 20260807220000), and copying the older file
-- would silently revert the FRA-321 ROLE_GATED deny-on-empty fix.
--
-- `create or replace` preserves each signature and return type, so dependent RLS
-- policies and triggers keep resolving -- no drop, no recreate, no dependency churn.
--
-- Rollback: re-run the prior definitions with `set search_path = public`. See
-- docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md.

CREATE OR REPLACE FUNCTION public.can_read_chat_message(p_message_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.chat_messages m
    join public.chat_channels c   on c.id = m.channel_id
    join public.users         u   on u.supabase_auth_id = auth.uid()
    join public.members       mem on mem.user_id = u.id
                                  and mem.chapter_id = c.chapter_id
    where m.id = p_message_id
      and (
        case
          when c.type = 'PUBLIC' then true
          -- Grouped exactly as canAccessChannel groups them, so the two stay
          -- legible side by side and a new member-list channel type is a
          -- one-line change in both.
          when c.type in ('PRIVATE', 'DM', 'GROUP_DM')
            then u.id = any (coalesce(c.member_ids, '{}'::uuid[]))
          -- ROLE_GATED with no requirement is a misconfiguration, not a public
          -- channel: deny rather than fall open (FRA-321). Step 2 above
          -- guarantees no existing row is in that shape, and the API rejects
          -- creating or updating one into it.
          --
          -- The deny needs no explicit length test: `&&` against an empty array
          -- is false and against NULL is NULL, so an empty requirement list
          -- already matches no one. Testing the length *first* would be worse
          -- than redundant -- it would sit in front of the wildcard branch and
          -- deny a President, which canAccessChannel does not. Keeping the two
          -- spellings equivalent is the whole point: this predicate and its
          -- TypeScript twin drifting is what produced FRA-321.
          when c.type = 'ROLE_GATED' then
            exists (
              select 1
              from public.roles r
              where r.chapter_id = c.chapter_id
                -- `members.role_ids` is an unconstrained text[], and the API
                -- accepts role ids as `z.string().uuid()`, which permits
                -- uppercase. Postgres uuid equality is case-insensitive but
                -- text equality is not, so comparing as text would silently
                -- deny a member whose stored id differs only in case, while
                -- the app layer allowed them. Compare as uuid to match.
                and r.id = any (
                  array(
                    select v::uuid
                    from unnest(mem.role_ids) as v
                    where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  )
                )
                and (
                  '*' = any (r.permissions)
                  or r.permissions && c.required_permissions
                )
            )
          else false
        end
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.realtime_can_read_chapter_scope(p_chapter_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.users u
    join public.members m on m.user_id = u.id
    where u.supabase_auth_id = auth.uid()
      and m.chapter_id = p_chapter_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.realtime_can_read_event_scope(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.events e
    join public.members m on m.chapter_id = e.chapter_id
    join public.users u on u.id = m.user_id
    where e.id = p_event_id
      and u.supabase_auth_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.realtime_can_read_user_scope(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and u.supabase_auth_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.realtime_notify_event_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_scope uuid;
begin
  begin
    for v_scope in select distinct event_id from changed where event_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('table', 'event_attendance', 'op', tg_op),
        'change',
        'attendance:' || v_scope::text,
        true
      );
    end loop;
  exception when others then
    null;
  end;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.realtime_notify_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_scope uuid;
begin
  begin
    for v_scope in select distinct chapter_id from changed where chapter_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('table', 'events', 'op', tg_op),
        'change',
        'events:' || v_scope::text,
        true
      );
    end loop;
  exception when others then
    null;
  end;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.realtime_notify_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_scope uuid;
begin
  begin
    for v_scope in select distinct user_id from changed where user_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('table', 'notifications', 'op', tg_op),
        'change',
        'notif:' || v_scope::text,
        true
      );
    end loop;
  exception when others then
    -- Deliberately swallowed: the client falls back to its normal refetch, and
    -- a stale drawer is strictly better than a failed write.
    null;
  end;
  return null;
end;
$function$
;

