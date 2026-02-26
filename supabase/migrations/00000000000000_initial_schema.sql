-- Frapp: Initial Schema Migration
-- Generated from spec/architecture.md Section 5
-- All tables use uuid PKs via gen_random_uuid(), timestamps default to now()

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists "pgcrypto";

-- ============================================================================
-- Core Tables
-- ============================================================================

create table users (
  id uuid primary key default gen_random_uuid(),
  supabase_auth_id uuid not null unique,
  email text not null,
  display_name text not null default '',
  avatar_url text,
  bio text,
  graduation_year int,
  current_city text,
  current_company text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_users_supabase_auth_id on users (supabase_auth_id);

create table chapters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  university text not null,
  stripe_customer_id text unique,
  subscription_status text not null default 'incomplete'
    check (subscription_status in ('incomplete', 'active', 'past_due', 'canceled')),
  subscription_id text unique,
  accent_color text default '#2563EB',
  logo_path text,
  donation_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  role_ids text[] not null default '{}',
  has_completed_onboarding boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, chapter_id)
);
create index idx_members_chapter_id on members (chapter_id);
create index idx_members_user_id on members (user_id);

create table roles (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  name text not null,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  display_order int not null default 0,
  color text,
  created_at timestamptz not null default now(),
  unique (chapter_id, name)
);
create index idx_roles_chapter_id on roles (chapter_id);

create table invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  chapter_id uuid not null references chapters(id) on delete cascade,
  role text not null,
  expires_at timestamptz not null,
  created_by uuid not null references users(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_invites_token on invites (token);
create index idx_invites_chapter_id on invites (chapter_id);

-- ============================================================================
-- Backwork (Academic Library)
-- ============================================================================

create table backwork_departments (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  code text not null,
  name text,
  created_at timestamptz not null default now(),
  unique (chapter_id, code)
);
create index idx_backwork_departments_chapter on backwork_departments (chapter_id);

create table backwork_professors (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (chapter_id, name)
);
create index idx_backwork_professors_chapter on backwork_professors (chapter_id);

create table backwork_resources (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  department_id uuid references backwork_departments(id) on delete set null,
  course_number text,
  professor_id uuid references backwork_professors(id) on delete set null,
  uploader_id uuid not null references users(id),
  title text,
  year int,
  semester text check (semester in ('Spring', 'Summer', 'Fall', 'Winter')),
  assignment_type text check (assignment_type in (
    'Exam', 'Midterm', 'Final Exam', 'Quiz', 'Homework',
    'Lab', 'Project', 'Study Guide', 'Notes', 'Other'
  )),
  assignment_number int,
  document_variant text check (document_variant in ('Student Copy', 'Blank Copy', 'Answer Key')),
  storage_path text not null,
  file_hash text not null,
  is_redacted boolean not null default false,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (chapter_id, file_hash)
);
create index idx_backwork_resources_chapter on backwork_resources (chapter_id);
create index idx_backwork_resources_department on backwork_resources (department_id);
create index idx_backwork_resources_professor on backwork_resources (professor_id);

-- ============================================================================
-- Points & Events
-- ============================================================================

create table point_transactions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  amount int not null,
  category text not null check (category in (
    'ATTENDANCE', 'ACADEMIC', 'SERVICE', 'FINE', 'MANUAL', 'STUDY'
  )),
  description text not null default '',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index idx_point_transactions_chapter_user on point_transactions (chapter_id, user_id);
create index idx_point_transactions_category on point_transactions (category);

create table events (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  name text not null,
  description text,
  location text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  point_value int not null default 10,
  is_mandatory boolean not null default false,
  recurrence_rule text,
  parent_event_id uuid references events(id) on delete set null,
  required_role_ids text[],
  notes text,
  created_at timestamptz not null default now()
);
create index idx_events_chapter on events (chapter_id);
create index idx_events_start_time on events (start_time);
create index idx_events_parent on events (parent_event_id);

create table event_attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null check (status in ('PRESENT', 'EXCUSED', 'ABSENT', 'LATE')),
  check_in_time timestamptz,
  excuse_reason text,
  marked_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index idx_event_attendance_event on event_attendance (event_id);

-- ============================================================================
-- Communications (Chat)
-- ============================================================================

create table chat_channel_categories (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  name text not null,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);
create index idx_chat_channel_categories_chapter on chat_channel_categories (chapter_id);

create table chat_channels (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  name text not null,
  description text,
  type text not null check (type in ('PUBLIC', 'PRIVATE', 'ROLE_GATED', 'DM', 'GROUP_DM')),
  required_permissions text[],
  member_ids uuid[],
  category_id uuid references chat_channel_categories(id) on delete set null,
  is_read_only boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_chat_channels_chapter on chat_channels (chapter_id);
create index idx_chat_channels_type on chat_channels (type);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references chat_channels(id) on delete cascade,
  sender_id uuid not null references users(id),
  content text not null default '',
  type text not null default 'TEXT' check (type in ('TEXT', 'POLL')),
  reply_to_id uuid references chat_messages(id) on delete set null,
  metadata jsonb not null default '{}',
  is_pinned boolean not null default false,
  pinned_at timestamptz,
  edited_at timestamptz,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_chat_messages_channel on chat_messages (channel_id, created_at);
create index idx_chat_messages_sender on chat_messages (sender_id);

create table message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references chat_messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index idx_message_reactions_message on message_reactions (message_id);

create table channel_read_receipts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references chat_channels(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, user_id)
);

-- ============================================================================
-- Polls
-- ============================================================================

create table poll_votes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references chat_messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  option_index int not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, option_index)
);
create index idx_poll_votes_message on poll_votes (message_id);

