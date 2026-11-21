-- "This time last year" event suggestions go to the people who plan the
-- calendar, not to every member (#4549, Paul 2026-11-13).
--
-- `ai_suggestions.required_permission` is written from the kind's handler
-- when a suggestion is made, and both the Suggested list and every decision
-- read it from the row. The `event` kind asked for `events:create`, which
-- #3709 made a member default, so any member saw these and could dismiss one
-- for good. The handler now asks for `events:update`; this carries the rows
-- already written to the same gate. Decided rows move too, so every `event`
-- row says the same thing about who could decide it.
--
-- `new_event` (a card a member asked Ask for, #718) keeps `events:create`:
-- only the member who asked can see it.

update public.ai_suggestions
set required_permission = 'events:update'
where kind = 'event'
  and required_permission = 'events:create';
