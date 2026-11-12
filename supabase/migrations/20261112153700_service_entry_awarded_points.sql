-- How many SERVICE points an approved service entry awarded (#3868).
--
-- `service_entries.points_awarded` is a flag; the count lived only on the
-- entry's SERVICE ledger row (`point_transactions.amount`, linked by
-- `metadata->>'service_entry_id'`), so the History list could say "Points
-- awarded" but not how many. Recomputing from today's
-- `chapter_service_config.minutes_per_point` would be wrong: the rate is read
-- at approval time and can change afterwards. So the approval now records the
-- number on the entry itself, and existing rows are backfilled from the ledger.
--
-- `awarded_points` is NULL until the entry is approved; an approval writes the
-- number it awarded, 0 for a sub-rate duration (which approves with no ledger
-- row). It is never rewritten afterwards: the system does not auto-reverse an
-- award (spec/behavior/service-hours.md § Edge Cases), so the column keeps
-- saying what the approval wrote.

alter table service_entries
  add column if not exists awarded_points integer
    check (awarded_points is null or awarded_points >= 0);

comment on column service_entries.awarded_points is
  'SERVICE points this entry''s approval awarded (0 for a sub-rate duration); NULL until approved. Written by approve_service_entry, never recomputed (#3868).';

-- Backfill from the ledger row the approval wrote. An approved entry with
-- `points_awarded = false` was a sub-rate approval with no ledger row, so 0.
-- An awarded entry whose ledger row can't be found stays NULL (unknown), and
-- clients fall back to the flag rather than print a guessed number. The ledger
-- is grouped once and joined, rather than rescanned per entry: nothing indexes
-- `metadata->>'service_entry_id'`.
update service_entries se
   set awarded_points = l.points
  from (
    select pt.chapter_id,
           pt.metadata->>'service_entry_id' as entry_id,
           sum(pt.amount)::integer as points
      from point_transactions pt
     where pt.category = 'SERVICE'
       and pt.metadata ? 'service_entry_id'
     group by 1, 2
  ) l
 where l.chapter_id = se.chapter_id
   and l.entry_id = se.id::text
   and l.points >= 0
   and se.awarded_points is null
   and (se.status = 'APPROVED' or se.points_awarded);

update service_entries
   set awarded_points = 0
 where awarded_points is null
   and status = 'APPROVED'
   and not points_awarded;

-- Same function as 20260603120000, plus `awarded_points = greatest(p_points, 0)`
-- in the compare-and-set (clamped to match the column's check). `create or
-- replace` with the identical signature keeps the EXECUTE grants that migration
-- set (service_role only). It does reset the function's settings, so the
-- `search_path` 20261107160000 pinned is restated.
create or replace function approve_service_entry(
  p_entry_id uuid,
  p_chapter_id uuid,
  p_reviewer_id uuid,
  p_review_comment text,
  p_points integer
)
returns setof service_entries
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_entry service_entries;
begin
  -- Compare-and-set: approve only a still-PENDING, not-yet-awarded entry.
  update service_entries
     set status = 'APPROVED',
         reviewed_by = p_reviewer_id,
         review_comment = p_review_comment,
         points_awarded = (p_points > 0),
         awarded_points = greatest(p_points, 0)
   where id = p_entry_id
     and chapter_id = p_chapter_id
     and status = 'PENDING'
     and points_awarded = false
  returning * into v_entry;

  -- No row updated => entry missing, not PENDING, or already awarded (race lost).
  if not found then
    return;
  end if;

  -- Insert the SERVICE point-ledger row in the same transaction when a reward
  -- applies (sub-rate durations approve with no points).
  if p_points > 0 then
    insert into point_transactions (
      chapter_id, user_id, amount, category, description, metadata
    )
    values (
      v_entry.chapter_id,
      v_entry.user_id,
      p_points,
      'SERVICE',
      'Service hours approved: ' || v_entry.description,
      jsonb_build_object('service_entry_id', v_entry.id)
    );
  end if;

  return next v_entry;
end;
$$;
