-- A chapter link per role (#5633, Paul 2026-11-19: "Officer picks it per
-- link"). Until now a chapter had one live link, always at the chapter's
-- default invite role, so a pledge class posted the link and joined as
-- Brothers. An officer now picks the role for each link, and the chapter can
-- have one live link per role at once: a pledge class link and a brothers
-- link side by side.
--
-- Making a new link for a role turns off only that role's old link
-- (`InviteService.createChapterLink`); this index keeps two officers making a
-- link for the same role at the same moment from both winning, as the old one
-- did for the chapter as a whole. Every existing live link keeps working: no
-- chapter had two, so none collides.
drop index if exists public.invites_one_chapter_link;

create unique index if not exists invites_one_chapter_link_per_role
  on public.invites (chapter_id, role)
  where reusable and revoked_at is null;
