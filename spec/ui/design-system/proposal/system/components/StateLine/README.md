The first line of a record: who did what, and when.

**Status:** Confirmed (Paul, 2026-11-20, #5732: "a record says its state first"; "indicate, don't narrate"). An intentional addition to the requested list: it is the rule that most sets Frapp's voice, and it has no shared component yet.

| | File |
| --- | --- |
| Web | none shared. Proposed home: `apps/web/components/shared/state-line.tsx` |
| Phone | none shared. Proposed home: `apps/mobile/components/state-line.tsx` |
| Words | `formatActedLabel` in `packages/formatting` ("Submitted today at 9:04 PM") |

## Anatomy

One line directly under the record's title, before its fields.

- A 20 avatar of the person.
- Their full name in `foreground` at 600.
- The verb phrase in `muted-foreground`: "marked it done", "is drafting", "sent it back", "posted".
- The time in `muted`: "today at 12:05 AM", "since 7:42 PM".
- What they sent sits under it in a raised group: a photo count, a note, the points.
- Live states lead with an 8 dot in `destructive` in place of the avatar: "Winston Hewitt is recording".

Size: 14 on a record page; `caption` when it is a row's meta line.

## You provide

The actor, the verb token, the timestamp.

## Rules

- State, never instruct. "Moiz Steenhuis marked it done today at 12:05 AM", never "Confirm to award 10 points, or send it back if something's off."
- Always a person. Never a passive "Marked done" with nobody behind it.
- Real names and real photos. Never "A member".
- Don't repeat the record's own noun: under a meeting's title, "Draft · Shawn Klein", not "Meeting minutes for this meeting: a draft".
- The next step is the screen's own control (the action bar, the header's button), not a sentence.
- History below uses the same line, one per event, newest first.

## Web and phone

Identical, from one shared formatter.

## Drift

C2: 255 directive or narrating strings across web (108), the phone (66) and the shared packages (81). The worst are shared, so they ship to both apps: "A draft, not posted yet" and "Minutes show here once a secretary posts them." in `packages/validation/src/meeting-copy.ts`, and "Drafted from … Read it over and fix anything, then post." in `minutes-flow.ts`.
