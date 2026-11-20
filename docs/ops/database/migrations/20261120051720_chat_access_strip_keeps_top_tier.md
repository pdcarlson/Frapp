# 20261120051720_chat_access_strip_keeps_top_tier.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Deleting a role, tier or group no longer leaves a channel's who-can-see or who-can-post list empty (which hid the channel from everyone but `*`). A list it would empty goes to the chapter's top tier instead, and lists already left empty get the same repair. Found on staging 2026-11-20, when a tier delete hid Devs-discussion and Dev Log.

## Promotion

- **Purpose**: `chat_access_strip_entry()` is replaced. It still takes the deleted entry off every list, but a list that would end up empty becomes `{tier:<top tier id>}`, the chapter's lowest `position`. It also writes data: every `chat_channels` and `chat_channel_categories` list that is already an empty array is set to the same thing.
- **Checks**:
  - `select count(*) from chat_channels where cardinality(who_can_see) = 0 or cardinality(who_can_post) = 0;` returns 0, unless a chapter has no tiers.
  - The same query on `chat_channel_categories` returns 0.
  - `select pg_get_functiondef('public.chat_access_strip_entry'::regproc) like '%v_fallback%';` returns true.
- **Promoter notes**: Order against the API doesn't matter, since the API never reads this function. The data repair touches only lists that are empty now. The API refuses an empty list on every write, so any empty list it finds was left by the old trigger.

## Rollback

Reverting is worth it only if the top-tier fallback itself causes a problem. If so, a forward migration restores the 20261111233000 body of the function. The data the repair wrote stays as it is: it is a valid list an officer can change, and emptying it again would hide those channels once more.

```sql
create or replace function public.chat_access_strip_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text := tg_argv[0] || ':' || old.id::text;
begin
  update public.chat_channels
     set who_can_see = case when v_key = any (who_can_see)
                            then array_remove(who_can_see, v_key) else who_can_see end,
         who_can_post = case when v_key = any (who_can_post)
                             then array_remove(who_can_post, v_key) else who_can_post end
   where chapter_id = old.chapter_id
     and (v_key = any (who_can_see) or v_key = any (who_can_post));
  update public.chat_channel_categories
     set who_can_see = case when v_key = any (who_can_see)
                            then array_remove(who_can_see, v_key) else who_can_see end,
         who_can_post = case when v_key = any (who_can_post)
                             then array_remove(who_can_post, v_key) else who_can_post end
   where chapter_id = old.chapter_id
     and (v_key = any (who_can_see) or v_key = any (who_can_post));
  return old;
end;
$$;
```
