-- Report this (#4315; ADR-28 decision 8, spec/behavior/ai.md § Stored AI
-- text).
--
-- Frapp keeps no prompt or answer text, with two exceptions. This is the
-- first: a member who reports something the AI made (an Ask answer, a
-- drafted set of minutes, a suggested task) keeps that one exchange for the
-- Frapp team, encrypted, for 30 days. The other, Ask's diagnostics window,
-- is `20261112200000_ai_ask_diagnostics.sql`.
--
-- WHAT CHANGES
--
-- 1. `ai_reports`: one row per report.
--      subject_type, subject_id  what was reported: the ask's id, the draft's
--                                request id (a draft asked for again is a new
--                                thing to report), or the suggestion's id.
--                                One report per member per thing (unique).
--      reason, note              the member's reason, and their own optional
--                                words. Kept with or without a key.
--      sealed                    the exchange, as ciphertext
--                                (`v1.<key id>.<nonce>.<tag>.<ciphertext>`,
--                                AES-256-GCM, sealed by the API and bound to
--                                the chapter). Null when the server held no
--                                key: then nothing of the text is kept.
--      quoted_user_ids           members whose own words are inside `sealed`
--                                (chat authors in an answer's sources, the
--                                officer whose notes a draft came from, a
--                                suggestion's quoted member). Never the
--                                reporter. Lets the row go early, below.
--      model, prompt_version     which model and prompt made it, to count
--                                reports per prompt without opening a row.
--      expires_at                30 days at most after it was made; the check
--                                refuses longer. The API's sweep deletes rows
--                                past it.
--
-- WHEN A ROW GOES
--   - 30 days after the report (the API sweep, hourly);
--   - with its chapter (`on delete cascade`);
--   - when the reporter deletes their account, or a member it quotes does
--     (trigger 2 below: `anonymize_user` sets `users.deleted_at`, and a
--     trigger here keeps that function from being redefined again);
--   - when a member it quotes answers No on the AI sheet (the API's consent
--     listener, which runs the same delete).
--
-- RLS on and no policies: only the API, with the service role, writes it,
-- and no route reads it. The Frapp team reads rows from the database with
-- the key (`docs/ops/ai-stored-text.md`).
--
-- Locks. The foreign keys add triggers to `chapters` and `users`, and
-- trigger 2 is created on `users`, each taking a SHARE ROW EXCLUSIVE lock
-- until commit. The table is new and empty, so that is milliseconds. Writes
-- no row.

-- 1. ------------------------------------------------------------------------

create table if not exists public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  reported_by uuid not null references public.users(id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  reason text not null,
  note text,
  sealed text,
  quoted_user_ids uuid[] not null default '{}',
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint ai_reports_subject_type_allowed
    check (subject_type in ('ask_answer', 'meeting_draft', 'ai_suggestion')),
  constraint ai_reports_reason_allowed
    check (reason in ('wrong', 'harmful', 'private', 'other')),
  constraint ai_reports_note_len
    check (note is null or char_length(note) between 1 and 500),
  -- Ciphertext only: a value the API's cipher did not write is refused.
  constraint ai_reports_sealed_is_envelope
    check (sealed is null or sealed like 'v1.%'),
  constraint ai_reports_sealed_size
    check (sealed is null or char_length(sealed) <= 2000000),
  constraint ai_reports_model_len
    check (model is null or char_length(model) between 1 and 100),
  constraint ai_reports_prompt_version_len
    check (prompt_version is null or char_length(prompt_version) between 1 and 100),
  constraint ai_reports_at_most_30_days
    check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  constraint ai_reports_one_per_member
    unique (reported_by, subject_type, subject_id)
);

create index if not exists ai_reports_expires_at
  on public.ai_reports (expires_at);
create index if not exists ai_reports_chapter
  on public.ai_reports (chapter_id);
create index if not exists ai_reports_quoted_user_ids
  on public.ai_reports using gin (quoted_user_ids);

alter table public.ai_reports enable row level security;

comment on table public.ai_reports is
  'Reports of AI-made text (#4315): one sealed exchange each, kept 30 days for the Frapp team. API only; no route reads it. See 20261112220000_ai_reports.sql.';

-- 2. ------------------------------------------------------------------------
-- A deleted account takes its reports with it, and any report quoting it.

create or replace function public.ai_reports_drop_for_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.ai_reports
  where reported_by = new.id
     or quoted_user_ids @> array[new.id];
  return new;
end;
$$;

revoke execute on function public.ai_reports_drop_for_deleted_user()
  from public, anon, authenticated;

drop trigger if exists users_drop_ai_reports on public.users;
create trigger users_drop_ai_reports
  after update of deleted_at on public.users
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.ai_reports_drop_for_deleted_user();
