Where a record or a form opens: docked in the page on web, a content-sized sheet or a pushed screen on the phone.

**Status:** Confirmed (rulebook § 2 "no overlay side cards, ever", 2026-11-19; § 8 "several sections is a pushed screen"; Paul 2026-11-20: no sheet hides what you're working on).

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/shared/panel.tsx`, `apps/web/components/ui/dialog.tsx` | `Panel docked`, `PanelHeader`, `PanelBody`, `Dialog` |
| Phone | `apps/mobile/components/sheet-scaffold.tsx`, `apps/mobile/components/tasks/task-action-bar.tsx` | sheet scaffold, `TaskActionBar` |

## Which surface

| Job | Web | Phone |
| --- | --- | --- |
| A record, or a form with several sections | Docked panel in the page's own column | A pushed screen with a back capsule |
| One short pick or action | A dropdown under its control | A sheet as tall as its content |
| A short question (rename, report, confirm) | A centred dialog | A centred dialog |
| A quick list | A dropdown under its button | The glass menu |

## Anatomy

**Docked panel (web).** It replaces the page in its column; it never slides over it. Header 48 tall with the `border` hairline: a back arrow, the record's title in 16/600, the more button, then one small labelled commit. Body 20 of side padding, groups 16 apart.

**Dialog.** `popover` fill, `radius-2xl`, the `border` hairline, 24 of padding, at most 512 wide. Title in `title`. Buttons at the trailing edge, compact, Cancel first. Under it a scrim of 55% black with a 6 blur.

**Sheet (phone).** `popover` fill, `radius-2xl` on the top corners, a 40 by 4.5 grabber. It is as tall as what is in it, up to 8 rows; a longer list scrolls at 70% of the screen. Groups inside take `card`. Scrim 55% black.

**Commit.** Web: one small labelled button at the header's trailing edge that names the thing ("Create event"); while it can't be pressed it is dimmed and says why beside it. Phone: the floating glass action bar, a labelled accent pill with its glyph and verb plus round icon buttons for related options.

## You provide

The title, the body, the commit's label and handler, and the menu entries for the more button.

## Rules

- No card slides over the page from the side. Ever.
- A sheet never covers the thing it is editing. If the form has several sections, it is a screen.
- A picker has no Done and no Cancel: a tap picks and closes.
- No full-width button ends a sheet or a panel.
- Leaving keeps the draft. Never "are you sure" on the way out.
- Escape, the scrim and Android back each close the top layer.

## Web and phone

The system keeps the docked panel and the phone's sheet scaffold. It keeps the phone's glass action bar as the only commit on the phone, and retires the 48 full-width sheet button and the header pill.

## Drift

Web is clean on overlays: all 18 panels dock, and the one overlay left is the narrow-window navigation drawer. File names lag (`*-sheet`, `*-drawer`, `*-dialog` are all docked panels now). Phone: 58 sheets, 18 of them full height; M10 flags 15 that hold several sections; `SheetPrimaryButton` (the full-width bar) has 43 uses in 34 files against 4 for the action bar; three close styles (Cancel, Done, a close glyph).
