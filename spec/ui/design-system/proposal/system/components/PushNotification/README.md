One shape for every notice: the title says what happened, the body says which item and who.

**Status:** Confirmed (Paul, 2026-11-20; rulebook § 6 "push copy works from the lock screen" and "state facts, never narrate directions").

| | File |
| --- | --- |
| Words | composed inline in each API service under `apps/api/src/application/services/` and `workers/`; shared helpers in `push-copy.ts`; sent by `notification.service.ts` |
| Web list | `apps/web/components/layout/notifications-popover.tsx` |
| Phone list | `apps/mobile/app/(app)/notifications.tsx` |

## The shape

| Part | Says | Examples |
| --- | --- | --- |
| Title | What happened, in sentence case. When a person did it, their name leads. | "Minutes recording uploaded" · "Moiz Steenhuis finished: Book the venue" · "Chapter meeting moved" |
| Body | Which item, and what came with it: who, when, how much. Facts joined by a middle dot. | "Recruitment meeting · Winston Hewitt" · "1 photo · 10 points" · "Sunday at 8:00 PM · Great Room" |

## Rules

- The body never restates the title.
- The body never gives an instruction. The screen it opens holds the next step.
- Sentence case. Never Title Case.
- It reads complete from the lock screen: who did what, to what, when. Never just "New event".
- Dates and amounts are written out: "Friday, November 14", "10 points", "$240.00".
- No emoji, no abbreviations, no raw status token, no quotation marks around the item.
- Opening one doesn't stack the screen on itself.

## The row in the app

The same title and body, on both apps: an 8 unread dot in `foreground`, a 36 picture with `radius-sm` (the person's photo, or a tile in the place's hue when no person is behind it), the title in 14/600 with the time in `caption` `muted` at the trailing edge, and the body in 14 `muted-foreground`. Read rows drop the dot and go to 400 `muted-foreground`. Rows sit in a raised group under "Today" and "Earlier", written in sentence case.

## You provide

`title`, `body`, the item it opens, and the actor when there is one.

## Web and phone

One set of words, sent by the API. The row keeps web's 10 picture radius (the phone's is 12) and the phone's read weight of 400 (web's is 500).

## Drift

C1: of 50 notification templates in the API, 41 break the shape: the body restates the title in 14, gives an instruction in 10, the title doesn't say what happened in 6, and 8 carry an abbreviation. Seven titles are Title Case ("Service Hours Approved", "Points Awarded", "New Invoice"). Only the task pushes follow it. The web list's group headings are all-caps.
