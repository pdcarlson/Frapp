-- One 1:1 DM per chapter and member pair, enforced by the database (#2788).
--
-- `ChatService.getOrCreateDm` looks the pair up and inserts when nothing is
-- found, as two separate PostgREST calls with nothing tying them together. Two
-- overlapping calls for one pair (a double tap, or both members tapping
-- Message on each other at the same moment) could both miss the lookup and
-- both insert. From then on the lookup returned whichever row it met first, so
-- the two members could end up in different threads.
--
--   chat_channels_dm_two_members  a DM row holds exactly two member ids. The
--     API has only ever written it that way; the CHECK makes the pair the
--     row's identity, which the index relies on. Other types are untouched:
--     PUBLIC and ROLE_GATED carry NULL, PRIVATE and GROUP_DM any count.
--   chat_channels_dm_pair_key  unique on (chapter_id, lower id, higher id)
--     where type = 'DM'. least/greatest makes it independent of the order the
--     ids are stored in. It is keyed on the members, not on `name` (which the
--     API sets to the sorted pair), because `PATCH /v1/channels/:id` can
--     rename any channel, a DM included, and a renamed DM would stop guarding
--     its pair.
--
-- The API inserts, and on a 23505 from this index re-reads the pair and
-- returns the row that won. It is not an upsert: PostgREST can't name an
-- expression or partial index as an ON CONFLICT arbiter.
--
-- No row is rewritten or removed. On 2026-09-30 frapp-staging and frapp-prod
-- held no DM rows at all. If a duplicate pair, or a DM without exactly two
-- members, exists when this runs, it stops with a message instead of choosing
-- which conversation survives: that is the owner's decision.

do $$
declare
  malformed bigint;
  duplicate_pairs bigint;
begin
  select count(*) into malformed
    from public.chat_channels
   where type = 'DM'
     and coalesce(cardinality(member_ids), 0) <> 2;

  select count(*) into duplicate_pairs
    from (
      select 1
        from public.chat_channels
       where type = 'DM'
         and cardinality(member_ids) = 2
       group by chapter_id,
                least(member_ids[1], member_ids[2]),
                greatest(member_ids[1], member_ids[2])
      having count(*) > 1
    ) pairs;

  if malformed > 0 or duplicate_pairs > 0 then
    raise exception
      'chat_channels holds % DM row(s) without exactly two members and % duplicate DM pair(s)',
      malformed, duplicate_pairs
      using hint = 'Merging or removing members'' conversations is the owner''s decision (#2788). Nothing was changed.';
  end if;
end
$$;

alter table public.chat_channels
  drop constraint if exists chat_channels_dm_two_members;
alter table public.chat_channels
  add constraint chat_channels_dm_two_members check (
    type <> 'DM' or coalesce(cardinality(member_ids), 0) = 2
  );

create unique index if not exists chat_channels_dm_pair_key
  on public.chat_channels (
    chapter_id,
    least(member_ids[1], member_ids[2]),
    greatest(member_ids[1], member_ids[2])
  )
  where type = 'DM';
