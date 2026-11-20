Who sees which button on a task, an event and a member: one filled button, the next step for the person looking, or none.

**Status:** Proposed, drawn for Paul's pick on 2026-11-20 ("Event, task and member pages"). Labels are the apps' own (`TASK_ACTION_LABELS` in `packages/hooks/src/task-card.ts`; Check in, Host check-in, Can't make it on the event).

## The rule

1. **One filled button per record, and it is the next step** for the person looking: Mark done, Confirm, Check in, Host check-in, Message.
2. **No next step, no button.** Nothing is drawn disabled. A member who has handed a task in, checked in, or is looking at their own page sees none.
3. **Everything else is under More**, most used first, Delete last. Start, Mark not done, Can't make it, Remind and Copy link live there.
4. **An answer with two sides is a pair.** An officer reviewing a handed-in task gets Send back (Secondary) and Confirm (Primary) on web; on the phone Confirm is the pill and Send back a named glyph beside it.
5. **The state line says where it stands,** in words ("Moiz Steenhuis marked this done at 12:05 AM"), so the button needs no explanation.
6. **The phone bar shows only when there is a next step.** Otherwise More sits in the header.

## Changes from today

- Web tasks offer Start; the phone offers Mark done. Both offer Mark done, and Start moves under More.
- The event's quiet "Can't make it?" link moves under More.
- Attendance rows show one status that opens a picker, instead of four buttons each. Mark the rest absent is one entry in the section's More.
- A member's own page has no Edit button; its values edit where they are.

## Open

- Whether Send back deserves its own button beside Confirm, or belongs under More. Drawn as a pair because an officer answers one of the two every time.
