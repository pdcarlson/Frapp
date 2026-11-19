-- Calendar subscription links are no longer kept readable in the database
-- (asked by Paul, 2026-11-19; `spec/behavior/events.md` § Calendar
-- subscription).
--
--   token_hash    sha256 of the link's token, hex. What a fetch looks the link
--                 up by: the token in the request is hashed and compared.
--   token_sealed  the token sealed under `CALENDAR_FEED_TOKEN_KEY`
--                 (AES-256-GCM, the envelope `ai-text-cipher.ts` writes),
--                 bound to the link's chapter and member. What lets the
--                 Subscribe menu show the same link again. A database read
--                 alone opens neither.
--   token         the plaintext, now only on links made before this
--                 migration. The API seals and clears it the next time the
--                 link is fetched or shown, so a live link converts within a
--                 calendar app's refresh. A later migration drops the column.

alter table public.calendar_feeds
  add column if not exists token_hash text,
  add column if not exists token_sealed text;

update public.calendar_feeds
   set token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
 where token_hash is null
   and token is not null;

alter table public.calendar_feeds
  alter column token_hash set not null,
  alter column token drop not null;

-- While an API from before this migration is still serving (the migration and
-- the deploy don't land at the same instant), it inserts a plaintext token
-- only. Fill its hash so that insert still succeeds and the link still
-- fetches; the new API then seals it like any legacy link. Dropped with the
-- `token` column.
create or replace function public.calendar_feeds_fill_token_hash()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.token_hash is null and new.token is not null then
    new.token_hash := encode(sha256(convert_to(new.token, 'UTF8')), 'hex');
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_feeds_fill_token_hash() from public, anon, authenticated;

drop trigger if exists calendar_feeds_fill_token_hash on public.calendar_feeds;
create trigger calendar_feeds_fill_token_hash
  before insert on public.calendar_feeds
  for each row execute function public.calendar_feeds_fill_token_hash();

alter table public.calendar_feeds
  drop constraint if exists calendar_feeds_token_hash_shape;
alter table public.calendar_feeds
  add constraint calendar_feeds_token_hash_shape
  check (token_hash ~ '^[0-9a-f]{64}$');

-- Exactly one way to show the link again: the legacy plaintext or the sealed
-- copy, never both (sealing clears the plaintext in the same update) and
-- never neither.
alter table public.calendar_feeds
  drop constraint if exists calendar_feeds_one_token_form;
alter table public.calendar_feeds
  add constraint calendar_feeds_one_token_form
  check ((token is null) <> (token_sealed is null));

create unique index if not exists calendar_feeds_token_hash_key
  on public.calendar_feeds (token_hash);

comment on column public.calendar_feeds.token is
  'Legacy plaintext link token; null once sealed. Only links made before 20261119182553 carry it, until their next fetch or show.';
comment on column public.calendar_feeds.token_hash is
  'sha256 of the link token, hex: what a fetch looks the link up by.';
comment on column public.calendar_feeds.token_sealed is
  'The link token sealed under CALENDAR_FEED_TOKEN_KEY, bound to the link''s chapter and member, so the Subscribe menu can show it again.';
