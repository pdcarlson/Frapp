The one create action: an outlined accent button on web and the floating glass plus on the phone.

**Status:** Confirmed (rulebook § 2, Paul's pick 2026-11-19; P8.2).

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/ui/new-button.tsx` | `NewButton` (a `Button variant="action" size="toolbar"`) |
| Phone | `apps/mobile/components/floating-create-button.tsx`; on the four tabs `glass-tab-bar.tsx` and `quick-actions/` | `FloatingCreateButton` through `ScreenShell`'s `createAction` |

## Anatomy

**Web.** `control-small` (36) tall, `radius` (12), 12 of side padding, 8 between the plus and the label. Edge: `primary` at 35%. Label and plus: `primary`, 14/600. No fill at rest; `primary` at 10% on hover. In a header narrower than 26rem it collapses to a 36 square with the plus alone and keeps its name for a screen reader.

**Phone.** A 56 glass circle, 16 from the trailing edge, floating above the tab bar. The plus is 24, stroke 2.2, in `primary`. On the four tabs the same spot is the tab bar's 62 quick-actions plus, which opens the grid of create actions.

## You provide

Web: `thing`, singular and lower case ("event", "task", "minutes"). The label is always "New " plus the thing. Phone: `createAction` with a `label` ("New event") and `onPress`.

## Rules

- Every create action in the product is this component. Never a hand-built button that says New, Add or Create.
- The wording is "New event", never "Add event", "+ Create task" or a bare "Create".
- A page's main action that is not a create ("Adjust points", "Log service", "Upload") is the same outlined accent button, `Button variant="action"`, in the same place.
- One per page. A second way to create the same thing on the same screen is a defect.
- Never filled, never full width, never a pill.
- Adding a line to a record (an agenda item, a subtask) is not a page create: it is a quiet row at the end of that list.

## Web and phone

Web names the thing; the phone's plus is unlabelled because its place and glass already mean "create" on every screen. The system keeps both.

## Drift

Web has 6 `NewButton` call sites; W6 finds 37 hand-built create-like buttons in 29 files (about 10 are true page creates, including Directory's filled "Invite member"). On the phone only 5 screens use `createAction`; M6 finds 21 inline create controls in 13 files.
