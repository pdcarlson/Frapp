-- Meeting minutes written by hand (#4312, part of the AI build-out, ADR-28).
--
-- WHAT CHANGES
--
-- `meetings` holds a meeting's minutes: one row per event at most. The
-- minutes belong to the meeting and are read by the members its event
-- invites (`spec/behavior/meetings.md` § Who can read minutes); the API
-- enforces that, as it does for events.
--
--   event_id          the meeting's event. `on delete set null`: deleting
--                     the event never deletes the minutes (only
--                     `meetings:delete` does). With no event there is no
--                     audience, so the API then shows them only to officers
--                     who can edit minutes.
--   event_name,       the event's name and start, copied on every save, so
--   event_start_time  minutes whose event was deleted still say what and when.
--   meeting_type      chapter, exec, committee or other. Never standards: a
--                     Standards meeting is never kept here (§ Standards
--                     meetings), and the check refuses it whatever the API does.
--   other_label       an optional name for an Other meeting.
--   status            draft (only its author and `meetings:edit` holders read
--                     it) or posted (the audience reads it).
--   content           the minutes, a JSON object of sections
--                     (`MeetingContentSchema` in `@repo/validation`).
--
-- `meeting_templates` is a chapter's section list (§ Template). A chapter
-- with no row reads the default sections.
--
-- No text is ever sent to a model from these tables in this change: there is
-- no AI here. The AI draft (#4312's AI half) writes the same `content`.
--
-- PERMISSIONS
--
-- `meetings:record`, `meetings:edit` and `meetings:delete` are new. A new
-- chapter's top tier gets `meetings:record` from the API's seed
-- (`STARTING_ROLE_TIERS`). Each existing chapter's top tier (position 1, the
-- exec board unless the chapter reordered it) gets it below, and the tier
-- trigger rewrites `roles.permissions` for every role in that tier.
-- `meetings:edit` and `meetings:delete` go to nobody: the President holds `*`.
--
-- RLS on with no policies, the posture of every chapter-owned table here: the
-- API reads and writes with the service role.

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  event_name text not null,
  event_start_time timestamptz not null,
  meeting_type text not null,
  other_label text,
  status text not null default 'draft',
  content jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  posted_by uuid references public.users(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_type_allowed
    check (meeting_type in ('chapter', 'exec', 'committee', 'other')),
  constraint meetings_other_label_len
    check (other_label is null or char_length(btrim(other_label)) between 1 and 60),
  constraint meetings_status_allowed
    check (status in ('draft', 'posted')),
  constraint meetings_posted_at_matches_status
    check ((status = 'posted') = (posted_at is not null)),
  constraint meetings_content_is_object
    check (jsonb_typeof(content) = 'object'),
  -- Generous: the API caps each section far below this.
  constraint meetings_content_size
    check (pg_column_size(content) <= 1048576)
);

-- One set of minutes per event.
create unique index if not exists idx_meetings_event
  on public.meetings (event_id)
  where event_id is not null;

-- The chapter's list, newest meeting first.
create index if not exists idx_meetings_chapter_start
  on public.meetings (chapter_id, event_start_time desc);

alter table public.meetings enable row level security;

drop trigger if exists trg_meetings_updated_at on public.meetings;
create trigger trg_meetings_updated_at
  before update on public.meetings
  for each row execute function update_updated_at();

comment on table public.meetings is
  'A meeting''s minutes, one row per event at most. Read by the members the event invites once posted. Never a Standards meeting. See 20261112131410_meetings.sql.';

create table if not exists public.meeting_templates (
  chapter_id uuid primary key references public.chapters(id) on delete cascade,
  sections text[] not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint meeting_templates_sections_len
    check (cardinality(sections) <= 20)
);

alter table public.meeting_templates enable row level security;

drop trigger if exists trg_meeting_templates_updated_at on public.meeting_templates;
create trigger trg_meeting_templates_updated_at
  before update on public.meeting_templates
  for each row execute function update_updated_at();

comment on table public.meeting_templates is
  'A chapter''s minutes template: the sections its minutes show. No row means the default sections. See 20261112131410_meetings.sql.';

-- Each existing chapter's top tier can write minutes. Idempotent: a tier that
-- already holds the key is not touched.
update public.role_tiers t
set permissions = t.permissions || array['meetings:record']
where t.position = 1
  and not ('meetings:record' = any (t.permissions));
