-- Chunk 02: chapter customization columns + per-chapter config tables
--
-- New columns on chapters: archetype, enabled_modules, vocabulary, branding,
-- theme_palette, directory_id, beta_config.
-- New tables: chapter_custom_fields, chapter_custom_roles, chapter_workflows,
-- chapter_dues_config.

-- ── New columns on chapters ────────────────────────────────────────────────

alter table chapters
  add column if not exists org_archetype text not null default 'ifc',
  add column if not exists enabled_modules jsonb not null default '{"chat":true,"members":true,"announcements":true,"audit-log":true,"chapter-settings":true}',
  add column if not exists vocabulary jsonb not null default '{}',
  add column if not exists branding jsonb not null default '{}',
  add column if not exists theme_palette jsonb not null default '{}',
  add column if not exists directory_id uuid,
  add column if not exists beta_config jsonb not null default '{"enabled":true,"style":"sidebar_pill"}';

-- ── chapter_custom_fields ─────────────────────────────────────────────────

create table chapter_custom_fields (
  id           uuid         primary key default gen_random_uuid(),
  chapter_id   uuid         not null references chapters(id) on delete cascade,
  key          text         not null,
  label        text         not null,
  type         text         not null check (type in ('text','number','decimal','phone','select','boolean')),
  required     boolean      not null default false,
  visibility   text         not null default 'chapter' check (visibility in ('self','chapter','exec','president')),
  sensitive    boolean      not null default false,
  options      jsonb,
  sort         int          not null default 0,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now(),
  unique (chapter_id, key)
);

create index idx_chapter_custom_fields_chapter_id on chapter_custom_fields (chapter_id);
create index idx_chapter_custom_fields_chapter_sort on chapter_custom_fields (chapter_id, sort);

alter table chapter_custom_fields enable row level security;

create trigger trg_chapter_custom_fields_updated_at
  before update on chapter_custom_fields
  for each row execute function update_updated_at();

-- ── chapter_custom_roles ──────────────────────────────────────────────────

create table chapter_custom_roles (
  id            uuid         primary key default gen_random_uuid(),
  chapter_id    uuid         not null references chapters(id) on delete cascade,
  key           text         not null,
  label         text         not null,
  rank          int          not null default 99,
  capabilities  text[]       not null default '{}',
  core          boolean      not null default false,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now(),
  unique (chapter_id, key)
);

create index idx_chapter_custom_roles_chapter_id on chapter_custom_roles (chapter_id);
create index idx_chapter_custom_roles_chapter_rank on chapter_custom_roles (chapter_id, rank);

alter table chapter_custom_roles enable row level security;

create trigger trg_chapter_custom_roles_updated_at
  before update on chapter_custom_roles
  for each row execute function update_updated_at();

-- ── chapter_workflows ─────────────────────────────────────────────────────

create table chapter_workflows (
  id          uuid         primary key default gen_random_uuid(),
  chapter_id  uuid         not null references chapters(id) on delete cascade,
  key         text         not null,
  enabled     boolean      not null default false,
  threshold   int,
  params      jsonb        not null default '{}',
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),
  unique (chapter_id, key)
);

create index idx_chapter_workflows_chapter_id on chapter_workflows (chapter_id);

alter table chapter_workflows enable row level security;

create trigger trg_chapter_workflows_updated_at
  before update on chapter_workflows
  for each row execute function update_updated_at();

-- ── chapter_dues_config ───────────────────────────────────────────────────
-- One row per chapter (PK = chapter_id). All monetary amounts are in cents
-- to avoid floating-point rounding.

create table chapter_dues_config (
  chapter_id                uuid         primary key references chapters(id) on delete cascade,
  cadence                   text         not null default 'semester' check (cadence in ('semester','monthly','annual')),
  active_amount_cents       int          not null default 0 check (active_amount_cents >= 0),
  new_member_amount_cents   int          not null default 0 check (new_member_amount_cents >= 0),
  alumni_amount_cents       int          not null default 0 check (alumni_amount_cents >= 0),
  installments_allowed      boolean      not null default false,
  late_fee_cents            int          not null default 0 check (late_fee_cents >= 0),
  grace_days                int          not null default 7 check (grace_days >= 0),
  scholarship_pool_cents    int          not null default 0 check (scholarship_pool_cents >= 0),
  created_at                timestamptz  not null default now(),
  updated_at                timestamptz  not null default now()
);

alter table chapter_dues_config enable row level security;

create trigger trg_chapter_dues_config_updated_at
  before update on chapter_dues_config
  for each row execute function update_updated_at();
