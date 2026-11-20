A whole create form: a borderless title, property rows, and one commit in the header that names the thing.

**Status:** Confirmed (rulebook § 2 "create forms are a borderless title plus property rows", 2026-11-19; § 9 the web commit at the header's trailing edge and the phone's glass action bar, 2026-11-20; § 4 "keep the draft"; § 8 "several sections is a pushed screen").

| | Built from |
| --- | --- |
| Web | `Panel docked`, property rows in raised groups, Picker |
| Phone | A pushed screen (`ScreenShell`), the same rows, the glass action bar |

## Where each action goes

1. **Back** keeps the draft. There is no Cancel button and no "are you sure".
2. **Why the commit can't be pressed yet** sits beside it: "Add a name first".
3. **The commit:** one small filled button at the header's trailing edge, verb and noun: "Create event". On the phone it is the action bar's pill with the same words.
4. **Each value** opens its picker in place.
5. **Adding a line** is the add row.

## Rules

- The same rows, in the same order, with the same words on both apps. Orders live in `@repo/validation`.
- No footer: no Cancel and Create pair, no keyboard hint, no helper sentence.
- No "More options" fold.
- Discard is under More.
- Editing an existing record uses the record page, not this form: values save per row.
- On the phone this is a screen, not a sheet. A sheet is for one short pick.
- A short question (rename, report) is a centred dialog instead.

## You provide

The thing's name for the label, the rows, the validation reason, and the commit handler.
