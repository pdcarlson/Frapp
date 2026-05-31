-- Chunk 09: per-member custom-field values
--
-- `chapter_custom_fields` (Chunk 02) defines the fields a chapter renders on the
-- member directory. This table holds each member's VALUE for those fields, as
-- individually addressable rows (one per member+field) so the visibility check
-- can be applied as a query predicate against the field definition rather than a
-- post-fetch scrub (spec/behavior/members.md → Custom Fields). The value is kept
-- as text; the API coerces/validates it against `chapter_custom_fields.type`.

create table member_custom_field_values (
  id          uuid         primary key default gen_random_uuid(),
  member_id   uuid         not null references members(id) on delete cascade,
  field_id    uuid         not null references chapter_custom_fields(id) on delete cascade,
  value       text,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),
  unique (member_id, field_id)
);

create index idx_member_custom_field_values_member_id on member_custom_field_values (member_id);
create index idx_member_custom_field_values_field_id on member_custom_field_values (field_id);

alter table member_custom_field_values enable row level security;

create trigger trg_member_custom_field_values_updated_at
  before update on member_custom_field_values
  for each row execute function update_updated_at();
