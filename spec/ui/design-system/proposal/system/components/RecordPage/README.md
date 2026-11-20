A whole record page: its state first, its next step in the header, and nothing in the body that is a button.

**Status:** Confirmed in parts (rulebook § 2 "record pages read top-down", "destructive actions never sit in a record's body or footer", "edit a thing where you're looking at it"; § 9 phone action bar). The placement rule as a whole is Proposed; see Where things go.

| | Built from |
| --- | --- |
| Web | `Panel docked` with its header, State line, Raised group, property rows, List row, Row menu |
| Phone | `ScreenShell`, the same groups, and the glass action bar (`TaskActionBar`) |

## Where each action goes

1. **Back** to the list, at the leading edge.
2. **More:** Duplicate, Copy link, then Delete last after a break. On the phone it sits in the action bar.
3. **The record's next step:** the one filled button, at the header's trailing edge on web and as the action bar's pill on the phone. "Mark done", "Start", "Host check-in", "Post minutes".
4. **Edit in place:** each value opens its picker where it is and saves at once. No Edit button, no pencil, no edit mode.
5. **Add a line:** the last row of its group, a plus and "Add agenda item".
6. **Copy, download, share:** a glyph on the thing itself.

## Order of the page

The state line, then the properties, then what the record holds (agenda, checklist, attachments), then who (attendance), then history. The order people use it in.

## Against today

The preview's top row is today's event record on both apps. The record now fills the column (today it sits in an inner column a third narrower), its properties are one group, its next step is in the header, and an attendance row shows one status that opens a picker in place of four buttons.

## Rules

- One filled button, and it is the next step. When there is no next step, there is none.
- The title is drawn once.
- No full-width button inside a card. A next step is never in the body.
- Going somewhere else is a row with a chevron ("Minutes"), not a button ("Write minutes").
- A member who can't act sees no button rather than a disabled one, unless the reason is something they can fix.

## You provide

The title, the state, the properties, the groups, the next step and its handler, and the menu entries.
