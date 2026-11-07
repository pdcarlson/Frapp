-- Invites remember who they were emailed to, and a revoke is told apart from a
-- join (spec/behavior/members.md § Invite Flow).
--
-- `email`: the address `POST /v1/invites/email` sent this invite to, so the
-- web Invite members panel can list "alice@school.edu · Pending" instead of a
-- raw token. Null for a share-link invite, and for every row minted before this
-- column existed. Not matched against `users.email` at redeem (Hide My Email
-- still joins), so it is display only.
--
-- `revoked_at`: set by `DELETE /v1/invites/:id`. A revoke still sets `used_at`
-- too, so every path that refuses a used token keeps refusing a revoked one
-- unchanged; `revoked_at` is only what lets the list say Revoked rather than
-- Joined (#3607).
--
-- Both additive and nullable: no backfill, no lock beyond the catalog update.
alter table public.invites
  add column if not exists email text,
  add column if not exists revoked_at timestamptz;
