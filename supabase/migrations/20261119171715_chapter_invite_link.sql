-- One shareable invite link per chapter (#3353, Paul 2026-11-19: "One chapter
-- link, 7 days"). An officer makes one link to post in the chapter's Discord;
-- anyone who opens it joins at the chapter's default invite role until it
-- expires (7 days) or an officer turns it off.
--
-- `reusable`: a redeem leaves `used_at` null, so the link keeps working for
-- the next person. A revoke still sets `revoked_at` and `used_at` together, so
-- every path that refuses a used or revoked token refuses a turned-off link
-- unchanged. False for every existing row and every other kind of invite.
--
-- The partial unique index keeps one live chapter link per chapter: making a
-- new one revokes the old one first (`InviteService.createChapterLink`), and
-- two officers making one at the same moment can't both win.
alter table public.invites
  add column if not exists reusable boolean not null default false;

create unique index if not exists invites_one_chapter_link
  on public.invites (chapter_id)
  where reusable and revoked_at is null;
