-- Account deletion / PII anonymization (FRA-40).
--
-- spec/behavior/data-retention.md "Individual Account Deletion" requires a
-- user's PII to be scrubbed while their point transactions, attendance, chat
-- messages, and service entries stay preserved and attributed to "Deleted
-- User". A hard DELETE of the users row cannot do that: point_transactions,
-- event_attendance, service_entries, poll_votes, and message_reactions all
-- reference users(id) ON DELETE CASCADE (the history would be destroyed), and
-- chat_messages.sender_id, tasks.assignee_id/created_by,
-- backwork_resources.uploader_id, chapter_documents.uploaded_by, and
-- invites.created_by are NOT NULL with no ON DELETE action (the delete would
-- be rejected outright). The row therefore becomes an anonymized *tombstone*:
-- PII columns are overwritten in place, history keeps its foreign keys, and
-- every consumer that joins users for a display name naturally renders
-- "Deleted User".
--
-- `deleted_at` marks the tombstone. It is the idempotency guard for retries
-- (the API may re-run the flow when Supabase Auth deletion or storage cleanup
-- fails after the DB scrub) and lets interested surfaces distinguish a
-- tombstone from a live profile.
--
-- The email is replaced with a per-user sentinel under the RFC 2606 reserved
-- `.invalid` TLD: guaranteed undeliverable, collision-free with real emails,
-- and unique per user so lookups by email cannot alias two tombstones.
--
-- Current-state rows are deleted outright — they are the user's own device
-- registrations, preferences, and inbox, not chapter history: members (which
-- cascades member_custom_field_values), user_settings, push_tokens,
-- notifications, notification_preferences, chat_notification_preferences,
-- channel_read_receipts, and study_sessions. Study sessions are deliberately
-- in the delete set: they are location-presence history (geofence + time
-- window) and not on the spec's preserved list; the points they yielded live
-- on in point_transactions, which is preserved.
--
-- Task/points chat cards embed display-name snapshots in their jsonb payloads
-- ("stays a correct record even if a member later leaves the chapter" — see
-- TaskService.postTaskCard / PointsService.postPointsCard). Data-retention
-- trumps snapshot fidelity, so the snapshots for the deleted user are
-- rewritten to "Deleted User". Free-text content that merely *mentions* the
-- user (chat text, notification bodies sent to other members) is out of scope,
-- exactly like a name typed into any preserved chat message.
--
-- `security invoker` matches the sibling atomic RPCs (transfer_presidency,
-- check_in_event, confirm_task_completion, approve_service_entry): the API
-- always calls this via the service-role SUPABASE_CLIENT, which bypasses RLS,
-- and EXECUTE is locked to service_role below so no anon/authenticated caller
-- can reach it.

alter table users
  add column if not exists deleted_at timestamptz;

create or replace function anonymize_user(p_user_id uuid)
returns setof users
language plpgsql
security invoker
as $$
declare
  v_user users;
begin
  -- The seeded "Frapp System" actor (chapter_directory_requests migration) is
  -- not a real account and must never be tombstoned. The API only ever passes
  -- the authenticated caller's own id, so this is defense in depth.
  if p_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'anonymize_user: refusing to anonymize the system user'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Lock the row so a concurrent duplicate call serializes behind this one,
  -- observes deleted_at, and returns the tombstone instead of re-scrubbing.
  select * into v_user from users where id = p_user_id for update;

  if not found then
    return; -- unknown user: empty result, the API maps this to 404
  end if;

  -- Idempotent retry: everything below already ran in a committed transaction.
  if v_user.deleted_at is not null then
    return next v_user;
    return;
  end if;

  update users
     set email = 'deleted+' || p_user_id::text || '@anonymized.invalid',
         display_name = 'Deleted User',
         avatar_url = null,
         bio = null,
         graduation_year = null,
         current_city = null,
         current_company = null,
         active_chapter_id = null,
         deleted_at = now()
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
  delete from study_sessions where user_id = p_user_id;

  -- Display-name snapshots in system-generated cards. Keyed on the *_user_id
  -- fields the card writers embed next to each name, so only this user's
  -- snapshots are rewritten. `payload ||` preserves every other key.
  update chat_messages
     set payload = payload || jsonb_build_object('assigner_name', 'Deleted User')
   where kind = 'task'
     and payload->>'assigner_user_id' = p_user_id::text;

  update chat_messages
     set payload = payload || jsonb_build_object('assignee_name', 'Deleted User')
   where kind = 'task'
     and payload->>'assignee_user_id' = p_user_id::text;

  update chat_messages
     set payload = payload || jsonb_build_object('actor_name', 'Deleted User')
   where kind = 'points'
     and payload->>'actor_user_id' = p_user_id::text;

  update chat_messages
     set payload = payload || jsonb_build_object('recipient_name', 'Deleted User')
   where kind = 'points'
     and payload->>'recipient_user_id' = p_user_id::text;

  return next v_user;
end;
$$;

-- Lock EXECUTE to the service role the API uses; AccountDeletionService (via
-- the service-role SUPABASE_CLIENT) is the only legitimate caller. Postgres
-- grants EXECUTE to PUBLIC by default and Supabase additionally grants
-- anon/authenticated, so all three must be revoked. Roles are guarded on
-- existence to keep the migration portable to bare Postgres substrates
-- (e.g. PGlite in CI).
revoke execute on function anonymize_user(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function anonymize_user(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function anonymize_user(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function anonymize_user(uuid) to service_role;
  end if;
end
$$;
