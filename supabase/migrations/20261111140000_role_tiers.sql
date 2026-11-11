-- Role tiers (#4071, slice 3 of #4068).
--
-- WHAT CHANGES
--
-- `role_tiers` is a chapter's own ordered list of tiers. `position` orders
-- them, 1 highest; `name` is the chapter's free text; `permissions` is what
-- every role in the tier gets. How many there are, what they are called and
-- their order are the chapter's data: nothing reads a tier's name or number.
--
-- `roles` gains two columns:
--
--   tier_id               the role's tier, or null for a role outside the
--                         tiers (Alumni starts there).
--   permission_overrides  a JSON object of permission key to true or false.
--                         true switches the permission on for this role
--                         whatever its tier says; false switches it off.
--
-- A role's effective permissions are its tier's permissions, plus the
-- overrides that are true, minus the overrides that are false
-- (`role_effective_permissions`). `roles.permissions` always holds that list,
-- so `PermissionsGuard` and every other reader keep reading the column they
-- read today. Two triggers keep it true in the writer's own transaction:
--
--   trg_roles_sync_permissions (before insert or update on roles)
--     A change to `tier_id` or `permission_overrides` rewrites `permissions`.
--     A writer that sets only `permissions` (the Roles page's matrix, a
--     Discord import, `PATCH /v1/roles/:id`) has the difference recorded as
--     overrides instead, changing as few of them as it can, so a role saved
--     that way holds exactly the list it was given.
--   trg_role_tiers_sync_roles (after update of permissions on role_tiers)
--     Rewrites `permissions` on every role in the tier.
--
-- The foreign key is composite, (tier_id, chapter_id) to role_tiers
-- (id, chapter_id), so a role can only sit in a tier of its own chapter. It
-- does not cascade: a tier that still has roles cannot be deleted.
--
-- A tier never carries the wildcard (a check): `*` moves only through
-- Transfer presidency, and a tier holding it would hand it to every role
-- moved in. The President role keeps `*` as an override.
--
-- EXISTING CHAPTERS
--
-- Each chapter with no tiers gets the starting four (Exec board, Officers and
-- chairs, Members, New members) and its roles are placed:
--
--   a role holding `*`, and the seeded President, Vice President, Treasurer
--     and Secretary (by `system_key`)                      -> Exec board
--   the seeded Member                                      -> Members
--   the seeded New Member                                  -> New members
--   the seeded Alumni, and any role with no permissions    -> outside the tiers
--   any other role holding a permission Member lacks       -> Officers and chairs
--   any other role                                         -> Members
--
-- Each tier then takes the permissions every one of its seeded, non-wildcard
-- roles already holds (all of its non-wildcard roles when it has no seeded
-- one), and each role records its difference from the tier as overrides.
-- **No role's `permissions` is written**: the triggers are created after the
-- placement, so the column is byte-for-byte what it was. The PGlite tier
-- `role-tiers.mjs` proves it.
--
-- RLS on with no policies, the posture of every chapter-owned table here: the
-- API reads and writes with the service role.

-- Dropped first so that re-applying this file places roles with no trigger
-- running, exactly as the first apply does.
drop trigger if exists trg_roles_sync_permissions on public.roles;
do $$
begin
  if to_regclass('public.role_tiers') is not null then
    drop trigger if exists trg_role_tiers_sync_roles on public.role_tiers;
  end if;
end
$$;

create table if not exists public.role_tiers (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  position integer not null,
  name text not null,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_tiers_name_len
    check (char_length(btrim(name)) between 1 and 80),
  constraint role_tiers_position_range
    check (position between 1 and 1000),
  constraint role_tiers_no_wildcard
    check (not ('*' = any (permissions))),
  -- The target of the composite foreign key on roles.
  constraint role_tiers_id_chapter unique (id, chapter_id),
  -- One tier per position. Deferrable so a reorder, which is one UPDATE, is
  -- checked when the statement ends and not row by row.
  constraint role_tiers_chapter_position unique (chapter_id, position)
    deferrable initially immediate
);

-- One tier per name in a chapter, ignoring case and outer whitespace.
create unique index if not exists idx_role_tiers_name
  on public.role_tiers (chapter_id, lower(btrim(name)));

alter table public.role_tiers enable row level security;

drop trigger if exists trg_role_tiers_updated_at on public.role_tiers;
create trigger trg_role_tiers_updated_at
  before update on public.role_tiers
  for each row execute function update_updated_at();

comment on table public.role_tiers is
  'A chapter''s ordered tiers of roles; position 1 is highest. permissions is what every role in the tier gets before its own overrides. See 20261111140000_role_tiers.sql.';

alter table public.roles
  add column if not exists tier_id uuid,
  add column if not exists permission_overrides jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'roles_permission_overrides_object'
  ) then
    alter table public.roles
      add constraint roles_permission_overrides_object
      check (jsonb_typeof(permission_overrides) = 'object');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'roles_tier_fk'
  ) then
    alter table public.roles
      add constraint roles_tier_fk
      foreign key (tier_id, chapter_id)
      references public.role_tiers (id, chapter_id);
  end if;
