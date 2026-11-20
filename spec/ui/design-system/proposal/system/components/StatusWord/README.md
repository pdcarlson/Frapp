A status is one word, in its semantic text colour, at the start of the meta line.

**Status:** Confirmed as a direction (Paul, 2026-11-20: metadata as chip soup is slop; rulebook § 6 "a record says its state first"). The rule "at most one chip" and the vocabulary picks are Proposed.

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/ui/badge.tsx`; status maps per feature (`tasks/task-status.ts`, `events/attendance-status.ts`, `billing/invoice-status.ts`) | `Badge` |
| Phone | `apps/mobile/components/status-chip.tsx`; `apps/mobile/lib/tasks/status-hue.ts` | `StatusChip`, `HairlineChip`, `AccentChip` |
| Words | `packages/validation/src/status-labels.ts`, `meeting-copy.ts`, `check-in-window.ts` | `STATUS_LABELS`, `statusLabel` |

## Anatomy

**The word.** `caption` at 600, in the tone's text token, first in the meta line, followed by the middle dot.

| Tone | Token | Means |
| --- | --- | --- |
| Good | `success` | paid, present, done and confirmed, check-in is open |
| Waiting | `warning` | pending, waiting on someone, late |
| Bad | `destructive-text` | overdue, past due, absent, declined |
| Under way | `info-text` | in progress |
| Plain | `muted-foreground` | to do, draft, excused, void |

**The chip.** 24 tall, `radius-xs`, 8 of side padding, `caption` at 600. Fill is the tone's tint token and the text its text token. The plain chip has a `border` edge and no fill. A chip is for a status that stands alone: a cell in a table, the trailing slot of a row, a record's header.

**Live.** Something happening now leads with an 8 dot in `destructive` and stays `foreground`: "Winston Hewitt is recording".

## You provide

The status token and its vocabulary. The word comes from `statusLabel`; never write a status literal in a screen.

## Rules

- One status per row. If two things are true, the one the member has to act on wins.
- Never two chips side by side. Type, counts, points and dates are meta facts, not chips.
- The same state has the same word, tone and shape on both apps.
- A status is never the chapter accent, and the accent is never a status.
- Colour never carries a status alone: the word is always there.

## The words

See the brand book's status table. Where today's code uses two words for one state, the system picks one.

## Web and phone

Same chip metrics on both already. The system keeps web's named tones (a screen says `info`, not a hex) and brings the phone's three chip components down to one.

## Drift

W2: 6 true chip-soup rows on web (Tasks board, Study, Service entries, Invoices). M2: 2 true on the phone (`minutes-row.tsx`, `suggested-tasks.tsx`). C4: 12 states have more than one word. Four chip families on the phone, plus about 25 files with local chip styles; 28 bespoke chip or tag components on web.
