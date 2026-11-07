-- Whether any member may `@` a role in chat (2026-11-06, owner direction:
-- "anyone can ping any role by default. officers can change defaults").
--
-- On by default, so every existing role, seeded or imported, is mentionable
-- the moment this lands. A `roles:manage` holder turns it off per role; while
-- it is off, only a member holding `channels:manage` or `roles:manage` (or the
-- wildcard) can ping the role, and anyone else's `@Role` reaches nobody
-- (`ChatMentionService`, spec/behavior/chat/README.md § Role mentions).
--
-- Additive with a constant default: Postgres 11+ stores it in the catalog, so
-- the table is not rewritten.
alter table public.roles
  add column if not exists mentionable boolean not null default true;
