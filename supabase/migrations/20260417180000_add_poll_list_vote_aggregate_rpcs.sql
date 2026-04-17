-- Aggregate poll votes in the database for chapter poll list (admin dashboard).
-- Avoids loading every poll_votes row into the API when only per-option counts
-- (and optionally the current user's selections) are needed.

create or replace function get_poll_vote_option_totals(p_message_ids uuid[])
returns table (
  message_id uuid,
  option_index int,
  vote_count bigint
)
language sql
stable
security invoker
as $$
  select
    pv.message_id,
    pv.option_index,
    count(*)::bigint as vote_count
  from poll_votes pv
  where pv.message_id = any(p_message_ids)
  group by pv.message_id, pv.option_index;
$$;

create or replace function get_poll_user_votes_for_messages(
  p_message_ids uuid[],
  p_user_id uuid
)
returns table (
  message_id uuid,
  option_index int
)
language sql
stable
security invoker
as $$
  select pv.message_id, pv.option_index
  from poll_votes pv
  where pv.message_id = any(p_message_ids)
    and pv.user_id = p_user_id
  order by pv.message_id, pv.option_index;
$$;
