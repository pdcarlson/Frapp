-- AI suggestions (#4309, ADR-28 decision 11, spec/behavior/ai.md § Suggestions).
--
-- One table of proposals for every AI feature that proposes instead of
-- answers: a task drafted from minutes first, later a decision worth logging,
-- a value for a form field, the acting agent's actions. A row is a proposal
-- and grants nothing. Accepting one re-checks the accepter's permission at
-- that moment and commits through the ordinary service for its kind (a task
-- goes through the task service), all in the API.
--
-- 1. `ai_suggestions`. RLS on and no policies: API only (service role).
--    - `kind` names what accepting it makes, and `required_permission` the
--      permission the accepter must hold when they accept (copied from the
--      kind when the row is written, so the list can filter on it in SQL).
--    - `source_type` / `source_id` name what it was drawn from: a meeting's
--      minutes, an event, a channel. There is no foreign key, because the
--      source is one of several tables; the triggers in 2 remove a waiting
--      suggestion when its source is deleted.
--    - `batch_id` + `ordinal` make writing a batch idempotent: a run that
--      retries writes nothing twice. One batch sends one push.
--    - `run_id` is the AI run that produced it (#4310). Its foreign key is
--      added by a later migration once that table exists.
--    - A waiting suggestion holds the AI's text (`payload`, `quote`) because
--      a person has to read it to decide. Once decided or expired it keeps
--      none: who decided, when, and what it became (`result_id`) stay, the
--      text goes (`ai_suggestions_decided_hold_no_text`). That keeps the
--      table outside spec/behavior/ai.md § Stored AI text.
--    - `accepting` is the moment between an officer's Accept and the change
--      being made. The row keeps its text, so a commit that fails, or an API
--      that dies mid-accept, puts it back to `pending` intact (the API
--      releases one left `accepting` for ten minutes).
--    - `quote_author_id` is whose words the quote is, when they are a
--      member's (a chat message). For the consent work (#4308): a member who
--      turns AI off takes their words out of every waiting suggestion.
--    - `notified_at` marks the rows whose batch push went out, so a run that
--      retries after writing its rows but before the push still sends it.
-- 2. `ai_suggestions_drop_for_source()`, fired after a delete on `events` and
--    `chat_channels`: their waiting (and mid-accept) suggestions go with them. A decided row
--    holds no text and is kept as the record of the decision. The trigger for
--    minutes (`source_type = 'meeting'`) is added with the meetings table.
--
-- Locks. The foreign keys add triggers to `chapters` and `users`, and the
-- delete triggers are created on `events` and `chat_channels`, each taking a
-- SHARE ROW EXCLUSIVE lock until commit: writes to those four tables wait for
-- the file to commit. The table is new and empty, so that is milliseconds.

-- 1. ------------------------------------------------------------------------

create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  batch_id uuid not null,
  ordinal smallint not null check (ordinal between 0 and 199),
  run_id uuid,
  -- The member the run acted for (spec/behavior/ai.md § Whose access an AI
  -- run uses). Users are tombstoned in place, so `set null` rarely fires.
  requested_for uuid references users(id) on delete set null,
  kind text not null check (kind in ('task')),
  source_type text not null check (source_type in ('meeting', 'event', 'channel')),
  source_id uuid not null,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16000),
  quote text check (quote is null or char_length(quote) between 1 and 1000),
  quote_author_id uuid references users(id) on delete set null,
  required_permission text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepting', 'accepted', 'dismissed', 'expired')),
  edited boolean not null default false,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  result_id uuid,
  notified_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ai_suggestions_batch_ordinal_key unique (batch_id, ordinal),
  constraint ai_suggestions_decided_hold_no_text check (
    status in ('pending', 'accepting')
    or (payload = '{}'::jsonb and quote is null and quote_author_id is null)
  ),
  constraint ai_suggestions_decided_has_time check (
    (status in ('accepting', 'accepted', 'dismissed')) = (decided_at is not null)
  )
);

alter table public.ai_suggestions enable row level security;

-- The officer's Suggested list: a chapter's waiting suggestions, newest first.
create index if not exists idx_ai_suggestions_pending
  on public.ai_suggestions (chapter_id, created_at desc)
  where status = 'pending';

-- The list for one source (a meeting's review screen), and the delete trigger.
create index if not exists idx_ai_suggestions_pending_source
  on public.ai_suggestions (source_type, source_id)
  where status in ('pending', 'accepting');

-- A batch's rows still owed their push.
create index if not exists idx_ai_suggestions_unnotified
  on public.ai_suggestions (batch_id)
  where notified_at is null;

-- The hourly expiry sweep.
create index if not exists idx_ai_suggestions_pending_expiry
  on public.ai_suggestions (expires_at)
  where status = 'pending';

-- The sweep's release of an accept that never finished.
create index if not exists idx_ai_suggestions_accepting
  on public.ai_suggestions (decided_at)
  where status = 'accepting';

-- Consent: take a member's words out of every waiting suggestion.
create index if not exists idx_ai_suggestions_quote_author
  on public.ai_suggestions (quote_author_id)
  where quote_author_id is not null;

-- 2. ------------------------------------------------------------------------

create or replace function public.ai_suggestions_drop_for_source()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.ai_suggestions
   where source_type = tg_argv[0]
     and source_id = old.id
     and chapter_id = old.chapter_id
     and status in ('pending', 'accepting');
  return old;
end;
$$;

revoke execute on function public.ai_suggestions_drop_for_source()
  from public, anon, authenticated;

drop trigger if exists events_drop_ai_suggestions on public.events;
create trigger events_drop_ai_suggestions
  after delete on public.events
  for each row execute function public.ai_suggestions_drop_for_source('event');

drop trigger if exists chat_channels_drop_ai_suggestions on public.chat_channels;
create trigger chat_channels_drop_ai_suggestions
  after delete on public.chat_channels
  for each row execute function public.ai_suggestions_drop_for_source('channel');