-- ============================================================================
-- Notifications
-- ============================================================================

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  device_name text,
  created_at timestamptz not null default now()
);
create index idx_push_tokens_user on push_tokens (user_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_user_chapter on notifications (user_id, chapter_id);
create index idx_notifications_unread on notifications (user_id) where read_at is null;

create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  category text not null,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, chapter_id, category)
);

create table user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade unique,
  quiet_hours_start time,
  quiet_hours_end time,
  quiet_hours_tz text,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Location & Study
-- ============================================================================

create table study_geofences (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  name text not null,
  coordinates jsonb not null,
  is_active boolean not null default true,
  minutes_per_point int not null default 30,
  points_per_interval int not null default 1,
  min_session_minutes int not null default 15,
  created_at timestamptz not null default now()
);
create index idx_study_geofences_chapter on study_geofences (chapter_id);

create table study_sessions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  geofence_id uuid not null references study_geofences(id),
  status text not null default 'ACTIVE' check (status in (
    'ACTIVE', 'COMPLETED', 'EXPIRED', 'PAUSED_EXPIRED', 'LOCATION_INVALID'
  )),
  start_time timestamptz not null default now(),
  end_time timestamptz,
  last_heartbeat_at timestamptz not null default now(),
  total_foreground_minutes int not null default 0,
  points_awarded boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_study_sessions_chapter_user on study_sessions (chapter_id, user_id);
create index idx_study_sessions_active on study_sessions (user_id) where status = 'ACTIVE';

-- ============================================================================
-- Financials
-- ============================================================================

create table financial_invoices (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  description text,
  amount int not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'OPEN', 'PAID', 'VOID')),
  due_date date not null,
  paid_at timestamptz,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);
create index idx_financial_invoices_chapter on financial_invoices (chapter_id);
create index idx_financial_invoices_user on financial_invoices (user_id);

create table financial_transactions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  invoice_id uuid references financial_invoices(id) on delete set null,
  amount int not null,
  type text not null check (type in ('PAYMENT', 'REFUND', 'ADJUSTMENT')),
  stripe_charge_id text,
  created_at timestamptz not null default now()
);
create index idx_financial_transactions_chapter on financial_transactions (chapter_id);

-- ============================================================================
-- Service Hours
-- ============================================================================

create table service_entries (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  duration_minutes int not null,
  description text not null,
  proof_path text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references users(id),
  review_comment text,
  points_awarded boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_service_entries_chapter on service_entries (chapter_id);
create index idx_service_entries_user on service_entries (user_id);

-- ============================================================================
-- Tasks
-- ============================================================================

create table tasks (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  title text not null,
  description text,
  assignee_id uuid not null references users(id),
  created_by uuid not null references users(id),
  due_date date not null,
  status text not null default 'TODO' check (status in ('TODO', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE')),
  point_reward int,
  points_awarded boolean not null default false,
  completed_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_tasks_chapter on tasks (chapter_id);
create index idx_tasks_assignee on tasks (assignee_id);

-- ============================================================================
-- Chapter Documents
-- ============================================================================

create table chapter_documents (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  title text not null,
  description text,
  folder text,
  storage_path text not null,
  uploaded_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index idx_chapter_documents_chapter on chapter_documents (chapter_id);

-- ============================================================================
-- Semester Archives
-- ============================================================================

create table semester_archives (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);
create index idx_semester_archives_chapter on semester_archives (chapter_id);

-- ============================================================================
-- Row Level Security (basic tenant scoping)
-- ============================================================================

alter table members enable row level security;
alter table roles enable row level security;
alter table invites enable row level security;
alter table backwork_departments enable row level security;
alter table backwork_professors enable row level security;
alter table backwork_resources enable row level security;
alter table point_transactions enable row level security;
alter table events enable row level security;
alter table event_attendance enable row level security;
alter table chat_channel_categories enable row level security;
alter table chat_channels enable row level security;
alter table chat_messages enable row level security;
alter table message_reactions enable row level security;
alter table channel_read_receipts enable row level security;
alter table poll_votes enable row level security;
alter table notifications enable row level security;
alter table notification_preferences enable row level security;
alter table study_geofences enable row level security;
alter table study_sessions enable row level security;
alter table financial_invoices enable row level security;
alter table financial_transactions enable row level security;
alter table service_entries enable row level security;
alter table tasks enable row level security;
alter table chapter_documents enable row level security;
alter table semester_archives enable row level security;

-- Service role bypasses RLS; these policies allow the API (using service_role key)
-- to access all data. Fine-grained access control is handled at the API layer.
-- Client-side Supabase access (anon key) is not used for data queries.

-- ============================================================================
-- Updated_at trigger function
-- ============================================================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_users_updated_at
  before update on users for each row execute function update_updated_at();

create trigger trg_chapters_updated_at
  before update on chapters for each row execute function update_updated_at();

create trigger trg_members_updated_at
  before update on members for each row execute function update_updated_at();

create trigger trg_channel_read_receipts_updated_at
  before update on channel_read_receipts for each row execute function update_updated_at();

create trigger trg_notification_preferences_updated_at
  before update on notification_preferences for each row execute function update_updated_at();

create trigger trg_user_settings_updated_at
  before update on user_settings for each row execute function update_updated_at();
