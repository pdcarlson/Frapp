A member, today and redrawn on the Record page template: Directory opens the member directly, Message is the one next step, and roles are rows.

**Status:** Proposed. Keeps Paul's compact profile Message (#5713, small, sized to its label) and moves it to the record's next-step home.

| | Built from |
| --- | --- |
| Web | Directory row opens the member in `Panel docked` (today a popover from `apps/web/components/members/`) |
| Phone | `apps/mobile/app/(app)/member.tsx`: `ScreenShell`, the same groups, the glass action bar |

## What changes

1. **A Directory row opens the member,** docked like a task. The popover and its View profile button go.
2. **Message is the next step:** header trailing on web, the action bar's pill on the phone.
3. **Roles and groups are rows in one group.** The dashed "+ Add role" and "+ Add to group" chips become one add row, shown only to someone who can assign. Removing is in the row's menu.
4. **Details are one group,** with copy as a glyph on the email.
5. **Points is a row that goes to Points,** carrying the rank once.
6. **No shorthand:** "Columbus, Ohio", "Class of 2026".

## Three people

- **A member looking at another member:** Message; no add row; no menu entries beyond Copy link.
- **An officer who can assign roles:** the add row and each role's Remove.
- **The member themselves:** no button; every value edits where it is.
