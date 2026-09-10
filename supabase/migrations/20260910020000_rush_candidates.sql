-- Rush / recruitment candidates and anonymous ballots (#494)
--
-- Additive tables for the `/<vocab> add|vote|bid` slash command. The API
-- reaches them through the service-role client, so RLS is enabled with no
-- policies — the same convention as `chapter_service_config` and other
-- chapter-scoped ops tables.
--
-- Vote rows store `voter_id` so a member can vote once (unique per candidate).
-- The GET projection never lists voter names; the card publishes `vote_count`
-- and `viewer_has_voted` only (`spec/behavior/rush.md`, `wf_rush_anon_vote`).
--
-- `name_key` is a generated lower(trim(display_name)) so lookup and the
-- unique index share one expression. `stage` is free text defaulting to
-- 'new' — funnel keys are chapter-configured and the dashboard is out of
-- this slice.

create table if not exists rush_candidates (
  id           uuid        primary key default gen_random_uuid(),
  chapter_id   uuid        not null references chapters(id) on delete cascade,
  display_name text        not null,
  name_key     text        generated always as (lower(trim(display_name))) stored,
  user_id      uuid        references users(id) on delete set null,
  stage        text        not null default 'new',
  bid_status   text        not null default 'none',
  created_by   uuid        not null references users(id) on delete restrict,
  created_at   timestamptz not null default now(),
  constraint rush_candidates_display_name_len
    check (char_length(trim(display_name)) between 1 and 200),
  constraint rush_candidates_bid_status_check
    check (bid_status in ('none', 'extended'))
);

create unique index if not exists rush_candidates_chapter_name_key
  on rush_candidates (chapter_id, name_key);

create index if not exists rush_candidates_chapter_id_idx
  on rush_candidates (chapter_id);

alter table rush_candidates enable row level security;

comment on table rush_candidates is
  'Prospective members for the rush/recruitment module. Contract: spec/behavior/rush.md.';

create table if not exists rush_candidate_votes (
  id           uuid        primary key default gen_random_uuid(),
  candidate_id uuid        not null references rush_candidates(id) on delete cascade,
  chapter_id   uuid        not null references chapters(id) on delete cascade,
  voter_id     uuid        not null references users(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create unique index if not exists rush_candidate_votes_one_per_voter
  on rush_candidate_votes (candidate_id, voter_id);

create index if not exists rush_candidate_votes_chapter_id_idx
  on rush_candidate_votes (chapter_id);

alter table rush_candidate_votes enable row level security;

comment on table rush_candidate_votes is
  'One ballot per member per rush candidate. voter_id is stored for uniqueness and never listed on the card.';
