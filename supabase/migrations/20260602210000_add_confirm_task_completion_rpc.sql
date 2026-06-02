-- Atomic task confirmation + point award (FRA-100).
--
-- Previously `TaskService.confirmCompletion` inserted the point-ledger row and
-- updated the task in two separate writes, so a partial failure could award
-- points while leaving the task unconfirmed, and two concurrent confirms could
-- both pass the in-memory `points_awarded` guard and double-insert.
--
-- This function performs both writes inside its single implicit transaction.
-- The conditional UPDATE (`points_awarded = false`) is a compare-and-set: only
-- one of N concurrent callers flips the flag and inserts the ledger row; the
-- rest update zero rows (`not found`) and return empty. Mirrors the
-- "Atomic Point Awarding" invariant in spec/behavior/points.md.

create or replace function confirm_task_completion(
  p_task_id uuid,
  p_chapter_id uuid
)
returns setof tasks
language plpgsql
security invoker
as $$
declare
  v_task tasks;
begin
  -- Compare-and-set: confirm only when COMPLETED and not yet awarded.
  update tasks
     set confirmed_at = now(),
         points_awarded = true
   where id = p_task_id
     and chapter_id = p_chapter_id
     and status = 'COMPLETED'
     and points_awarded = false
  returning * into v_task;

  -- No row updated => task missing, not COMPLETED, or already awarded (race lost).
  if not found then
    return;
  end if;

  -- Insert the point-ledger row in the same transaction when a reward applies.
  if v_task.point_reward is not null and v_task.point_reward > 0 then
    insert into point_transactions (
      chapter_id, user_id, amount, category, description, metadata
    )
    values (
      v_task.chapter_id,
      v_task.assignee_id,
      v_task.point_reward,
      'MANUAL',
      'Task completed: ' || v_task.title,
      jsonb_build_object('task_id', v_task.id)
    );
  end if;

  return next v_task;
end;
$$;
