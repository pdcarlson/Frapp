-- Who can see and who can post in each channel (#3722, slice 9 of #4068).
--
-- Paul, 2026-11-10: each channel answers two questions, who can see it and
-- who can post, each "everyone" or a list of tiers and roles (groups join the
-- lists later, #4076). A channel copies its category's answers until someone
-- changes it. No deny switches, no per-person overrides; private channels
-- with hand-picked members stay as they are.
--
-- WHAT CHANGES
--
--   chat_channels.who_can_see, chat_channel_categories.who_can_see
--     null    everyone in the chapter
--     list    members holding any listed entry
--   chat_channels.who_can_post, chat_channel_categories.who_can_post
--     null    everyone who can see the channel
--     list    of those, members holding any listed entry
--
-- An entry is 'tier:<role_tiers.id>' or 'role:<roles.id>'. A member holds
-- 'role:<id>' for every role they hold in the chapter and 'tier:<id>' for the
-- tier each of those roles sits in. `*` (the President) sees and posts
-- everywhere a list governs, so a chapter can't lock itself out. Lists are
-- kept sorted and distinct, so two lists that say the same thing are equal.
-- Only PUBLIC and ROLE_GATED channels carry lists: PRIVATE, DM and GROUP_DM
-- are still decided by member_ids, and their lists are always null.
--
-- The Alumni lifecycle rule (spec/behavior/alumni.md) reads the lists too:
-- someone holding the Alumni role posts only where the channel names that
-- role (or its tier) in who can post, or in who can see when anyone who can
-- see may post. Before, it was the `alumni:post` string in
-- required_permissions.
--
-- WHAT THIS REPLACES, AND WHAT STAYS FOR ONE RELEASE
--
-- The lists replace required_permissions (ROLE_GATED's gate), is_read_only
-- and the `announcements:post` check in the post gate, and the
-- `channels:read:<name>` strings a Discord import gives roles. Nothing in the
-- API reads required_permissions for access after this. Two old columns stay,
-- kept equal to the lists, because shipped mobile builds and several readers
-- key on them:
--
--   type          ROLE_GATED exactly when who_can_see is a list (a check).
--   is_read_only  true exactly when who_can_post is a list (a check), which
--                 is still what turns off quote replies and makes a channel
--                 an announcements channel for push.
--
-- `chat_channels_legacy_access` (below) derives the lists from the old
-- columns for a writer that only sets those: the API that is still serving
-- while this migration runs, a rollback, and the Discord importer, which
-- still writes required_permissions. Dropping required_permissions, this
-- trigger and the import's permission strings is the follow-up.
--
-- EVERY MEMBER SEES AND POSTS EXACTLY WHERE THEY DID
--
-- `chat_channel_access_from_legacy` turns a channel's old settings into
-- lists, role by role, from what each role holds right now:
--
--   PUBLIC                 who_can_see null.
--   ROLE_GATED             who_can_see = every role in the chapter holding
--                          one of required_permissions (empty: nobody but `*`,
--                          as before).
--   is_read_only           who_can_post = every role holding
--                          announcements:post. The Alumni role is left out
--                          unless the channel required alumni:post, because
--                          the alumni rule refused those posts before.
--   the audit log          who_can_post = {} (nobody; the gate refuses every
--                          member there anyway).
--   otherwise              who_can_post null, except a ROLE_GATED channel the
--                          Alumni role can see but that never required
--                          alumni:post: its posters are its readers minus the
--                          Alumni role, so alumni still can't post there.
--
-- `*` holders are never listed: they pass every list. Custom roles
-- (`chapter_custom_roles`) are not read: production and staging held none on
-- 2026-11-11, and #4075 folds them into roles.
--
-- One known difference, accepted: someone holding the Alumni role AND another
-- role with announcements:post, in a read-only channel that required
-- alumni:post, could post before and can't now. No seeded channel is in that
-- shape.
--
-- A category whose PUBLIC and ROLE_GATED channels all ended up with the same
-- two lists takes those lists, so its channels start out matching it.
-- Everything else in a category starts as everyone / everyone, and channels
-- that differ show as custom.
--
-- WHO KEEPS THE LISTS RIGHT
--
--   set_chat_category_access    a category's change reaches every channel in
--                               it that matched the category before, in one
--                               transaction.
--   chat_access_strip_entry     deleting a role or a tier takes its entry off
--                               every list in the chapter (a list left empty
--                               admits nobody but `*`).
--   can_read_chat_channel       the database's read check (message RLS,
--                               realtime topics), rewritten on the lists. Its
--                               TypeScript twin is canAccessChannel.

-- ---------------------------------------------------------------------------
-- 1. Columns and their shape.
-- ---------------------------------------------------------------------------

alter table public.chat_channels
  add column if not exists who_can_see text[],
  add column if not exists who_can_post text[];

alter table public.chat_channel_categories
  add column if not exists who_can_see text[],
  add column if not exists who_can_post text[];

comment on column public.chat_channels.who_can_see is
  'Who can see the channel: null is everyone in the chapter; a list holds tier:<id> and role:<id> entries. Null on PRIVATE, DM and GROUP_DM. See 20261111230000_chat_channel_access_lists.sql.';
comment on column public.chat_channels.who_can_post is
  'Who can post: null is everyone who can see it; a list holds tier:<id> and role:<id> entries. See 20261111230000_chat_channel_access_lists.sql.';
comment on column public.chat_channel_categories.who_can_see is
  'What a new channel in this category copies for who can see it, and what a channel that matches it follows. See 20261111230000_chat_channel_access_lists.sql.';
comment on column public.chat_channel_categories.who_can_post is
  'What a new channel in this category copies for who can post, and what a channel that matches it follows. See 20261111230000_chat_channel_access_lists.sql.';

-- Every entry is a kind and a lowercase uuid. Groups (#4076) add their kind
-- here.
create or replace function public.chat_access_list_valid(p_entries text[])
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select p_entries is null or not exists (
    select 1
      from unnest(p_entries) as e
     where e is null
        or e !~ '^(tier|role):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Old settings to lists.
-- ---------------------------------------------------------------------------

create or replace function public.chat_channel_access_from_legacy(
  p_chapter_id uuid,
  p_type text,
  p_required_permissions text[],
  p_is_read_only boolean,
  p_is_audit_log boolean,
  out who_can_see text[],
  out who_can_post text[]
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_alumni_key text;
  v_alumni_postable boolean :=
    p_type = 'ROLE_GATED'
    and 'alumni:post' = any (coalesce(p_required_permissions, '{}'::text[]));
begin
  who_can_see := null;
  who_can_post := null;
  if p_type is null or p_type not in ('PUBLIC', 'ROLE_GATED') then
    return;
  end if;

  select 'role:' || r.id::text
    into v_alumni_key
    from public.roles r
   where r.chapter_id = p_chapter_id
     and r.system_key = 'ALUMNI'
   order by r.id
   limit 1;

  if p_type = 'ROLE_GATED' then
    select coalesce(array_agg(k order by k), '{}'::text[])
      into who_can_see
      from (
        select distinct 'role:' || r.id::text as k
          from public.roles r
         where r.chapter_id = p_chapter_id
           and r.permissions && coalesce(p_required_permissions, '{}'::text[])
      ) s;
  end if;

  if coalesce(p_is_audit_log, false) then
    who_can_post := '{}'::text[];
  elsif coalesce(p_is_read_only, false) then
    select coalesce(array_agg(k order by k), '{}'::text[])
      into who_can_post
      from (
        select distinct 'role:' || r.id::text as k
          from public.roles r
         where r.chapter_id = p_chapter_id
           and 'announcements:post' = any (r.permissions)
      ) s
     where v_alumni_postable or s.k is distinct from v_alumni_key;
  elsif not v_alumni_postable
        and v_alumni_key is not null
        and who_can_see is not null
        and v_alumni_key = any (who_can_see) then
    who_can_post := array_remove(who_can_see, v_alumni_key);
  end if;
end;
$$;

revoke all on function public.chat_channel_access_from_legacy(uuid, text, text[], boolean, boolean)
  from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.chat_channel_access_from_legacy(uuid, text, text[], boolean, boolean) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.chat_channel_access_from_legacy(uuid, text, text[], boolean, boolean) from authenticated;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill every channel, then each category whose channels agree.
-- ---------------------------------------------------------------------------

update public.chat_channels c
   set (who_can_see, who_can_post) = (
         select d.who_can_see, d.who_can_post
           from public.chat_channel_access_from_legacy(
             c.chapter_id, c.type, c.required_permissions, c.is_read_only, c.is_audit_log
           ) d
       )
 where c.type in ('PUBLIC', 'ROLE_GATED')
   and c.who_can_see is null
   and c.who_can_post is null;

-- '*' stands for null in the comparison: a list's text form starts with '{'.
with agreed as (
  select c.category_id
    from public.chat_channels c
   where c.category_id is not null
     and c.type in ('PUBLIC', 'ROLE_GATED')
     and not c.is_audit_log
   group by c.category_id
  having count(distinct
           coalesce(c.who_can_see::text, '*') || '|' || coalesce(c.who_can_post::text, '*')
         ) = 1
)
update public.chat_channel_categories cat
   set (who_can_see, who_can_post) = (
         select c.who_can_see, c.who_can_post
           from public.chat_channels c
          where c.category_id = cat.id
            and c.type in ('PUBLIC', 'ROLE_GATED')
            and not c.is_audit_log
          limit 1
       )
  from agreed
 where cat.id = agreed.category_id
   and cat.who_can_see is null
   and cat.who_can_post is null;

-- ---------------------------------------------------------------------------
-- 4. Checks: entry shape, lists only where they apply, the two old columns
--    kept equal to the lists. NOT VALID then VALIDATE, so the add takes a
--    brief lock and the scan runs without blocking writes.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_channels_access_lists_valid') then
    alter table public.chat_channels
      add constraint chat_channels_access_lists_valid
      check (
        public.chat_access_list_valid(who_can_see)
        and public.chat_access_list_valid(who_can_post)
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chat_channels_access_lists_where_they_apply') then
    alter table public.chat_channels
      add constraint chat_channels_access_lists_where_they_apply
      check (
        type in ('PUBLIC', 'ROLE_GATED')
        or (who_can_see is null and who_can_post is null)
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chat_channels_type_follows_who_can_see') then
    alter table public.chat_channels
      add constraint chat_channels_type_follows_who_can_see
      check (
        type not in ('PUBLIC', 'ROLE_GATED')
        or (type = 'ROLE_GATED') = (who_can_see is not null)
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chat_channels_read_only_follows_who_can_post') then
    alter table public.chat_channels
      add constraint chat_channels_read_only_follows_who_can_post
      check (
        type not in ('PUBLIC', 'ROLE_GATED')
        or is_read_only = (who_can_post is not null)
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chat_channel_categories_access_lists_valid') then
    alter table public.chat_channel_categories
      add constraint chat_channel_categories_access_lists_valid
      check (
        public.chat_access_list_valid(who_can_see)
        and public.chat_access_list_valid(who_can_post)
      ) not valid;
  end if;
end
$$;

alter table public.chat_channels validate constraint chat_channels_access_lists_valid;
alter table public.chat_channels validate constraint chat_channels_access_lists_where_they_apply;
alter table public.chat_channels validate constraint chat_channels_type_follows_who_can_see;
alter table public.chat_channels validate constraint chat_channels_read_only_follows_who_can_post;
alter table public.chat_channel_categories validate constraint chat_channel_categories_access_lists_valid;

-- ---------------------------------------------------------------------------
-- 5. A writer that only sets the old columns.
-- ---------------------------------------------------------------------------
-- An insert with neither list gets both from the old columns. An update that
-- changes is_read_only or required_permissions and leaves both lists alone
-- gets both again. The API from this migration on always writes the lists
-- with the old columns kept equal to them, so neither case fires for it.
-- Runs after `chat_channels_flag_audit_log` (triggers fire in name order),
-- so a seeded #chapter-audit is already flagged when it gets here.

create or replace function public.chat_channels_legacy_access()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_derived record;
begin
  if new.type not in ('PUBLIC', 'ROLE_GATED') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.who_can_see is not null or new.who_can_post is not null then
      -- Lists given. Only a flag set beneath them (the audit-log flag on a
      -- seeded #chapter-audit) can leave a read-only row with no posters.
      if new.is_read_only and new.who_can_post is null then
        select * into v_derived
          from public.chat_channel_access_from_legacy(
            new.chapter_id, new.type, new.required_permissions, true, new.is_audit_log
          );
        new.who_can_post := v_derived.who_can_post;
      end if;
      return new;
    end if;
  elsif new.who_can_see is distinct from old.who_can_see
     or new.who_can_post is distinct from old.who_can_post
     or (
       new.is_read_only is not distinct from old.is_read_only
       and new.required_permissions is not distinct from old.required_permissions
     ) then
    return new;
  end if;

  select * into v_derived
    from public.chat_channel_access_from_legacy(
      new.chapter_id, new.type, new.required_permissions, new.is_read_only, new.is_audit_log
    );
  new.who_can_see := v_derived.who_can_see;
  new.who_can_post := v_derived.who_can_post;
  -- The audit log derives an empty who-can-post list whatever is_read_only
  -- said, so the mirror follows the list (the check below needs it to).
  new.is_read_only := new.who_can_post is not null;
  return new;
end;
$$;

revoke execute on function public.chat_channels_legacy_access()
  from public, anon, authenticated;

drop trigger if exists chat_channels_legacy_access on public.chat_channels;
create trigger chat_channels_legacy_access
  before insert or update on public.chat_channels
  for each row execute function public.chat_channels_legacy_access();

-- ---------------------------------------------------------------------------
-- 6. A category's change reaches the channels that matched it.
-- ---------------------------------------------------------------------------
-- Returns the ids of the channels that followed, so the API can drop them
-- from its channel cache. The audit log never follows. `security invoker`
-- like `reorder_chat_channels`: the API calls it with the service-role
-- client, and EXECUTE is locked to service_role below.

create or replace function public.set_chat_category_access(
  p_chapter_id uuid,
  p_category_id uuid,
  p_who_can_see text[],
  p_who_can_post text[]
)
returns setof uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old_see text[];
  v_old_post text[];
begin
  select cat.who_can_see, cat.who_can_post
    into v_old_see, v_old_post
    from public.chat_channel_categories cat
   where cat.id = p_category_id
     and cat.chapter_id = p_chapter_id
     for update;
  if not found then
    return;
  end if;

  return query
    update public.chat_channels c
       set who_can_see = p_who_can_see,
           who_can_post = p_who_can_post,
           type = case when p_who_can_see is null then 'PUBLIC' else 'ROLE_GATED' end,
           is_read_only = p_who_can_post is not null
     where c.chapter_id = p_chapter_id
       and c.category_id = p_category_id
       and c.type in ('PUBLIC', 'ROLE_GATED')
       and not c.is_audit_log
       and c.who_can_see is not distinct from v_old_see
       and c.who_can_post is not distinct from v_old_post
    returning c.id;

  update public.chat_channel_categories cat
     set who_can_see = p_who_can_see,
         who_can_post = p_who_can_post
   where cat.id = p_category_id
     and cat.chapter_id = p_chapter_id;
end;
$$;

revoke all on function public.set_chat_category_access(uuid, uuid, text[], text[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.set_chat_category_access(uuid, uuid, text[], text[]) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.set_chat_category_access(uuid, uuid, text[], text[]) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_chat_category_access(uuid, uuid, text[], text[]) to service_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. A deleted role or tier leaves every list.
-- ---------------------------------------------------------------------------

create or replace function public.chat_access_strip_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text := tg_argv[0] || ':' || old.id::text;
begin
  update public.chat_channels
     set who_can_see = case when v_key = any (who_can_see)
                            then array_remove(who_can_see, v_key) else who_can_see end,
         who_can_post = case when v_key = any (who_can_post)
                             then array_remove(who_can_post, v_key) else who_can_post end
   where chapter_id = old.chapter_id
     and (v_key = any (who_can_see) or v_key = any (who_can_post));
  update public.chat_channel_categories
     set who_can_see = case when v_key = any (who_can_see)
                            then array_remove(who_can_see, v_key) else who_can_see end,
         who_can_post = case when v_key = any (who_can_post)
                             then array_remove(who_can_post, v_key) else who_can_post end
   where chapter_id = old.chapter_id
     and (v_key = any (who_can_see) or v_key = any (who_can_post));
  return old;
end;
$$;

revoke execute on function public.chat_access_strip_entry()
  from public, anon, authenticated;

drop trigger if exists roles_strip_chat_access on public.roles;
create trigger roles_strip_chat_access
  after delete on public.roles
  for each row execute function public.chat_access_strip_entry('role');

drop trigger if exists role_tiers_strip_chat_access on public.role_tiers;
create trigger role_tiers_strip_chat_access
  after delete on public.role_tiers
  for each row execute function public.chat_access_strip_entry('tier');

-- ---------------------------------------------------------------------------
-- 8. The database's read check, on the lists.
-- ---------------------------------------------------------------------------
-- Same signature, so the realtime policy and can_read_chat_message keep
-- resolving it. A role id in members.role_ids is matched as a uuid (it is an
-- unconstrained text[] that may hold uppercase) and only within the channel's
-- chapter, exactly as before. `*` passes a list, as canAccessChannel has it.

create or replace function public.can_read_chat_channel(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.chat_channels c
    join public.users         u   on u.supabase_auth_id = auth.uid()
    join public.members       mem on mem.user_id = u.id
                                  and mem.chapter_id = c.chapter_id
    where c.id = p_channel_id
      and (
        case
          when c.type in ('PRIVATE', 'DM', 'GROUP_DM')
            then u.id = any (coalesce(c.member_ids, '{}'::uuid[]))
          when c.type in ('PUBLIC', 'ROLE_GATED') then
            c.who_can_see is null
            or exists (
              select 1
              from public.roles r
              where r.chapter_id = c.chapter_id
                and r.id = any (
                  array(
                    select v::uuid
                    from unnest(mem.role_ids) as v
                    where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  )
                )
                and (
                  '*' = any (r.permissions)
                  or ('role:' || r.id::text) = any (c.who_can_see)
                  or (
                    r.tier_id is not null
                    and ('tier:' || r.tier_id::text) = any (c.who_can_see)
                  )
                )
            )
          else false
        end
      )
  );
$$;
