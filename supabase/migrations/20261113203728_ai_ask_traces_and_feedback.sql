-- A trace of every Ask turn, and the member's thumbs on the answer (#4902,
-- epic #4898; spec/behavior/ai.md § Stored AI text).
--
-- Nobody could tell whether an answer was good: the usage ledger counts
-- provider calls but cannot group them into a turn, and nothing recorded
-- which tools a turn ran, how it ended, or what the member thought of it.
--
-- Neither table has a column that can hold a question, an answer, a tool's
-- arguments or a tool's result. Every text column is a code from a closed
-- set or a short machine name, and each is held to that by a check, so a
-- bug upstream cannot park a sentence here.
--
-- 1. `ai_ask_traces`: one row per turn. Who asked (ids), the door, the
--    prompt version, model and effort, how it ended, and counts.
-- 2. `ai_ask_trace_steps`: one row per model round and per tool call in the
--    turn: the tool's name, the size of its arguments and of its result,
--    how long it took, tokens and cost.
-- 3. `ai_ask_feedback`: the asker's thumbs up or down on that answer, and
--    on a down one of four reasons. One per answer, changeable.
--
-- When rows go. Every foreign key cascades: with the chapter, with the
-- asker's membership (they left the chapter, or deleted their account,
-- which removes their memberships), and with the asker's user row. Steps
-- and feedback go with their trace. The API deletes a member's traces when
-- they answer No on the AI sheet, and an hourly sweep deletes every trace
-- past `expires_at`, which the check holds to at most 90 days.
--
-- All three tables have RLS on and no policies: the API reads and writes
-- them with the service role. Writes no row.
--
-- Locks. The foreign keys add triggers to `chapters`, `users` and
-- `members`, taking a SHARE ROW EXCLUSIVE lock on each until commit. The
-- tables are new and empty, so that is milliseconds.

-- 1. ------------------------------------------------------------------------

