A task, today and redrawn on the Record page template: one next step, every value edited where it is, and the same groups on both apps.

**Status:** Proposed. Built from the Record page rules (Where things go) and rulings already confirmed: edit a thing where you're looking at it, destructive actions never in a record's body, the phone's glass action bar (2026-11-20).

| | Built from |
| --- | --- |
| Web | `apps/web/components/tasks/` task panel: `Panel docked`, State line, Raised group, property rows |
| Phone | `apps/mobile/app/(app)/task-details.tsx`: `ScreenShell`, the same groups, `TaskActionBar` |

## What changes

1. **One next step on both apps.** Mark done, in the header on web and as the action bar's pill on the phone. Start moves under More, because a member who finishes in one go never needs it.
2. **The title is drawn once,** in the header.
3. **Every value is a row** that opens its picker: who, due, points, proof, repeats. The segmented Proof switch, the "Just you" select and the "Add photos" button go.
4. **The phone shows the same facts** as web, in the same order, instead of a three-column grid of three.
5. **No pencil, no edit mode.** Values edit in place on the phone as they do on web (decision 31).
6. **No narration.** "Changes save as you make them" and "Marking it done needs nothing more" go. "+5 pts" becomes "5 points".

## Order of the page

State line, properties, notes, steps, photos (when proof is a photo), history.

## Three people

- **The member it's assigned to:** Mark done.
- **The officer who assigned it, once it's handed in:** Confirm, with Send back under More.
- **Anyone else who can see it:** no button.
