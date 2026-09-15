-- #2257 follow-on: teach `anonymize_user` about `chat_member_blocks`, and add
-- the `rush_candidate_votes` purge the same block has been missing since #494.
--
-- The block list (20260915210000) is per-user current state, structurally
-- identical to `chat_message_bookmarks` and `channel_read_receipts`, both of
-- which this function already purges.
--
-- Why the table's own `on delete cascade` is not enough: FRA-40's whole design
-- is that account deletion converts the `users` row into an anonymized
-- TOMBSTONE and never deletes it, precisely so the auth id stays resolvable and
-- PATCH /v1/users/me cannot write PII back. No delete on `users` means no
-- cascade, ever. Every sibling per-user table is purged by an explicit line
-- here for exactly that reason.
--
-- ONLY THE BLOCKER SIDE IS PURGED, and that asymmetry is the point. Deleting
-- the rows where the departing member is the BLOCKER is the ordinary case:
-- their own current-state safety list, which nothing should outlive them.
-- Deleting the rows where they are the BLOCKED party would be a safety
-- regression, not a privacy win. This function tombstones rather than deletes,
-- and chat messages are preserved (spec/behavior/data-retention.md), so every
-- message the departing member ever sent keeps its `sender_id` forever -- and
-- the mask is applied client-side to every rendered row, not only to new ones.
-- Purging the blocked side would therefore let a reported member clear every
-- block standing against him, in every chapter, by deleting his own account,
-- and his whole preserved history would render in the clear again for the
-- people who blocked him. The residual cost of keeping those rows -- an
-- operator with database access can see that someone blocked a now-deleted
-- member -- is far smaller than handing the abuser an un-block button.
--
-- `chat_message_reports` is deliberately NOT purged either, for a related
-- reason. A report is moderation history, not per-user current state: the
-- officer queue and any action taken from it must survive the reporter closing
-- their account, or a member could erase the record of a report by deleting
-- their account. The reporter FK carries no `on delete` clause for the same
-- reason the `chapter_audit_log.actor_user_id` precedent does
-- (20260523130000_audit_log.sql:11): the tombstone makes a retained report
-- render as "Deleted User" rather than dangle. Reports filed ABOUT them are
-- retained for the same reason. Note this keeps the reporter's free-text
-- `details` and the `reported_content` snapshot -- including a departing
-- member's own words, where they are the reported party. The card scrub below
-- re-syncs that snapshot so a third party's display name does not linger in
-- it; spec/behavior/data-retention.md states the residue.
--
-- `rush_candidate_votes` (20260910020000, #494) is the same omission #462 was:
-- a per-user table added without a purge line, whose `on delete cascade` is
-- unreachable for the tombstone reason above. Left out, `(candidate_id,
-- chapter_id, voter_id, created_at)` survives account deletion as a durable
-- record of which prospective members a now-deleted brother voted on --
-- DB_ROLLBACK_PLAYBOOK.md already warns that dumping that table reveals who
-- voted. Fixed here rather than filed because it is the same function and the
-- same block this migration rewrites (spec/engineering.md § Changing existing
-- code: blast radius, not diff radius).
--
-- spec/behavior/data-retention.md owns the erasure contract and moves with this
-- migration; the runbooks link to it rather than restating it.
--
-- Whole function replaced rather than patched, per this repo's convention for
-- `create or replace` RPCs: the body below is 20260902160000's, unchanged apart
-- from the two added deletes. Idempotent and safe to re-run.

create or replace function anonymize_user(
  p_user_id uuid,
  p_rescan_cards boolean default false
)
returns setof users
language plpgsql
security invoker
as $$
declare
  v_user users;
  v_was_tombstoned boolean;
begin
  -- The seeded "Frapp System" actor (chapter_directory_requests migration) is
  -- not a real account and must never be tombstoned. The API only ever passes
  -- the authenticated caller's own id, so this is defense in depth.
  if p_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'anonymize_user: refusing to anonymize the system user'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Lock the row so a concurrent duplicate call serializes behind this one.
  -- No tombstone early-return (see header): a retry re-runs the whole scrub
  -- so PII written onto the tombstone during the retry window is re-scrubbed.
  select * into v_user from users where id = p_user_id for update;

  if not found then
    return; -- unknown user: empty result, the API maps this to 404
  end if;

  v_was_tombstoned := v_user.deleted_at is not null;

  update users
     set email = 'deleted+' || p_user_id::text || '@anonymized.invalid',
         display_name = 'Deleted User',
         avatar_url = null,
         bio = null,
         graduation_year = null,
         current_city = null,
         current_company = null,
         active_chapter_id = null,
         deleted_at = coalesce(v_user.deleted_at, now())
   where id = p_user_id
   returning * into v_user;

  -- Current-state purge (see header). members cascades
  -- member_custom_field_values via its composite FK.
  delete from members where user_id = p_user_id;
  delete from user_settings where user_id = p_user_id;
  delete from push_tokens where user_id = p_user_id;
  delete from notifications where user_id = p_user_id;
  delete from notification_preferences where user_id = p_user_id;
  delete from chat_notification_preferences where user_id = p_user_id;
  delete from channel_read_receipts where user_id = p_user_id;
  -- #462: personal chat bookmarks. Added here rather than relying on the
  -- FK's `on delete cascade`, which never fires: this function TOMBSTONES
  -- the users row (see header) instead of deleting it, so a cascade from
  -- users(id) is unreachable by construction. Left out, the tuple set
  -- (user_id, message_id, chapter_id, created_at) -- which is exactly the
  -- "who saved what" that spec/behavior/chat/README.md promises nobody can
  -- see -- would survive account deletion indefinitely.
  delete from chat_message_bookmarks where user_id = p_user_id;
  -- #2257: the member's own block list. Blocker side ONLY -- see the header for
  -- why purging the blocked side would hand the abuser an un-block button.
  delete from chat_member_blocks where blocker_user_id = p_user_id;
  -- #494, fixed here (see header): ballots the departing member cast.
  delete from rush_candidate_votes where voter_id = p_user_id;
  delete from study_sessions where user_id = p_user_id;

  -- Display-name snapshots in system-generated cards, both copies at once
  -- (see header). FIRST SUCCESSFUL SCRUB ONLY: the payload predicates are
  -- unindexable, so this is a full scan of chat_messages — and it only ever
  -- needs to run once, because snapshots are historical (with the memberships
  -- gone, no writer can ever attribute a new card to this user, and nothing
  -- rewrites card names back). Re-running it on every retry would let a
  -- client retrying through an auth outage re-scan the table in a loop.
  --
  -- Payload rewrites are keyed on the *_user_id fields the card writers embed
  -- next to each name, so only this user's snapshots change; `payload ||`
  -- preserves every other key, and the CASE arms are no-ops for rows the key
  -- doesn't match.
  --
  -- The `content` rewrite is keyed on each row's OWN payload name snapshot —
  -- not the live display name — so it survives renames (the snapshot is the
  -- exact string the writer embedded in `content`). Only the arms whose
  -- template actually prints the name rewrite content: task content prints
  -- the assignee, points content prints the recipient (assigner/actor names
  -- never appear in content, so those arms leave it alone). The name is
  -- regex-escaped and matched on word boundaries, so a deleted "Ann" cannot
  -- corrupt "Anna", and a whitespace-only name matches nothing. Event cards
  -- carry no payload name at all — their content template is
  -- '<creator> scheduled "<name>" …', written only by EventService as the
  -- sender, so the creator prefix is rewritten structurally (non-greedy:
  -- first ' scheduled "' wins). One statement, one scan.
  if not v_was_tombstoned or p_rescan_cards then
    update chat_messages
       set payload = case
             when payload is null then payload
             else payload
               || case when kind = 'task' and payload->>'assigner_user_id' = p_user_id::text
                       then jsonb_build_object('assigner_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'task' and payload->>'assignee_user_id' = p_user_id::text
                       then jsonb_build_object('assignee_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'points' and payload->>'actor_user_id' = p_user_id::text
                       then jsonb_build_object('actor_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'points' and payload->>'recipient_user_id' = p_user_id::text
                       then jsonb_build_object('recipient_name', 'Deleted User')
                       else '{}'::jsonb end
           end,
           content = case
             when kind = 'task' and payload->>'assignee_user_id' = p_user_id::text
               then anonymize_card_content(content, payload->>'assignee_name')
             when kind = 'points' and payload->>'recipient_user_id' = p_user_id::text
               then anonymize_card_content(content, payload->>'recipient_name')
             when kind = 'event' and sender_id = p_user_id
               then regexp_replace(content, '^(.*?)( scheduled ")', 'Deleted User\2')
             else content
           end
     where (kind = 'task' and (payload->>'assigner_user_id' = p_user_id::text
                            or payload->>'assignee_user_id' = p_user_id::text))
        or (kind = 'points' and (payload->>'actor_user_id' = p_user_id::text
                              or payload->>'recipient_user_id' = p_user_id::text))
        or (kind = 'event' and sender_id = p_user_id);

    -- #2257: the report evidence snapshot is a second copy of
    -- chat_messages.content, and the rewrite above does not reach it -- so a
    -- display name this function is scrubbing would survive verbatim in a table
    -- nothing ever purges. Note the exposed party need not be the reporter or
    -- the reported member: a points card names its recipient, so any third
    -- party named in a reported card is affected. Re-sync from the row that was
    -- just rewritten, which is exact rather than a second regex pass.
    --
    -- Scoped to the same rows the statement above touched, so this is not a
    -- table-wide rewrite. RESIDUE, stated rather than hidden: a report whose
    -- message was HARD-deleted has message_id NULL and cannot be re-synced --
    -- its snapshot keeps the pre-scrub name. That is a narrow, deliberate gap
    -- (the chapter erased the message; the moderation record is what is left),
    -- not an oversight. Ordinary message prose is out of scope in both copies:
    -- this scrub only ever rewrote card templates built from payload snapshots,
    -- never member free text, so nothing here widens or narrows that promise.
    update chat_message_reports r
       set reported_content = m.content
      from chat_messages m
     where r.message_id = m.id
       and ((m.kind = 'task' and (m.payload->>'assigner_user_id' = p_user_id::text
                               or m.payload->>'assignee_user_id' = p_user_id::text))
         or (m.kind = 'points' and (m.payload->>'actor_user_id' = p_user_id::text
                                 or m.payload->>'recipient_user_id' = p_user_id::text))
         or (m.kind = 'event' and m.sender_id = p_user_id));
  end if;

  return next v_user;
end;
$$;

-- Lock EXECUTE to the service role the API uses; AccountDeletionService (via
-- the service-role SUPABASE_CLIENT) is the only legitimate caller. Postgres
-- grants EXECUTE to PUBLIC by default and Supabase additionally grants
-- anon/authenticated, so all three must be revoked. Roles are guarded on
-- existence to keep the migration portable to bare Postgres substrates
-- (e.g. PGlite in CI).
revoke execute on function anonymize_user(uuid, boolean) from public;
revoke execute on function anonymize_card_content(text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function anonymize_user(uuid, boolean) from anon;
    revoke execute on function anonymize_card_content(text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function anonymize_user(uuid, boolean) from authenticated;
    revoke execute on function anonymize_card_content(text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function anonymize_user(uuid, boolean) to service_role;
    grant execute on function anonymize_card_content(text, text) to service_role;
  end if;
end
$$;