create table if not exists public.ai_ask_traces (
  -- The ask's own id, the one the stream's `start` event carries.
  id uuid primary key,
  chapter_id uuid not null references chapters(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  door text not null,
  prompt_version text not null,
  model text not null,
  effort text not null,
  outcome text not null,
  -- Which limit stopped the turn, when one did.
  limit_kind text,
  error_kind text,
  is_follow_up boolean not null default false,
  -- The same member asked again within a minute of their last question.
  is_rephrase boolean not null default false,
  read_chat boolean not null default false,
  truncated boolean not null default false,
  rounds integer not null default 0,
  tool_calls integer not null default 0,
  tool_failures integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cost_micro_usd bigint not null default 0,
  duration_ms integer not null default 0,
  sources_read integer not null default 0,
  citations_kept integer not null default 0,
  citations_dropped integer not null default 0,
  left_out_messages integer not null default 0,
  proposals integer not null default 0,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint ai_ask_traces_door_is_a_code
    check (door ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint ai_ask_traces_prompt_version_is_a_code
    check (prompt_version ~ '^[a-z0-9][a-z0-9_.@-]{0,63}$'),
  constraint ai_ask_traces_model_is_a_code
    check (model ~ '^[a-z0-9][a-z0-9_.:/-]{0,95}$'),
  constraint ai_ask_traces_effort_is_a_code
    check (effort ~ '^[a-z][a-z0-9_]{0,15}$'),
  constraint ai_ask_traces_outcome_known
    check (outcome in (
      'answered', 'not_found', 'refused', 'limit', 'unavailable',
      'proposal', 'stopped', 'error'
    )),
  constraint ai_ask_traces_limit_kind_is_a_code
    check (limit_kind is null or limit_kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint ai_ask_traces_error_kind_is_a_code
    check (error_kind is null or error_kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint ai_ask_traces_counts_not_negative
    check (
      rounds >= 0 and tool_calls >= 0 and tool_failures >= 0
      and input_tokens >= 0 and output_tokens >= 0
      and cached_input_tokens >= 0 and cost_micro_usd >= 0
      and duration_ms >= 0 and sources_read >= 0 and citations_kept >= 0
      and citations_dropped >= 0 and left_out_messages >= 0
      and proposals >= 0
    ),
  constraint ai_ask_traces_at_most_90_days
    check (expires_at > started_at and expires_at <= started_at + interval '90 days')
);

create index if not exists ai_ask_traces_chapter_started
  on public.ai_ask_traces (chapter_id, started_at desc);
-- "Did this member ask within the last minute?", and a No on the AI sheet.
create index if not exists ai_ask_traces_user_started
  on public.ai_ask_traces (user_id, started_at desc);
create index if not exists ai_ask_traces_member
  on public.ai_ask_traces (member_id);
create index if not exists ai_ask_traces_expires_at
  on public.ai_ask_traces (expires_at);

alter table public.ai_ask_traces enable row level security;

comment on table public.ai_ask_traces is
  'One row per Ask turn: ids, codes and counts, never text. Deleted after at most 90 days. API only. See 20261113203728_ai_ask_traces_and_feedback.sql.';

-- 2. ------------------------------------------------------------------------

create table if not exists public.ai_ask_trace_steps (
  trace_id uuid not null references ai_ask_traces(id) on delete cascade,
  -- The order within the turn, from 0.
  seq smallint not null,
  round smallint not null,
  kind text not null,
  -- A tool's registered name. Null on a model round, and on a call to a
  -- name the registry does not hold (`outcome` says `unknown_tool`).
  tool text,
  outcome text not null,
  duration_ms integer not null default 0,
  -- A tool call: the size of what the model wrote and of what came back.
  arg_bytes integer not null default 0,
  result_chars integer not null default 0,
  result_sources integer not null default 0,
  -- A model round.
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cost_micro_usd bigint not null default 0,
  primary key (trace_id, seq),
  constraint ai_ask_trace_steps_kind_known check (kind in ('model', 'tool')),
  constraint ai_ask_trace_steps_tool_is_a_name
    check (tool is null or tool ~ '^[a-z][a-z0-9_]{0,47}$'),
  constraint ai_ask_trace_steps_model_has_no_tool
    check (kind = 'tool' or tool is null),
  constraint ai_ask_trace_steps_outcome_known
    check (outcome in (
      'ok', 'empty', 'invalid_args', 'denied', 'unknown_tool', 'over_limit',
      'refused', 'stopped', 'error'
    )),
  constraint ai_ask_trace_steps_counts_not_negative
    check (
      seq >= 0 and round >= 0 and duration_ms >= 0 and arg_bytes >= 0
      and result_chars >= 0 and result_sources >= 0 and input_tokens >= 0
      and output_tokens >= 0 and cached_input_tokens >= 0
      and cost_micro_usd >= 0
    )
);

-- "Which tools fail?" reads by tool across traces.
create index if not exists ai_ask_trace_steps_tool
  on public.ai_ask_trace_steps (tool, outcome)
  where kind = 'tool';

alter table public.ai_ask_trace_steps enable row level security;

comment on table public.ai_ask_trace_steps is
  'One row per model round and tool call of an Ask turn: names, sizes, timings and cost, never arguments or results. Goes with its trace. API only. See 20261113203728_ai_ask_traces_and_feedback.sql.';

-- 3. ------------------------------------------------------------------------

create table if not exists public.ai_ask_feedback (
  -- One per answer: only the asker can rate it, so the ask is the key.
  ask_id uuid primary key references ai_ask_traces(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  rating text not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_ask_feedback_rating_known check (rating in ('up', 'down')),
  constraint ai_ask_feedback_reason_known
    check (reason is null or reason in ('wrong', 'missed', 'too_long', 'other')),
  -- A reason belongs to a thumbs down only.
  constraint ai_ask_feedback_reason_only_on_down
    check (reason is null or rating = 'down')
);

create index if not exists ai_ask_feedback_chapter
  on public.ai_ask_feedback (chapter_id);
create index if not exists ai_ask_feedback_user
  on public.ai_ask_feedback (user_id);

alter table public.ai_ask_feedback enable row level security;

comment on table public.ai_ask_feedback is
  'The asker''s thumbs up or down on an Ask answer, with one of four reasons on a down. No text. Goes with its trace. API only. See 20261113203728_ai_ask_traces_and_feedback.sql.';
