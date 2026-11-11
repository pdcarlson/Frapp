-- The chapter's order for channels inside their section of the channel list
-- (owner, 2026-11-11: "we should be able to reorder channels as well. simple
-- click and drag works"). An officer who can manage channels drags a channel
-- in the web rail, within its section or into another category, and drags a
-- category's heading to move the whole category. Every member, on web and
-- mobile, then sees that order.
--
--   chat_channels.display_order  the channel's place in its section, 0 first.
--     Null until an officer first arranges that section. The list sorts by it,
--     nulls last, then A to Z by the title the row shows, so a chapter nobody
--     has arranged reads exactly as before: A to Z. A channel created after an
--     arrangement has none and lands at the end of its section.
--
-- Nullable with no default, so adding it rewrites no row. DMs and group DMs
-- never carry one: they sort A to Z by the other member's name.
--
-- Categories already have `chat_channel_categories.display_order` (initial
-- schema), written one row at a time by `PATCH /v1/channels/categories/{id}`.
-- `reorder_chat_categories` below writes the whole order in one statement, so
-- a drag can't leave two categories tied halfway through.

alter table public.chat_channels
  add column if not exists display_order integer;

-- Files the listed channels under one section in the order given, in one
-- transaction. `p_category_id` null is the default Channels section.
--
-- The listed channels take 0, 1, 2, ... in array order and move to that
-- category. Any other channel already in the target section (one the officer
-- can't see, such as a private channel they aren't in) keeps its relative
-- order after them, so the section never ends up with two rows on one number.
-- The section a channel moved out of is left alone: its gaps don't change its
-- order.
--
-- Never a DM, a group DM or `#chapter-audit`: those rows are skipped, and the
-- API has refused them already. The advisory lock serializes two officers
-- dragging in the same chapter at once, so the second waits and then writes
-- its whole order, instead of interleaving two half-orders.
--
-- `security invoker`, like `set_chat_channel_default`: the API calls it with
-- the service-role client, and EXECUTE is locked to service_role below.
create or replace function reorder_chat_channels(
  p_chapter_id uuid,
  p_category_id uuid,
  p_channel_ids uuid[]
)
returns setof chat_channels
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := coalesce(cardinality(p_channel_ids), 0);
begin
  perform pg_advisory_xact_lock(
    hashtextextended('chat_channels.display_order:' || p_chapter_id::text, 0)
  );

  update chat_channels c
     set category_id = p_category_id,
         display_order = o.ord - 1
    from unnest(p_channel_ids) with ordinality as o(id, ord)
   where c.id = o.id
     and c.chapter_id = p_chapter_id
     and c.type not in ('DM', 'GROUP_DM')
     and not c.is_audit_log;

  update chat_channels c
     set display_order = v_count + r.rn - 1
    from (
      select id,
             row_number() over (
               order by display_order nulls last, lower(name), id
             ) as rn
        from chat_channels
       where chapter_id = p_chapter_id
         and category_id is not distinct from p_category_id
         and type not in ('DM', 'GROUP_DM')
         and not is_audit_log
         and archived_at is null
         and not (id = any (p_channel_ids))
    ) r
   where c.id = r.id;

  return query
    select *
      from chat_channels
     where chapter_id = p_chapter_id
       and id = any (p_channel_ids);
end;
$$;

-- The chapter's category order, in one transaction: the listed categories take
-- 0, 1, 2, ... and any category not listed (one created while the officer was
-- dragging) keeps its relative order after them. Same lock as the channels, so
-- a category drag and a channel drag in one chapter don't interleave.
create or replace function reorder_chat_categories(
  p_chapter_id uuid,
  p_category_ids uuid[]
)
returns setof chat_channel_categories
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := coalesce(cardinality(p_category_ids), 0);
begin
  perform pg_advisory_xact_lock(
    hashtextextended('chat_channels.display_order:' || p_chapter_id::text, 0)
  );

  update chat_channel_categories k
     set display_order = o.ord - 1
    from unnest(p_category_ids) with ordinality as o(id, ord)
   where k.id = o.id
     and k.chapter_id = p_chapter_id;

  update chat_channel_categories k
     set display_order = v_count + r.rn - 1
    from (
      select id,
             row_number() over (order by display_order, created_at, id) as rn
        from chat_channel_categories
       where chapter_id = p_chapter_id
         and not (id = any (p_category_ids))
    ) r
   where k.id = r.id;

  return query
    select *
      from chat_channel_categories
     where chapter_id = p_chapter_id
     order by display_order, created_at;
end;
$$;

revoke execute on function reorder_chat_channels(uuid, uuid, uuid[]) from public;
revoke execute on function reorder_chat_categories(uuid, uuid[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function reorder_chat_channels(uuid, uuid, uuid[]) from anon;
    revoke execute on function reorder_chat_categories(uuid, uuid[]) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function reorder_chat_channels(uuid, uuid, uuid[]) from authenticated;
    revoke execute on function reorder_chat_categories(uuid, uuid[]) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function reorder_chat_channels(uuid, uuid, uuid[]) to service_role;
    grant execute on function reorder_chat_categories(uuid, uuid[]) to service_role;
  end if;
end
$$;
