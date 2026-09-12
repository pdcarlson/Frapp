# Deletion checklist

Acceptance for lanes 2 through 7 of [#2140](https://github.com/pdcarlson/Frapp/issues/2140). The
greenfield is a **hard cleanup**: it removes generated chrome to give content more room. A lane is
not done because a new surface renders; it is done when the thing it replaced is gone.

This list is the acceptance criterion, not a suggestion. It restates the
[cutover rule](../../../.claude/skills/signet-cutover/SKILL.md): a change that supersedes an
implementation deletes it in the same change. Git history is the backup.

Every path and line count below is `wc -l` output, refreshed at `3161e90` (merge of `8ab9d86`).
**Expect them to be wrong by the time you read this** — they were already stale in the commit that
first wrote them, because lane 1 edited three of the files it counts, and merging one unrelated PR
into this branch moved a fourth. Re-run rather than trust:

```sh
wc -l apps/web/components/layout/{dashboard-shell,dashboard-command-menu,ask-pill,account-menu,chapter-switcher,chapter-lockup,beta-badge,dashboard-notification-drawer}.tsx
```

The numbers are a sizing hint for planning a lane, never an identifier. Paths and "sole importer"
claims are the durable part; re-read before deleting either way.

---

## 1. Command palette (Cmd+K) — lane 2

| File | Lines | Note |
| ---- | ----- | ---- |
| `apps/web/components/layout/dashboard-command-menu.tsx` | 407 | The palette |
| `apps/web/components/layout/dashboard-command-menu.spec.tsx` | 516 | Its suite, deleted with it |
| `apps/web/components/layout/dashboard-shell.tsx` | — | The `k` keybinding and the mount |
| `apps/web/components/ui/command.tsx` | 165 | The `cmdk` wrapper |

- [x] Palette component and its suite deleted
- [x] Keybinding removed from the shell, and the top bar's Search control removed or repointed
- [x] `cmdk` dependency removed from `apps/web/package.json` **only if** `ui/command.tsx` has no
      surviving consumers — **kept**, it has three consumers and only one was the palette
      (`chat/slash-palette.tsx` and `onboarding/chapter-wizard.tsx` remain)

**Taken by lane 2.** The replacement is the top bar's find field on Cmd/Ctrl+F
(`components/layout/find-bar.tsx`). It is visible rather than summoned, and it advertises the
binding it actually wires. Its Navigation group did not need re-deriving because it has no
navigation list at all: it finds channels, members and messages, which is what its placeholder
promises. Nav gating therefore stays exactly where it was, in `nav-config.ts` +
`isNavItemVisible`.

> **`cmdk` is not scoped to the palette.** `ui/command.tsx` has two other consumers besides the
> palette. Deleting the palette does not automatically free the dependency. Check before removing it,
> and leave it if something still uses it.

Behavior this must not silently drop: the palette's Navigation group is **derived** from
`nav-config.ts` and runs the same `isNavItemVisible` permission gate the sidebar does
([`../web-dashboard/README.md`](../web-dashboard/README.md) § Top bar). Whatever replaces it either
keeps that derivation or has no navigation list at all. A hand-maintained list is the defect the
current palette already fixed once.

## 2. Details rail — lane 3

| File | Location | Note |
| ---- | -------- | ---- |
| `apps/web/components/chat/chat-shell.tsx` | `:915` | Grid is `md:grid-cols-[260px_1fr_300px]` |
| `apps/web/components/chat/chat-shell.tsx` | `:1278-1310` | The `<aside aria-label="Thread">` |

- [x] Third column removed and the grid collapsed to two columns
- [x] The static "Details" placeholder deleted rather than hidden
- [x] `ThreadPanel` given a new home, or removed with a stated decision about threads

> The rail is **not empty**: it hosts `ThreadPanel` as well as the placeholder. Deleting the column
> without deciding where threads go removes a feature. Decide, then delete.

**Taken by lane 3, and the decision about threads is: deleted, with the entry point repointed.**

`ThreadPanel` was a **read-only collector** — its own doc comment said so. It listed a message and
the replies to it, all of which were already in the timeline underneath. It never had a composer, and
since [#489](https://github.com/pdcarlson/Frapp/pull/489) it was not even how you reply: the row's
Reply control stages an inline reply in the composer, and the panel's only remaining entry point was
clicking the quote above an existing reply.

That quote now calls `onJumpToParent`, which scrolls the timeline to the message it quotes — the same
`scrollToMessage` machinery pins, saved messages and deep links already use. The destination is the
real conversation with a composer under it, rather than a copy of it in a third column, so the
feature the rail carried is not lost; it is served better by the surface that was already under it.

What went with the panel: `thread-panel.tsx`, `thread-panel.spec.tsx`, and the shell state that drove
it (`threadParentId`, `openThread`, `closeThread`, `dismissThreadForChannelSwitch`,
`threadTriggerRef`). `use-tap-revealed-message.ts` survives with one caller instead of two and says
so in place.

## 3. Channel search — lane 3

| File | Location |
| ---- | -------- |
| `apps/web/components/chat/channel-list.tsx` | `:188` the `query` state, `:220-226` the `filtered` memo, `:302-317` the input |

- [x] Search input, its state, and its filter memo removed together
- [x] No orphaned `SearchGlyph` import left behind

**Taken by lane 3.** The `Input`, the `query` state, the `filtered` memo, the "No matches. Try a
different name." empty state and the `SearchGlyph` import all went together; `sections` now iterates
`channels` directly. The replacement is the top bar's find field on Cmd/Ctrl+F, which finds channels
*and* members *and* messages (`1b` pin 8).

**One thing the find bar does not cover, recorded rather than glossed.** The deleted field filtered on
`titleFor`, which runs `directChannelDisplayName` — so typing a person's name found the **DM** with
them. `find-bar.tsx` matches its Channels group on the raw `row.name` from the channel payload, which
for a DM is not the participant's name, so a DM is no longer reachable by typing who it is with. The
member is still findable (Members group), but that lands on `/members`, not on the conversation. This
is a real narrowing, it belongs to the find bar rather than to this rail, and it is filed as a
follow-up rather than fixed here.

Two things that look like search and are not, kept: `titles`/`titleFor` also resolve every row's
displayed title and its sort key, so a DM sorts under the participant's name rather than a uuid. The
two spec cases that drove the deleted field were rewritten against what they actually pin (name
resolution, and grouping dropping an empty category) rather than deleted.

The "N channels" count above the list is deleted too (`1t`), and the read-only "Read" badge is now a
lock glyph with an `sr-only` label (`1b` pin 7).

## 4. Ask entry and AI chrome — lane 3 or 7

| File | Lines | Note |
| ---- | ----- | ---- |
| `apps/web/components/layout/ask-pill.tsx` | 102 | Sole importer `dashboard-shell.tsx:36`, mounted at `:497` |

- [x] Decide: remove the Ask pill, or keep it and restyle it in the greenfield top bar —
      **kept and restyled** by lane 2 to the board's 34px/r10 top-bar geometry. The `gold-ask-*`
      tokens therefore keep their consumer and L-05 does not fire
- [ ] If removed, the `gold-ask-*` tokens lose their only consumer. Remove them from `signet.css`
      and `signet.ts` in the same change, or state why they stay

> **"AI page narration" does not exist in `apps/web`.** It was on the epic's deletion list, but there
> is no page-summary or narration surface in the codebase, and no model call anywhere in the app. The
> Ask pill is a **stub**: it opens a dialog that says Ask cannot answer yet. Nothing else to delete.
> Recorded here so a later lane does not go looking for it.

## 5. Shell — lane 2

| File | Lines |
| ---- | ----- |
| `apps/web/components/layout/dashboard-shell.tsx` | 514 |

Seven satellites, none imported outside the shell: `account-menu.tsx` (136),
`chapter-switcher.tsx` (225), `chapter-lockup.tsx` (141), `beta-badge.tsx` (90),
`dashboard-notification-drawer.tsx` (229), `ask-pill.tsx` (102), `dashboard-command-menu.tsx` (407).

- [x] Each satellite either rebuilt or deleted. None left rendering beside a replacement
- [x] `nav-config.ts`, `protected-nav-item.tsx`, and the account menu's shared bottom region survive
      or have their behavior re-homed. These carry permission and module gating, which is behavior,
      not chrome
- [x] The responsive contract is re-stated or deliberately changed. Today it is **two states, not
      four**, switching once at `lg`. Adding a tier is a spec change

**Taken by lane 2.** Where each satellite went:

| Satellite | Outcome |
| --------- | ------- |
| `dashboard-command-menu.tsx` + spec | Deleted. See §1 |
| `chapter-lockup.tsx` + `chapter-switcher.tsx` (+ spec) | **Merged** into `chapter-nav-header.tsx`, the 40px chapter row at the top of the nav. The switcher's suite was ported, not dropped; two of its cases reverse deliberately, because the row is now identity and renders for single-chapter users too |
| `beta-badge.tsx` | Deleted. Only `sidebar_pill` was ever referenced and the Status/BETA row is deleted chrome; the other three styles were dead code |
| `account-menu.tsx` | Rebuilt. Moved off the nav onto the top-bar avatar (`topbar` variant); the drawer keeps a full-width row |
| `ask-pill.tsx` | Rebuilt to the board's 34px/r10 top-bar geometry. Still `gold-ask-*`. See §4 |
| `dashboard-notification-drawer.tsx` | Kept as-is; the bell that opens it moved into the new top bar |
| `dashboard-shell.tsx` | Rewritten. Split into `app-nav.tsx`, `top-bar.tsx`, `find-bar.tsx`, `page-header.tsx` |

The responsive contract is **unchanged and deliberately so**: still two states switching once at
`lg`. The 56px rail is a remembered user preference inside the desktop state, not a third viewport
tier — below `lg` the drawer renders `AppNav` always-expanded and the rail never appears.

The shell also gained its first unit coverage (`dashboard-shell.spec.tsx`), which had been none at
all. It pins this lane's three acceptance criteria: the route renders in the shell, ⌘K is gone, and
no title sits in the top bar.

## 6. Scrollbars — lane 2

- [x] Chrome's default scrollbars replaced using the `--scrollbar-*` tokens from
      [`tokens.md`](tokens.md)
- [x] ~~Applied to the shell's scroll regions, not globally to `*`~~ — **reversed.** Applied
      globally, on `*`
- [x] Reduced-motion and keyboard scrolling unaffected

**Taken by lane 2, and this section's second line was wrong.** It restated the pre-greenfield
`foundations.md` §12 rule. The framework board (option `3a`) declares the bar at the root, calls it
chrome, and says scrollbars are "never hidden" — and committed HTML outranks written docs while
#2140 is open. The `.signet-scroll` opt-in class had zero call sites repo-wide, so it was retired
rather than left standing beside the global rule, and `foundations.md` §12 was rewritten in the same
change rather than left contradicting the code.

Values are the board's: 8px, `#DDB844` thumb on a `#1A1A1A` track, both fixed and never retinting
per chapter. The board's own CSS was **not** copied verbatim — see `tokens.md` L-01 for why it does
not render what it specifies in Chrome, and for the measured cost of the `#332E26` skeleton
highlight that shipped alongside it.

## 7. Standing bans

Most of these already hold; the shadow one does not. The greenfield must not reintroduce any of
them, and must close the one that is open.

- [ ] No `next-themes`, no theme switcher, no light palette. Signet web is dark-only
- [ ] No live `dark:` variants
- [x] No **live** `shadow-*`. Elevation is a lighter surface step. ~~**This one is not clean
      today.**~~ **The defect is closed by lane 3**, both halves. The two live sites
      (`apps/web/components/chat/mention-list.tsx:128` and `:140`) dropped their `shadow-md`, and
      `md` is now bound in the shared preset (`packages/theme/src/tailwind.config.ts`) against a new
      `--shadow-md: none` in `signet.css`, so the gap cannot reopen by someone typing `shadow-md`
      again. The original diagnosis was exactly right: `boxShadow` bound `xs`/`sm`/`DEFAULT`/`lg`
      only, so `shadow-md` fell through to Tailwind's built-in and compiled a real drop shadow past a
      ban everyone believed the `none` tokens enforced.

      The check is `grep -rn 'shadow-md' apps/*/components apps/*/app`, which returns nothing — a
      plain `grep -rn 'shadow-md' apps packages` does **not**, because it matches this row's own
      reasoning in `tailwind.config.ts` and the token in `signet.css`. A proof that cannot fail is
      not evidence, and neither is one that fails on its own footnotes.

      **Where the `md` key lives is load-bearing.** It is bound in
      `apps/web/tailwind.config.ts`, with the other Signet-only keys, and deliberately **not** in
      the shared preset: that preset still serves the frozen `apps/landing`, whose `globals.css`
      has real shadows and no `--shadow-md`, so binding it there would make `shadow-md` resolve
      against an undefined property and be dropped — the silent failure #1145 documented, which is
      the whole reason that app config exists. `signet.css.spec.ts`'s shadow roster now includes
      `--shadow-md`, so deleting the token fails a test rather than quietly reopening the gap.

      **The box is ticked for "no shadow that renders", not "no `shadow-` string".** One inert class
      remains, `settings-roles-tab.tsx:197`'s `shadow-sm`, which resolves to `--shadow-sm: none` and
      draws nothing — `card.tsx` reasons about exactly this. It is dead class text on a lane 5
      surface and should go when that lane touches the file. What made the `md` case different, and
      a real defect rather than dead text, was that it had no token behind it at all
- [ ] No legacy bone / bronze / Geist token on this surface
- [ ] No unused component left under `apps/web/components/ui`
- [ ] No customer-facing "Frapp" string or wordmark

## 8. Resources: Documents and Backwork — lane 4

Not a pre-written row, because this list was drafted against the shell and chat and the resources
family was never on it. Written as the lane landed, in the same shape as the rest.

**The board does not draw either page.** `1j` is the Backwork upload dialog and is the only frame in
the file that is about this family at all. "Documents" and "Backwork" otherwise appear only as nav
labels under the `Resources` section header, in the `4d` plan matrix, and in `4b`'s locked-module
copy. So the two page bodies are **derived** — from `1f` pin 2 (one toolbar row, no wrapper card, no
description paragraph), the `4d` table (36px header, 40px rows, top-border dividers, no zebra and no
per-row fill) and the section label §2 already defines. That derivation is the part a later lane is
most likely to need to revisit, which is why it is stated rather than left in the diff.

### What was deleted

| File | What went | Note |
| ---- | --------- | ---- |
| `documents-page.tsx` | The narration paragraph under `PageHeader` | "Organizational files — bylaws… upload and delete are permission-gated". Board: page-narration paragraphs, removed outright |
| `documents-page.tsx` | Both wrapper `<Card>`s, four `CardTitle`/`CardDescription` blocks | The folder rail card and the list card. Their headings survive as `EYEBROW` section labels; their descriptions did not |
| `backwork-page.tsx` | The narration paragraph, on **both** return paths | The no-chapter early return carried its own copy ("Shared coursework archive.") |
| `backwork-page.tsx` | The Filters card and the Resources card | `1t` names the Events "filter card" as gone; this is the same card one route over |
| both | `DialogDescription` on the upload dialogs | `1j`: "no instructional paragraph". The one actionable fact in Backwork's (unknown departments and professors are auto-created) moved to field help beside the two fields it is about |
| both | The submit's `!file` disable | `1j`: "Upload stays enabled". Replaced by an inline error on the field. The **subscription** gate still disables it — that is a verdict about the chapter, not about the form |
| both | `Badge` rows and the third text line per row | Backwork's tags moved inline into the meta line; Documents' description did the same |

- [x] Narration paragraphs deleted on both routes, not restyled
- [x] Wrapper cards deleted; both pages sit on `--background` with flush lists
- [x] Upload dialogs on the `1j` sheet: r20, 18/700 title, 44px fields, inline errors on touched
      fields, Upload enabled, the well collapsing to a file row
- [x] `--gold-ask-*` untouched and still not merged into `--accent-*`. This lane's one accent use is
      the file row's icon tile, which is `--accent-subtle` / `--accent-text` and retints per chapter
      as product UI should
- [x] No em dash left in user-facing copy on either route, verified by stripping comments and
      grepping what remains. **Six sites, not the "three" an earlier draft of this line claimed** —
      that count was wrong in both directions, and is corrected rather than quietly dropped:
      Documents' narration paragraph, Documents' `DialogDescription`, Documents' folder-reorder
      toast (pre-existing, fixed here because this lane owns the route), and the three
      `SelectValue placeholder="—"` on Backwork, now the board's own unset wording ("Pick one")
      and previously announced by a screen reader as nothing at all. Backwork's narration
      paragraph, which the old line counted, contained no em dash
- [x] 375px floor held on both routes under `tests/visual/responsive-floor.spec.ts`, **with the
      caveat that suite states about itself**: it runs with no session and no active chapter, so
      `/documents` renders its loading state and `/backwork` its no-chapter state. It proves the
      shell, the page header and the folder rail do not overflow at 375px. It does **not** exercise
      a populated document row, a populated backwork row or the three-column filter grid, which
      are layouts this lane changed. The **upload sheet** was measured separately at 375
      (`documentElement.scrollWidth === clientWidth === 375`, fields stacking to one column and the
      footer holding one row) and read at 1280. The populated rows are the real gap: a case for
      them needs a seeded session, which this lane does not add — so they are reviewed on the diff
      and by the row-level unit cases, not proven at 375

### What this lane did NOT do, deliberately

| Left | Why |
| ---- | --- |
| `#2129` signed-URL, wire-name and storage work | Out of scope by the issue. Every `handleUpload` still owns its own request; the sheet is chrome |
| Drag-and-drop on the file well | The board calls it a "drop zone", but a drop handler is behavior, not chrome. What ships is the well and its file row. Styling a target that silently ignores a drop would be the worse half of the board to take |
| The `/documents` folder dialog | `1j` is the **upload** sheet. The folder dialog genuinely has a description (renaming re-files every document under that name), so it is a plain dialog rather than a sheet with its paragraph deleted |
| Folding `CHAT_CONTROL_CLASS` into `denseRowControlClassName` | They are the same 32/44 recipe in two files. Merging means editing a chat module, which belongs to whichever lane next touches chat. Both sites now name each other so a grep finds the pair |
| An `error` slot on the sheet's plain field | `1j` draws "Semester is required" under a metadata field, so the grammar is specified — but no metadata field on either screen can produce it: both state that every field except the file is optional. The prop, and the `aria-invalid`/`aria-describedby` helper that has to go with it, were written first and had **zero** callers, exercised only by their own test. Removed. The lane that adds the first required metadata field adds the recipe back against a field that uses it |
| `nested-states.tsx`'s own framing | The four nested states still draw their own bordered block, which on a now-flat page reads as a small card. They are shared across every route, so re-pitching them is a change to that family and not to these two screens |


## 9. Directory: actives and alumni — lane 5

Written as the lane landed, in the same shape as §8, and for the same reason: the board draws
**no Directory page body**. `4a` is the *chat* members column, not this route. So the page grammar
is **derived** — from `1f` pin 2 (one toolbar row, no wrapper card, no description paragraph),
`1t`'s Events row read one route over ("header card, description, filter card, table card, … card
title, checkbox column — gone"), `4d`/`4e`'s table rule (top-border dividers, no zebra, no per-row
fill) and `3b`'s state rule. That derivation is the part a later lane is most likely to revisit,
which is why it is stated rather than left in the diff.

This lane is **Directory only**. Finance/Billing and Admin/settings are the other two thirds of
[#2146](https://github.com/pdcarlson/Frapp/issues/2146) and are not touched here.

### Where the row geometry comes from, and why it is not lane 4's

`4a` draws the only member row in the file: **34px, r8, 24px avatar, 10px gap**, name on one
truncating line. `4d`'s 40px row is a plan matrix, not a member. 34 is not a Tailwind step and
`min-h-9` (36) is the adjacent one, so a member row is `min-h-9` with `pointer-coarse:min-h-11`.

That is deliberately **not** lane 4's flat `min-h-11` document row, and the difference is not an
oversight in either direction:

| | `/documents`, `/backwork` | `/members` |
| --- | --- | --- |
| Row is itself a control | No — the row is text plus trailing buttons | **Yes** — the row opens the member |
| Lines | Two | One |
| Height | `min-h-11` flat (44) | `min-h-9` + `pointer-coarse:min-h-11` (36 / 44) |

§2's floor is about **touch targets**, and its own carve-out reads "compact 34px controls are
web/pointer-only". `pointer-coarse` is that carve-out expressed in CSS — the mechanism
`denseRowControlClassName`, `dashboardCheckboxHitAreaClassName` and lane 4's own folder rail already
use. A mouse gets the board's density; a finger gets the full 44.

### What was deleted

| File | What went | Note |
| ---- | --------- | ---- |
| `members-directory.tsx` | Three `<Card>`s — the filter card, the bulk-actions card, the results card | With four `CardTitle`/`CardDescription` blocks between them. "Members Directory" and "Member Records" both named a list the reader was looking at |
| `members-directory.tsx` | The narration paragraph "Search and review chapter membership records." | Board: page-narration paragraphs, removed outright |
| `members-directory.tsx` | The whole `<Table>` — header row, six columns, four `SortableHead` buttons | Replaced by a flush `<ul>`. The shared `Table` primitive is now unused on this route, as it is on lane 4's two |
| `members-directory.tsx` | The checkbox **column** (`<th>`, the `w-12` cell) | `1t`, Events row. The capability survives: the checkbox is the row's leading element, and the select-all keeps a header of its own above the list — see the acceptance item below for why it is **not** in the selection bar |
| `members-directory.tsx` | The table/card **view toggle** and the entire card-grid view | See "What this lane did NOT do" for why this one is a deletion rather than a restyle |
| `members-directory.tsx` | The trailing "View details" Secondary button on every row | The row is the control (`4a`: "Click a row → profile popover"). A 44px button inside a 36px row sets the row's height on its own |
| `members-directory.tsx` | Four sortable column headers | One sort `<select>` in the toolbar row, carrying all eight (key, direction) pairs |
| `alumni-directory.tsx` | N + 2 `<Card>`s — a no-chapter guard card, a filter card, and **one card per alumnus** | The per-alumnus cards are rows in the same list the actives half renders |
| `alumni-directory.tsx` | The narration paragraph, and the "ALUMNI" badge on every row | A per-row tag reading ALUMNI on every row of the list the Alumni tab opens states one fact three times |
| `directory-glyphs.tsx` | `AlumniGlyph` | Sole consumer was that badge. `iconography.md` §6.2.3 moved in the same change, per its own §6.3 |
| `presence-dot.tsx` | The `decorative` prop and the self-naming `role="img"` branch | Same condition as `AlumniGlyph`, and it would have been easy to miss: the labelled variant existed for the table cell and the card tile, both deleted here, so the one surviving caller — a row that *is* a button — passes `decorative` and spells the status into its own `aria-label`. Left in place it would have been a second accessibility contract with no call site and no test |
| `member-detail-sheet.tsx` | `SheetDescription`, and the route's one `window.confirm` | `1t`: "All `window.confirm` → r20 dialog — replaced". It was the worst-placed of them: a native OS prompt over a Radix sheet |
| `invite-member-dialog.tsx` | `DialogDescription`, and the error banner's second sentence | `1j`: "no instructional paragraph" |
| `state-microcopy.ts` | `members.preview*` | Both keys had lost their readers when the preview fallback went; the error string that named the concept went with them |

- [x] Wrapper cards deleted on both halves; both sit on `--background` with flush lists
- [x] Narration paragraphs deleted, not restyled, on both halves and in both overlays
- [x] Rows at the board's member geometry: `min-h-9` / `pointer-coarse:min-h-11`, 24px avatar,
      `·`-joined meta line, bounded fields before the free-text one
- [x] `divide-y divide-border border-t border-border` — and **extracted**. Lane 4 spelled it twice;
      this lane would have been copies three and four, so it now lives on `denseListClassName` in
      `components/shared/table-controls.ts` and all four lists import it. The **row** recipe is
      deliberately not extracted — see the table above for why the two rows are different objects
- [x] FITFO empties: one state became three (empty / filtered / searched), per `3b`'s
      "Empty = … No results = neutral tile, names the query" and its six-word status budget.
      `writing.md` §7's Members and Alumni tables moved in the same change, as
      [`README.md`](README.md) §2's scope note requires
- [x] `--gold-ask-*` untouched and still not merged into `--accent-*`. This lane's accent uses are
      the row hover (`accent-subtle`), the selected row (`accent-subtle-hover` + `accent-text`) and
      the selection bar, all of which retint per chapter as product UI should. Its only consumer,
      `ask-pill.tsx`, is not in the diff, so L-05 does not fire
- [x] Whole-screen `EmptyState`/`ErrorState`/`LoadingState`/`OfflineState` swapped for the
      **nested** family with `sole`, on both halves. Not a technicality: the whole-screen variants
      paint `--card`, so a route that had just deleted three `<Card>`s would have gone on drawing one
      on every empty, error, loading and offline path. `elevation-contrast.spec.ts` argues the same
      side from the other end, and its docblock names that assertion as "the one that should fail if
      someone restores the Card for consistency". Lane 4 moved `/documents` and `/backwork` across
      for this reason. The one exception is alumni's **no-chapter** branch, which keeps the
      whole-screen variant because it genuinely replaces a page rather than a list — the same
      exception `backwork-page.tsx` already carries
- [x] `<MemberDetailSheet>` renders inside the success branch, where every other `useConfirmDialog`
      caller renders its dialog. **Recorded because an earlier draft of this lane did the opposite
      and was wrong**: it hoisted the sheet out of the state branches to stop
      `await confirm(...)` hanging when a background refetch unmounted its host mid-confirmation.
      That hazard does not exist here — `ConfirmDialogHost` carries
      `useEffect(() => () => onSettle(null))` for exactly this, and
      `confirm-dialog.spec.tsx`'s "resolves null when the caller stops rendering the dialog" pins it
      against the early-return shape by name. The hoist also cost something real: a sheet that
      outlives its own query looks up `activeMember` in a `sortedMembers` that is empty in precisely
      those branches, so it rendered an unknown member with its roles cleared and a Save that
      silently no-opped. A primitive that already solves a problem is the first thing to check
      before restructuring a caller around it.

      The state branches themselves are **unchanged** — scoping them to the list region the way
      lane 4 does would leave the search input mounted while offline, which rewrites the recorded
      reason ([#1621](https://github.com/pdcarlson/Frapp/issues/1621)) that this screen's Retry
      clears the search term, and that is a resilience change rather than a chrome one
- [x] The select-all sits in the list header, rendered whenever there are rows (so not on the
      empty, loading, error or offline paths, where it would have nothing to select), and **not**
      in the selection bar. Also a
      corrected draft: inside the bar it was a control conditioned on its own output — unreachable
      until a row had been ticked individually, and self-destroying when used, since unticking it
      empties the selection and unmounts the bar around the checkbox holding focus, dropping a
      keyboard user to `<body>`. The header is what the deleted `<th>` was, minus the column labels
      and the four sort buttons a flush list has no room for
- [x] Rows stack rather than hide below `sm`. A draft put the meta line behind `hidden sm:block`,
      which at the 375px floor this repo measures put the role, join date and email in **no** form
      at all: `display:none` removes text from the accessibility tree too, so on the actives half
      the row's `aria-label` was the only survivor, and on the alumni half — a deliberately
      non-interactive row with no `aria-label` and no detail surface — class year, company and city
      existed nowhere in the product on a phone. Lane 4's document row already stacks
      (`flex-col … sm:flex-row`); both rows here now do the same. The alumni **bio** also left the
      `·` join for a line of its own: lane 4's "free text last" rule assumes the free-text field
      trails one short date and a folder name, and with three fields ahead of it in half a row an
      ellipsis took the bio entirely, at every width, with no detail surface to recover it from
- [x] No em dash left in rendered copy on this route. **Four sites, one defect, two different
      fixes** — `"—"` standing in for a value that is absent. In a row's meta line (an unparseable
      join date, a member with no role) nothing replaces it: the line is a `·`-joined list of the
      facts that exist, so an absent fact is absent from the line. In the detail sheet's field tiles
      (an unset custom field, a member with no points) the tile is a *label over a value*, so
      dropping the value would leave a label naming nothing — those say `Not set` and
      `Not recorded`. A lone glyph is in both cases a character a screen reader has to announce
      standing in for nothing at all. The fifth occurrence, `"Directory — Signet"` in the route's
      `metadata.title`, is **left**: every dashboard route spells its browser-tab title that way,
      lane 4 touched two of them and left both, and changing one of many is a worse state than
      changing none

- [x] 375px floor held on `/members` under `tests/visual/responsive-floor.spec.ts`, and **it covers
      more here than §8's equivalent claim does** — an earlier draft of this line said the opposite
      and was wrong in a way worth recording, because the mistake is the one
      [`../design-system/README.md`](../design-system/README.md) §4 names by name. That draft
      reasoned that a sessionless harness renders the *loading* state, so neither the populated row
      nor the toolbar row is measured. But `useMembers`, `useRoles` and `useLeaderboard` are all
      `enabled: !!chapterId`, and **a disabled query is not a loading state**: under TanStack v5
      `isLoading` is `isPending && isFetching`, which is false when `fetchStatus` is `idle`. So
      `/members` falls past every guard and renders the **toolbar row plus the `No actives yet`
      empty state** — which is exactly what the `Invite` assertion in
      `members-directory.spec.tsx` pins, and what the Invite row under "What this lane did NOT do"
      below says ("It still renders above every empty state"). §8's claim about `/documents` is true
      for a reason that does not transfer: `useDocuments` has no `enabled` gate at all.

      What the gate therefore proves: the shell, the tab row, the page header, the toolbar row —
      its four wrapping `<select>`s, the search field and the Invite button — and the empty state
      all hold 375px. What it still does **not** exercise is a **populated row**, which needs a
      seeded session (the work §8 already scopes). The rows are structurally safe by construction:
      the meta line stacks rather than hiding below `sm`, and every flex child carries `min-w-0` or
      `shrink-0`. One pre-existing property is worth naming since the toolbar is now measured: a
      native `<select>`'s intrinsic width is its longest `<option>`, so a chapter with a very long
      role name widens `Role: …` without bound. That is unchanged from the surface this replaces

### What this lane did NOT do, deliberately

| Left | Why |
| ---- | --- |
| Invite in `PageHeader`'s `actions`, where lane 4 put Upload | `1f` pin 2 does put the primary action in the page toolbar row, and lane 4 obeyed it — behind `<Can permission="chapter_docs:upload">`. This route has no `<Can>` (next row), so an unguarded trigger in `PageHeader` mounts `InviteMemberDialog` on **every** path and on the **Alumni** tab, firing `useInvites` (`GET /v1/invites`, gated on `members:invite`) for every visitor — the guaranteed-403-per-visit shape `member-detail-sheet.tsx` already guards `useCustomRoles` against. It sits at the trailing edge of the actives list's own toolbar row instead: same row grammar, mounts exactly when it mounts today, and it is the honest home anyway, since the alumni tab has no invite. It still renders above every empty state, which is what lets those states carry no CTA |
| A `<Can>` gate on the invite trigger, the bulk-assign controls or the row checkboxes | The route has **no** `<Can>` anywhere today; the only client mirror of `members:view` is the nav entry. Adding a permission read changes what a member sees, which is behavior, not chrome. It is a real divergence from [`../design-system/README.md`](../design-system/README.md) §5 rule 4 — **not** `components.md` §5, which is Badges and chips — and is filed as [#2170](https://github.com/pdcarlson/Frapp/issues/2170), which also carries the guaranteed-403 `useInvites` call the Invite row above only narrows |
| The underline tab row → the board's segmented toggle | The board draws **no** horizontal tab bar (`grep -c 'border-bottom:2px'` returns 0). Its two tab shapes are `4d`'s left rail, for a settings page with six sections, and `1f`'s Calendar/List *view toggle*, which switches two renderings of one dataset. Actives and alumni are two datasets behind two queries, so neither frame is about this control — and where the board is silent, `components.md` §6 is explicit ("underline style only — no segmented pill controls") and the primitives slice already deleted a segmented rail here. Re-adding it would reverse that on the strength of a frame that is not about it |
| Deleting the page's own search field, as lane 3 deleted the channel list's | `1b` pin 5 and `1a` pin 9 delete *per-column* search in favour of the top bar's find. The find bar navigates to `/members`; it does not narrow it, and this input is wired to `GET /v1/members/search`, a **server-side** search over the whole roster. Deleting it moves a capability. `/documents` and `/backwork` kept theirs for the same reason |
| An alumni detail sheet | Alumni rows were a dead end before this lane and still are. There is no alumni detail surface in `apps/web` for a row to open, and adding one is a capability |
| Folding `CHAT_CONTROL_CLASS` into `denseRowControlClassName` | Unchanged from §8: still the same string in two files, still a chat edit |
| Finance/Billing and Admin/settings | The other two thirds of #2146, and separate PRs by the issue's own "can split PRs" |

**The card-grid view is a deletion, not a restyle, and that is the one judgement call here.** Three
reasons, in order of weight. Its tile is a `rounded-lg border` box per member — the wrapper card
this lane removes everywhere else, so "restyling" it means deleting its card and then it is a worse
list. It shows strictly *less* than the row (no email, no actions, no checkbox), and its missing
checkbox was a live defect: selection was unreachable in card view while the bulk bar still rendered
above it. And its whole content is restated in a hand-maintained `aria-label` that has to be kept in
sync with the tile by hand. It is chrome — a second rendering of one list, not a route, a
permission or a data contract — so it is inside this checklist's scope, but it is the item most
worth a second opinion.

---

## What this checklist does not cover

Deleting a **route** or a **capability** is a behavior change, not chrome, and belongs to
[`../../behavior/`](../../behavior/README.md) with its own issue. Nothing on this list removes a
route, a permission, or a data contract. If a lane finds itself doing that, it has left the
greenfield's scope.
