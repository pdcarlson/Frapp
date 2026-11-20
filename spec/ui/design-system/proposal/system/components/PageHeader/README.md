The page's title with every page action beside it, and the way out.

**Status:** Confirmed (rulebook § 2, 2026-11-19; P8.1). The title's size is Proposed.

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/layout/tool-page-header.tsx`, `apps/web/components/layout/page-actions.tsx` | `ToolPageHeader`, `PageActions` |
| Phone | `apps/mobile/components/screen-shell.tsx`, `header-button.tsx`, `back-row.tsx` | `ScreenShell`, `HeaderButton`, `BackRow` |

## Anatomy

**Web.** A fixed bar `space-3xl` (48) tall with the `border` hairline under it, 24 of side padding and 8 between actions. Left: the title. Right, in this order: view switch, search, Filter, any other action, the main action (New), then close.

- Title in `title` (18/600), `foreground`. *Proposed.* Today it is 14/700, the same size as a row title, so a page has no anchor.
- Every action is a `control-small` (36) control; 44 under a coarse pointer.
- Close is an icon button with the close glyph, named "Close Tasks".
- Only Settings pages show a parent: "Settings › Roles".

**Phone.** No bar. A glass back capsule (36 tall, 18 radius, the back glyph in `primary`, then the name of the screen behind it) is pinned at the top. The title is `headline` (24/700) and scrolls with the page. At most one header button sits beside the title: a 36 round, `surface-1` with the `border` hairline, glyph in `foreground`.

## You provide

Web: the page's `title`, an optional `parent`, and the actions as children of `PageActions`. Phone: `title`, `back`, an optional `headerAction`, and `createAction` for the floating plus.

## Rules

- Page actions live in the header, never on a row of their own under it. The only exception is a control that needs the page's full width.
- Nothing sits between the header and the first item at rest. Filters that are on appear as a chip row under the header and leave when cleared.
- One primary thing per header. Rare actions go behind the more button.
- Every page has a visible way back: the close on web, the back capsule on the phone. The swipe alone is not enough.
- Never draw the title a second time in the body.

## Web and phone

The structure differs by platform on purpose: the phone has no room for a bar of labelled buttons. The system keeps web's bar and the phone's capsule, and holds the two to the same title, the same actions and the same order. Where web shows a labelled Filter button, the phone shows the same filter as its header button or its one Filters chip.

## Drift

W7: 11 of 18 web pages put a toolbar in the body (Directory, Billing invoices, Chat admin, Study zones, Reports are the true ones). M19: 13 body control rows on 6 phone screens. Two web rivals draw their own header: `PanelHeader` and `settings-subpage.tsx`.
