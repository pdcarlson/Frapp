-- New chapters start with no event types (Paul 2026-11-20, #5776).
--
-- 20261111200000_event_types.sql seeded seven types into every new chapter
-- through trg_chapters_seed_event_types. Officers now make a type in place
-- from the event form's Type menu, so a chapter starts empty and names its
-- own. Existing chapters keep every type they have: this drops the trigger
-- and its two functions and touches no row.

drop trigger if exists trg_chapters_seed_event_types on public.chapters;
drop function if exists public.chapters_seed_event_types();
drop function if exists public.seed_default_event_types(uuid);
