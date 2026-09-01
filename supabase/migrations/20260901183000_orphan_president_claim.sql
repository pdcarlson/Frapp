-- Orphan-president claim flow (#349, spec/behavior/rbac.md § Presidency
-- Transfer, "Edge case").
--
-- Until now, a chapter that lost its President outside a voluntary transfer
-- (account deletion, or manual removal by Frapp support via `members:remove`)
-- had no recovery path at all: `transfer_presidency` requires a CURRENT
-- President to initiate it, and nothing flagged the chapter or told the next
-- officer they could step up. `needs_president` is the flag; `claim_presidency`
-- is the atomic RPC a member the API has already deemed eligible calls to pick
-- up the role.
--
-- `needs_president` defaults false and is only ever set true by
-- `RbacService.flagIfPresidentRemoved`, which runs after a member holding the
-- wildcard-carrying President role is removed (`MemberService.remove`) or their
-- account is anonymized (`AccountDeletionService`).

alter table chapters
  add column if not exists needs_president boolean not null default false;

-- Atomic presidency claim. Mirrors `transfer_presidency` (20260604120000): both
-- writes happen in the same implicit transaction, and the first is a
-- compare-and-set so a race between two eligible claimants resolves to exactly
-- one winner.
--
-- Unlike a transfer, there is no current holder to strip the role from — the
-- compare-and-set instead guards `chapters.needs_president`, flipping it back
-- to false only when it is still true. A concurrent second claim's UPDATE
-- matches zero rows, falls through `not found`, and returns false; the API
-- maps that to a 409 ("someone else already claimed it").
--
-- Eligibility (is this the chapter's next-highest-ranked officer role, and
-- does this member hold it?) is resolved by `RbacService.claimPresidency`
-- before this RPC runs, but that read and this write are not the same
-- transaction — a concurrent `PATCH /v1/members/:id/roles` could strip
-- `p_eligible_role_id` from the member in between. So the member UPDATE below
-- re-verifies `p_eligible_role_id = any(role_ids)` itself, atomically with the
-- grant: a member who no longer holds it cannot be made President even if the
-- application-layer check already passed.
--
-- members.role_ids is text[] (not uuid[]); role ids are passed as text, same
-- as transfer_presidency.
create or replace function claim_presidency(
  p_chapter_id uuid,
  p_claiming_member_id uuid,
  p_eligible_role_id text,
  p_president_role_id text
)
returns boolean
language plpgsql
security invoker
as $$
begin
  update chapters
     set needs_president = false
   where id = p_chapter_id
     and needs_president = true;

  if not found then
    return false;
  end if;

  -- Compare-and-set on the claiming member: only grant when they are still in
  -- the chapter AND still hold the role that made them eligible. Idempotent on
  -- the President role itself (only add if absent) — defensive; the API only
  -- ever calls this for a member it just verified does not hold it yet.
  update members
     set role_ids = case
           when p_president_role_id = any(role_ids) then role_ids
           else array_append(role_ids, p_president_role_id)
         end
   where id = p_claiming_member_id
     and chapter_id = p_chapter_id
     and p_eligible_role_id = any(role_ids);

  if not found then
    -- Either the claiming member vanished from the chapter, or (the race this
    -- re-check exists for) another request moved the eligible role off them
    -- since the application-layer check ran. Raise so the needs_president
    -- flip above rolls back too — otherwise the chapter would be stuck with
    -- the flag cleared and nobody holding the role.
    raise exception 'claim_presidency: member % no longer holds role % in chapter %',
      p_claiming_member_id, p_eligible_role_id, p_chapter_id
      using errcode = 'no_data_found';
  end if;

  return true;
end;
$$;

-- Lock EXECUTE to the service role, same as transfer_presidency: RbacService
-- (via the service-role SUPABASE_CLIENT) is the only legitimate caller.
revoke execute on function claim_presidency(uuid, uuid, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function claim_presidency(uuid, uuid, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function claim_presidency(uuid, uuid, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_presidency(uuid, uuid, text, text) to service_role;
  end if;
end
$$;
