-- #5627: the "<name> joined" notices wait until the new member has given
-- their name (Paul, 2026-11-19), so the membership keeps the invite it came
-- in by until then. Null for a founder, a member an officer added, and every
-- membership from before this migration (whose notices were already sent at
-- redeem).
alter table public.members
  add column if not exists joined_via_invite_id uuid
    references public.invites (id) on delete set null;

comment on column public.members.joined_via_invite_id is
  'The invite this membership was redeemed from (#5627). Read once, when the member first finishes onboarding, to tell the inviter and the officers who joined.';
