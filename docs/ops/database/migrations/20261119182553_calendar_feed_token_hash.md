# 20261119182553_calendar_feed_token_hash.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Calendar subscription links are no longer kept readable in the database: a link is looked up by the sha256 of its token and the token is kept only sealed (asked by Paul, 2026-11-19, #5647).

## Promotion

- **Purpose**: `calendar_feeds` gains `token_hash` (sha256 hex, not null, unique) and `token_sealed` (the token sealed under `CALENDAR_FEED_TOKEN_KEY` by the API). `token` becomes nullable and holds plaintext only on links made before this migration, until the API seals them on their next fetch or show. A check keeps exactly one of `token` and `token_sealed` on every row. The migration backfills `token_hash` for existing rows, and a trigger (`calendar_feeds_fill_token_hash`) fills it for a plaintext insert, so an API from before this migration keeps working until the new one deploys.
- **Checks**: after `db push`, this returns one row holding `0`:

  ```sql
  select count(*) from public.calendar_feeds
   where token_hash is distinct from encode(sha256(convert_to(token, 'UTF8')), 'hex')
     and token is not null;
  ```

  After the API deploys with the key set, open Subscribe to calendar in the Events menu on staging: the link shows, and fetching it in a browser downloads a calendar. A link made before the deploy still fetches, and afterwards `select count(*) from public.calendar_feeds where token is not null and revoked_at is null` falls as links are fetched.
- **Promoter notes**: writes data (the hash backfill, one update over the table, which holds one row per member per chapter at most). Apply **before** the API deploy, as the deploy workflows do: the new API reads `token_hash`, which doesn't exist until this runs. The trigger covers the other half of the window, an API from before this migration still inserting plaintext links. Links the new API made or sealed carry no plaintext, so an old instance still serving gets a 404 for them in a calendar app until it is replaced; the window is one rollout. `CALENDAR_FEED_TOKEN_KEY` must be set in Infisical for the environment before the API deploys, or making a new link answers 503 (existing links still fetch and show). With the key, the API's boot pass seals every remaining plaintext link.

## Rollback

Worth reverting only if the new API has to be rolled back. The old API reads `token`, which sealed links no longer have, so their members get a 404 in their calendar app and must copy their link again. Delete those links so the menu makes fresh ones (the old shape can't hold a link without its plaintext), then restore the old shape in a forward migration:

```sql
delete from public.calendar_feeds where token is null;
drop trigger if exists calendar_feeds_fill_token_hash on public.calendar_feeds;
drop function if exists public.calendar_feeds_fill_token_hash();
drop index if exists public.calendar_feeds_token_hash_key;
alter table public.calendar_feeds
  drop constraint if exists calendar_feeds_one_token_form,
  drop constraint if exists calendar_feeds_token_hash_shape,
  drop column if exists token_sealed,
  drop column if exists token_hash,
  alter column token set not null;
```
