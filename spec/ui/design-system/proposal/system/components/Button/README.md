The button variants, and how a form commits on each app.

**Status:** Confirmed (`spec/ui/design-system/components.md` § 3; rulebook § 7 "no giant full-width buttons", 2026-11-20; § 9 "creating and editing"). A shared phone button is Proposed. An intentional addition to the requested list: the New button and the commit rules can't be read without it.

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/ui/button.tsx`, `apps/web/components/ui/icon-button.tsx` | `Button`, `IconButton` |
| Phone | none shared. `apps/mobile/components/tasks/task-action-bar.tsx`, `sheet-scaffold.tsx`, `tinted-control.ts` | `TaskActionBar`, `SheetPrimaryButton` |

## Variants

| Variant | Paint | For |
| --- | --- | --- |
| Primary | `primary` fill, `primary-foreground` label at 700; hover `primary-hover` | The one commit of a surface: "Create event", "Mark done". At most one. |
| Secondary | `card` fill, `control-edge` edge, `foreground` at 600; hover `card-hover` | Cancel, Filter, every neutral action. |
| Action | no fill, `primary` at 35% edge, `primary` label at 600; hover `primary` at 10% | The page's main action in its header: New, Adjust points, Upload. |
| Tinted | `accent-subtle` fill, `accent-border` edge, `accent-text` at 700 | An invitation inside content: Sign up, the first action of an empty group. |
| Ghost | no fill, `muted-foreground` at 600; hover `card-hover` and `foreground` | Quiet actions and every icon button. |
| Destructive | `destructive-tint` fill, `destructive-text` at 700; hover `destructive-tint-hover` | The confirm of a delete. Only inside a confirm dialog. |
| Link | `accent-text` at 600, underlined on hover | A link in running text. |

Sizes: Default is `control-field` (40) with 16 of side padding; Small is `control-small` (36) with 12. Both are 44 under a coarse pointer. Radius `radius` (12). Label 14. Glyph 16, 8 from the label. Disabled: `card` fill, `border` edge, `disabled` label. Focus: the edge goes to `accent-text` with a 3 spread of `ring` at 25%.

## Where a button goes

A variant is a kind of action, and each kind has one home. Primary: a header's trailing edge, the phone's action bar, or a dialog. Action: the page header, or the floating plus. Tinted: the trailing edge of the row or card it belongs to. Ghost: glyph buttons on an edge. Secondary: headers and dialogs. Destructive: a confirm dialog only. No variant stands on a line of its own in the body. See Where things go.

## Rules

- A button is as wide as its label. Never stretched across a profile, a card, a panel or a page.
- Full width stays only on single-column sign-in, setup and payment screens.
- One Primary per surface.
- Words for primary verbs only. Download, Copy and Close are glyphs.
- The label names the thing: "Create event", never "Create" or "Submit".
- A disabled commit says why beside it ("Add a title first").
- Hover changes colour only. Nothing scales.

## How a form commits

- **Web:** one small labelled button at the header's trailing edge.
- **Phone:** the floating glass action bar: a 44 accent pill with its glyph and verb, plus 44 round icon buttons for related options, on glass with a 26 radius, centred above the bottom edge.

## Web and phone

Web has one component with seven variants. The phone has none, and draws its buttons per file. The system keeps web's variants and proposes one phone `Button` with the same names.

## Drift

W5: 10 full-width buttons on web outside sign-in and setup (27 inside). M5: 47 on the phone in 38 files, 43 of them `SheetPrimaryButton`. `Button size="sm"` and `size="toolbar"` are the same class string. Only 4 explicit Primary uses on web.
