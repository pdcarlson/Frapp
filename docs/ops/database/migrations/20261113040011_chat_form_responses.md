# 20261113040011_chat_form_responses.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Form cards in chat (#3926, step 3): a private table for members' answers to a form, the one function that writes them, and their deletion with the member's account.

## Promotion

- **Purpose**: Adds `chat_form_responses`, one row per member per form card (`message_id`, `user_id`, `answers` jsonb, `created_at`, `updated_at`), with RLS on and no policies, so only the API's service role reads or writes it. It is not in the `supabase_realtime` publication. Adds `save_chat_form_response(uuid, uuid, jsonb)`, security definer with EXECUTE for `service_role` only, which refuses a missing, deleted, non-form or closed card under a share lock on the card's row and upserts the member's answers. Adds the `users_drop_chat_form_responses` trigger, which deletes a member's answers when `anonymize_user` stamps `users.deleted_at`. Writes no row on apply.
- **Checks**: After `db push`: `select relrowsecurity from pg_class where relname = 'chat_form_responses';` returns `true`, and `select count(*) from pg_policies where tablename = 'chat_form_responses';` returns `0`. `select has_function_privilege('authenticated', 'public.save_chat_form_response(uuid, uuid, jsonb)', 'execute');` returns `false`, and the same check for `service_role` returns `true`. `select count(*) from pg_publication_tables where tablename = 'chat_form_responses';` returns `0`.
- **Promoter notes**: Apply it before the API that posts form cards, which calls the function. Additive only: an older API never touches the table. Hosted projects are not applied from a cloud-agent session.

## Rollback

Additive. **Revert the API forward, and keep the migration file** ([playbook § 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)): an API without forms never reads the table or calls the function, and form cards already posted draw as plain messages on clients that don't know the kind.

Dropping the table deletes every member's answers, so do it only once nobody needs them. To remove it in a later forward migration:

```sql
drop trigger if exists users_drop_chat_form_responses on public.users;
drop function if exists public.chat_form_responses_drop_deleted_user();
drop function if exists public.save_chat_form_response(uuid, uuid, jsonb);
drop table if exists public.chat_form_responses;
```
