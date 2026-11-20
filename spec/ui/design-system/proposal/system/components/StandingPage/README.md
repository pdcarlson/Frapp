A page that answers "where do I stand?": one figure, then To review, yours, and the chapter's.

**Status:** Proposed. The fold and the hiding of the officers' queue are Confirmed (P5.8, #4766). Drawn for Service hours beside today's capture.

| | Built from |
| --- | --- |
| Web | Page header, Segmented, Raised group, Section header, List row |
| Phone | `ScreenShell`, the same groups, the floating plus |

## Skeleton

1. **Header:** the title, the window switch ("This semester", "All time"), More, the main action ("Log service").
2. **The figure,** in a raised group: the number in `display`, its unit written out beside it in `label` `muted-foreground`, and one line of context in `caption` ("5th of 10 in the house · Nothing pending"). One figure, never a row of them.
3. **To review** (officers only): five rows at most, with Show all.
4. **Yours:** your log, your history, your invoices.
5. **The chapter's:** standings. The rank is a numeral in `muted`; a tie shows it once; your own row takes `popover` and reads "You" on the phone.

## Rules

- The number is `foreground`, never the accent, with tabular numerals. The unit is a word.
- The window switch is in the header and changes the whole page.
- A member never sees To review, and never a zero in its place.
- At zero the figure reads 0 and the first action sits in the first group.
- Used by Activity, Points, Service hours, Study hours, Dues and You.

## You provide

The figure and its context line, the window options, and each section's rows.