end
$$;

-- For reading a tier's roles and for the tier trigger's rewrite.
create index if not exists idx_roles_tier
  on public.roles (tier_id)
  where tier_id is not null;

comment on column public.roles.tier_id is
  'The role_tiers row this role sits in, or null for a role outside the tiers. Same chapter only (composite foreign key).';
comment on column public.roles.permission_overrides is
  'Permission key to true (on for this role whatever its tier says) or false (off). roles.permissions is always the tier''s permissions with these applied.';

-- ── The one definition of a role's effective permissions ──────────────────
--
-- Sorted and distinct. A value that is not JSON true or false is ignored.

create or replace function public.role_effective_permissions(
  p_tier_permissions text[],
  p_overrides jsonb
)
returns text[]
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(s.p order by s.p), '{}'::text[])
    from (
      select unnest(coalesce(p_tier_permissions, '{}'::text[])) as p
      union
      select o.key
        from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) as o
       where o.value = 'true'::jsonb
    ) s
   where coalesce(p_overrides -> s.p, 'null'::jsonb) <> 'false'::jsonb;
$$;

comment on function public.role_effective_permissions(text[], jsonb) is
  'A role''s effective permissions: its tier''s, plus overrides that are true, minus overrides that are false. Sorted, distinct. See 20261111140000_role_tiers.sql.';

-- ── Existing chapters: the starting tiers, and each role's place ──────────
--
-- Runs before the triggers exist, so `roles.permissions` is never written.
-- Only a chapter with no tiers is touched, so re-applying changes nothing.

do $$
declare
  v_chapter uuid;
  v_exec uuid;
  v_officers uuid;
  v_members uuid;
  v_new_members uuid;
  v_member_permissions text[];
begin
  for v_chapter in
    select c.id
      from public.chapters c
     where not exists (
       select 1 from public.role_tiers t where t.chapter_id = c.id
     )
  loop
    insert into public.role_tiers (chapter_id, position, name)
      values (v_chapter, 1, 'Exec board') returning id into v_exec;
    insert into public.role_tiers (chapter_id, position, name)
      values (v_chapter, 2, 'Officers and chairs') returning id into v_officers;
    insert into public.role_tiers (chapter_id, position, name)
      values (v_chapter, 3, 'Members') returning id into v_members;
    insert into public.role_tiers (chapter_id, position, name)
      values (v_chapter, 4, 'New members') returning id into v_new_members;

    select r.permissions into v_member_permissions
      from public.roles r
     where r.chapter_id = v_chapter and r.system_key = 'MEMBER';
    v_member_permissions := coalesce(v_member_permissions, '{}'::text[]);

    update public.roles r
       set tier_id = case
             when '*' = any (r.permissions)
               or r.system_key in
                    ('PRESIDENT', 'VICE_PRESIDENT', 'TREASURER', 'SECRETARY')
               then v_exec
             when r.system_key = 'MEMBER' then v_members
             when r.system_key = 'NEW_MEMBER' then v_new_members
             when r.system_key = 'ALUMNI' then null
             when cardinality(r.permissions) = 0 then null
             when not (r.permissions <@ v_member_permissions) then v_officers
             else v_members
           end
     where r.chapter_id = v_chapter;

    -- A tier starts with what every one of its seeded, non-wildcard roles
    -- holds; with no seeded role in it, every non-wildcard role counts.
    update public.role_tiers t
       set permissions = coalesce((
             with basis as (
               select r.id, r.permissions
                 from public.roles r
                where r.tier_id = t.id
                  and not ('*' = any (r.permissions))
                  and (
                    r.system_key is not null
                    or not exists (
                      select 1 from public.roles k
                       where k.tier_id = t.id
                         and k.system_key is not null
                         and not ('*' = any (k.permissions))
                    )
                  )
             )
             select array_agg(x.p order by x.p)
               from (
                 select p
                   from basis b, unnest(b.permissions) as p
                  group by p
                 having count(distinct b.id) = (select count(*) from basis)
               ) x
           ), '{}'::text[])
     where t.chapter_id = v_chapter;

    -- Each role's difference from its tier, so that
    -- role_effective_permissions(tier, overrides) is the list it holds now.
    update public.roles r
       set permission_overrides = coalesce((
             select jsonb_object_agg(o.k, o.v)
               from (
                 select p as k, true as v
                   from unnest(r.permissions) as p
                  where not (p = any (coalesce(t.permissions, '{}'::text[])))
                 union all
                 select p, false
                   from unnest(coalesce(t.permissions, '{}'::text[])) as p
                  where not (p = any (r.permissions))
               ) o
           ), '{}'::jsonb)
      from public.roles r2
      left join public.role_tiers t on t.id = r2.tier_id
     where r2.id = r.id
       and r.chapter_id = v_chapter;
  end loop;
