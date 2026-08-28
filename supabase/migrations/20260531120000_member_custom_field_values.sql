-- Chunk 09: per-member custom-field values
--
-- `chapter_custom_fields` (Chunk 02) defines the fields a chapter renders on the
-- member directory. This table holds each member's VALUE for those fields, as
-- individually addressable rows (one per member+field) so the visibility check
-- can be applied as a query predicate against the field definition rather than a
-- post-fetch scrub (spec/behavior/members.md → Custom Fields). The value is kept
-- as text; the API coerces/validates it against `chapter_custom_fields.type`.

-- Tenancy integrity: a value row carries the `chapter_id` shared by both its
-- member AND its field, enforced by the composite foreign keys below so a row can
-- never pair a member with a field from a different chapter. A composite FK
-- requires a UNIQUE constraint on the exact referenced columns, so add one to
-- each parent. These are redundant supersets of each table's primary key (`id`
-- is already unique) and exist solely to back the composite references.
alter table members
  add constraint members_id_chapter_id_key unique (id, chapter_id);
alter table chapter_custom_fields
  add constraint chapter_custom_fields_id_chapter_id_key unique (id, chapter_id);

create table member_custom_field_values (
  id          uuid         primary key default gen_random_uuid(),
  chapter_id  uuid         not null references chapters(id) on delete cascade,
  member_id   uuid         not null,
  field_id    uuid         not null,
  value       text,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),
  unique (member_id, field_id),
  -- The member and the field must belong to the SAME chapter as this row: the
  -- shared `chapter_id` participates in both composite FKs, closing the
  -- cross-chapter pairing hole.
  foreign key (member_id, chapter_id)
    references members (id, chapter_id) on delete cascade,
  foreign key (field_id, chapter_id)
    references chapter_custom_fields (id, chapter_id) on delete cascade
);

create index idx_member_custom_field_values_member_id on member_custom_field_values (member_id);
create index idx_member_custom_field_values_field_id on member_custom_field_values (field_id);

-- RLS posture (ADR-12): default-deny. Access to this table is exclusively via the
-- service-role API client (which bypasses RLS); the member directory reads values
-- through `GET /members/:id`, never the Supabase client directly. The explicit
-- service-role policy documents that intent and keeps `anon`/`authenticated`
-- denied (their `auth.role()` is never 'service_role') — no client-facing policy
-- is opened.
alter table member_custom_field_values enable row level security;

create policy "member_custom_field_values_service_role"
  on member_custom_field_values
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger trg_member_custom_field_values_updated_at
  before update on member_custom_field_values
  for each row execute function update_updated_at();
