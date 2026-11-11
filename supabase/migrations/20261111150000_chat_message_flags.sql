-- Message flags (#3921, slice 1 of 4).
--
-- spec/behavior/chat/README.md § Message flags owns the rule. A member marks a
-- sent message with one flag (Important, Funny, Question, Hype or FYI). The
-- flag is a fact about the message, the same for every reader, so it lives on
-- the row beside `is_pinned`, and its Realtime UPDATE echo carries it to every
-- open timeline the way an edit or a pin already travels.
--
-- Additive only:
--
-- 1. `chat_messages.flag` (text, nullable): the flag, or null for none. The
--    CHECK mirrors `CHAT_MESSAGE_FLAGS` in `@repo/validation`, and a spec
--    there reads this file to keep the two lists equal.
-- 2. `chat_messages.flagged_by` (uuid, nullable, FK to `users (id)`, on
--    delete set null): who added it. Account deletion tombstones the `users`
--    row in place (`anonymize_user`), so the `set null` covers only a hard
--    delete, which no product path does.
-- 3. `chat_messages.flagged_at` (timestamptz, nullable): when.
-- 4. A CHECK that an unflagged row carries no flagger or time, so clearing a
--    flag cannot leave a stale "flagged by" behind.
--
-- `chat_messages` has a SELECT policy for members and no write policy (every
-- write is the API, service role), so no client can set a flag directly.

alter table public.chat_messages
  add column if not exists flag text,
  add column if not exists flagged_by uuid,
  add column if not exists flagged_at timestamptz;

alter table public.chat_messages
  drop constraint if exists chat_messages_flag_known,
  drop constraint if exists chat_messages_flag_cleared;

-- Added `not valid` and validated after, so the scan of existing rows runs
-- under the validation's lighter lock rather than the ALTER's exclusive one.
-- Every existing row is null, so neither check rejects anything.
alter table public.chat_messages
  add constraint chat_messages_flag_known
    check (flag is null or flag in ('important', 'funny', 'question', 'hype', 'fyi'))
    not valid,
  add constraint chat_messages_flag_cleared
    check (flag is not null or (flagged_by is null and flagged_at is null))
    not valid;

alter table public.chat_messages validate constraint chat_messages_flag_known;
alter table public.chat_messages validate constraint chat_messages_flag_cleared;

-- `not valid`, then validated, the shape the other foreign keys added to
-- existing tables use. Every existing row is null, so validation rejects
-- nothing.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_messages_flagged_by_fk'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_flagged_by_fk
      foreign key (flagged_by) references public.users (id)
      on delete set null
      not valid;
  end if;
end
$$;

alter table public.chat_messages validate constraint chat_messages_flagged_by_fk;