end
$$;

-- ── Keeping roles.permissions equal to the effective list ─────────────────

create or replace function public.roles_sync_permissions()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tier text[] := '{}'::text[];
  v_effective text[];
  v_overrides jsonb;
  v_from_permissions boolean;
  v_permission text;
begin
  -- A null list is not a list: leave it for the column's NOT NULL to refuse,
  -- as it always has, and do not read it as "no permissions".
  if new.permissions is null then
    return new;
  end if;

  if new.tier_id is not null then
    -- FOR SHARE: a tier whose permissions are being changed in another
    -- transaction is waited for, so this role is written from the tier's new
    -- list and not the one about to be replaced. It also makes that other
    -- transaction wait for this one, so its rewrite sees this role.
    select t.permissions into v_tier
      from public.role_tiers t
     where t.id = new.tier_id
       for share;
    v_tier := coalesce(v_tier, '{}'::text[]);
  end if;
  v_effective :=
    public.role_effective_permissions(v_tier, new.permission_overrides);

  -- Did the writer set only `permissions`? On insert: a list with no
  -- overrides. On update: the list changed and neither the tier nor the
  -- overrides did.
  if tg_op = 'INSERT' then
    v_from_permissions :=
      new.permission_overrides = '{}'::jsonb
      and cardinality(new.permissions) > 0;
  else
    v_from_permissions :=
      new.tier_id is not distinct from old.tier_id
      and new.permission_overrides = old.permission_overrides
      and new.permissions is distinct from old.permissions;
  end if;

  if new.permissions @> v_effective and new.permissions <@ v_effective then
    -- Already the effective list (this is also how the tier trigger's
    -- rewrite arrives). Nothing to do.
    return new;
  end if;

  if not v_from_permissions then
    new.permissions := v_effective;
    return new;
  end if;

  -- The writer's list wins. Record the difference as overrides, changing as
  -- few as possible.
  v_overrides := new.permission_overrides;
  for v_permission in
    select unnest(new.permissions) except select unnest(v_effective)
  loop
    if v_permission = any (v_tier) then
      -- Off by an override; the tier already grants it.
      v_overrides := v_overrides - v_permission;
    else
      v_overrides := v_overrides || jsonb_build_object(v_permission, true);
    end if;
  end loop;
  for v_permission in
    select unnest(v_effective) except select unnest(new.permissions)
  loop
    if v_permission = any (v_tier) then
      v_overrides := v_overrides || jsonb_build_object(v_permission, false);
    else
      -- On by an override only.
      v_overrides := v_overrides - v_permission;
    end if;
  end loop;
  new.permission_overrides := v_overrides;
  return new;
end;
$$;

comment on function public.roles_sync_permissions() is
  'Trigger: keeps roles.permissions equal to role_effective_permissions(tier, overrides); a write of permissions alone is recorded as overrides. See 20261111140000_role_tiers.sql.';

create or replace function public.role_tiers_sync_roles()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.roles r
     set permissions =
           public.role_effective_permissions(new.permissions, r.permission_overrides)
   where r.tier_id = new.id;
  return null;
end;
$$;

comment on function public.role_tiers_sync_roles() is
  'Trigger: after a tier''s permissions change, rewrites roles.permissions on every role in it. See 20261111140000_role_tiers.sql.';

create trigger trg_roles_sync_permissions
  before insert or update on public.roles
  for each row execute function public.roles_sync_permissions();

create trigger trg_role_tiers_sync_roles
  after update of permissions on public.role_tiers
  for each row
  when (old.permissions is distinct from new.permissions)
  execute function public.role_tiers_sync_roles();

-- Trigger functions are not RPCs, and the helper is called only by them and
-- by the API's service role.
revoke all on function public.role_effective_permissions(text[], jsonb) from public;
revoke all on function public.roles_sync_permissions() from public;
revoke all on function public.role_tiers_sync_roles() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.role_effective_permissions(text[], jsonb) from anon;
    revoke all on function public.roles_sync_permissions() from anon;
    revoke all on function public.role_tiers_sync_roles() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.role_effective_permissions(text[], jsonb) from authenticated;
    revoke all on function public.roles_sync_permissions() from authenticated;
    revoke all on function public.role_tiers_sync_roles() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.role_effective_permissions(text[], jsonb) to service_role;
  end if;
end
$$;
