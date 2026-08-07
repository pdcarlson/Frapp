-- FRA-321: ROLE_GATED channels no longer fall open.
--
-- Two gaps compounded. `ChapterService.create` seeded channels without ever
-- persisting `required_permissions`, and both copies of the read predicate --
-- `canAccessChannel` (packages/validation/src/index.ts) and its SQL twin
-- `public.can_read_chat_message` below -- treated an empty requirement list as
-- "any chapter member". A ROLE_GATED channel was therefore functionally PUBLIC.
--
-- That mattered because the Alumni posting rule (FRA-96 / FRA-32) keyed on
-- channel *type*: ROLE_GATED was alumni-postable, so a chapter's `#exec-board`
-- was open to alumni whether or not it gated on anything. The application layer
-- now gates alumni writes on the channel requiring `alumni:post`, and denies a
-- ROLE_GATED channel whose requirement list is empty.
--
-- This migration makes the data match that invariant BEFORE the closed
-- predicate can observe it. Additive only: no column, constraint, policy, or
-- row is dropped, and the two updates only populate a column that is currently
-- null. `create or replace function` retains the existing ACL; the revoke/grant
-- block is re-applied anyway so the function's privileges stay self-contained.

-- 1. The seeded `#alumni` channel. `members:view` is held by every seeded role
--    (President via `*`), which preserves the spec'd "visible to Alumni AND
--    active members" read behavior; `alumni:post` is the marker that makes it
--    the one ROLE_GATED channel alumni may author in.
update chat_channels
set required_permissions = array['members:view', 'alumni:post']::text[]
where type = 'ROLE_GATED'
  and name = 'alumni'
  and coalesce(array_length(required_permissions, 1), 0) = 0;

--    Known residual: a chapter that RENAMED #alumni is not matched here, and is
--    indistinguishable from a chapter-created role-gated channel -- picking one
--    would be a guess about intent, the same call the FRA-320 role backfill made
--    for renamed system roles. Such a channel falls to step 2 instead, so its
--    members keep reading it and only alumni posting stops. Recoverable without
--    a migration: an officer with `channels:manage` adds `alumni:post` to the
--    channel's required_permissions.
--
-- 2. Every other ROLE_GATED channel that gates on nothing -- the shape the old
--    seeder produced and the API still accepted. `members:view` is exactly
--    today's effective behavior ("any active member can read"), so no existing
--    chapter loses access when the predicate closes below. What it does remove
--    is the unmarked fall-open: these channels are no longer alumni-postable,
--    because they do not require `alumni:post`.
update chat_channels
set required_permissions = array['members:view']::text[]
where type = 'ROLE_GATED'
  and coalesce(array_length(required_permissions, 1), 0) = 0;

-- 3. Keep existing Alumni roles consistent with DEFAULT_SYSTEM_ROLES, which now
--    seeds `alumni:post`. Resolved by the rename-proof `system_key` (FRA-320),
--    never by name. Idempotent: the guard skips roles that already carry it.
update roles
set permissions = permissions || array['alumni:post']::text[]
where system_key = 'ALUMNI'
  and not ('alumni:post' = any (permissions));

-- 4. The SQL twin of the read predicate. This function deliberately mirrors
--    `canAccessChannel`; leaving it open while the TypeScript side closes is the
--    drift that produced this bug in the first place. Only the ROLE_GATED branch
--    changes -- an empty requirement list now denies instead of allowing.
create or replace function public.can_read_chat_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
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
$$;

-- Re-apply the lockdown from 20260803150000 so this function's privileges do not
-- depend on replace-time ACL retention. Guarded on role existence so the
-- migration also applies on bare-Postgres substrates (PGlite/CI).
revoke execute on function public.can_read_chat_message(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.can_read_chat_message(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.can_read_chat_message(uuid) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.can_read_chat_message(uuid) to service_role;
  end if;
end
$$;
