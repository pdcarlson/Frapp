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

~~Most of these already hold; the shadow one does not. The greenfield must not reintroduce any of
them, and must close the one that is open.~~

**All six hold, as of lane 7.** The shadow row was the one open defect when this section was written
and lane 3 closed it; the other five were unticked because nobody had run the pass, not because they
were known to fail. Lane 7 ran it. The greenfield must not reintroduce any of them, and the evidence
for each is below the list rather than left implied.

- [x] No `next-themes`, no theme switcher, no light palette. Signet web is dark-only
- [x] No live `dark:` variants
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
- [x] No legacy bone / bronze / Geist token on this surface
- [x] No unused component left under `apps/web/components/ui`
- [x] No customer-facing "Frapp" string or wordmark

**The five rows above were ticked by lane 7, and how matters more than that they are ticked.** They
had stood unticked with no lane recorded against them since this section was written, which reads as
"nobody checked" rather than "checked and clean" — and this file's own §7 preamble says the greenfield
"must not reintroduce any of them". Lane 7 is the last lane, so it ran the pass. Every command, so a
reader can re-run it rather than trust the box:

| Ban | Command | Result |
| --- | ------- | ------ |
| `next-themes` / switcher / light palette | `grep -rn next-themes --include=package.json .` · `grep -rn "prefers-color-scheme\|data-theme" packages/theme/src/signet.css apps/web/app/globals.css` | Not a dependency in any workspace. The only mentions in `apps/web` are three comments recording its #920 deletion. `signet.css` has one `:root`, no `prefers-color-scheme`, no `[data-theme]` |
| Live `dark:` variants | `grep -rnoE '(class\|className)="[^"]*\bdark:[a-z-]+' apps/web/components apps/web/app --include=*.tsx` | No matches |
| Legacy bone / bronze / Geist | `grep -rniE "\bbone\b\|\bbronze\b\|Geist" apps/web/components apps/web/app --include=*.tsx --include=*.ts --include=*.css` | No matches outside comments |
| Unused `components/ui` | per-file: does anything outside the file itself import `components/ui/<name>` | Every file has at least one importer |
| Customer-facing "Frapp" | `grep -rn Frapp apps/web/app apps/web/components --include=*.tsx` | **24 hits, none rendered.** Classified: code identifiers (`FrappProvider`, `useFrappUser`, and the `@/lib/providers/frapp-client-provider` specifier), which §2's naming row explicitly exempts; docstrings recording the #920 rename; and two `github.com/pdcarlson/Frapp/issues/...` URLs inside JSX comment blocks. No rendered string, no wordmark |

Three honesty notes rather than a clean claim.

The `components/ui` sweep matches the import **path string**, so a component reached only through a
re-export or a dynamic specifier would read as used; it is the same shape of proof lane 3 used for
`shadow-*` and carries the same limit.

**The "Frapp" row was wrong in this file's first draft, and the review caught it.** It read "Only
`FrappProvider` and `useFrappUser`" — a count taken from a `head -5` of a 24-line result, written up
as though it were the whole result. The conclusion survives re-checking and the row above now states
the real number and the classification behind it, but the original is the exact defect
[`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md) names: a
rewrite stating more than the evidence verified. A truncated grep is not a sweep.

And ticking a box records that the ban held **on the date this lane ran**, which is what a checklist
can assert — none of these five has a CI check behind it, so a later reintroduction would not be
caught by anything but the next reader. The one exception is now the title lock,
`scripts/ci/__tests__/signet-web-titles.test.mjs`, which lane 7 re-specified and which does gate the
"Frapp" half for `apps/web/app/layout.tsx` in CI.

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

## 10. Finance: Billing and Subscription — lane 5

Written as the lane landed, in the same shape as §8 and §9. Unlike those two, **the board does draw
this page**: `4d` is Chapter settings → Subscription, and `4b` is the PRO marker it reuses. So the
grammar here is taken rather than derived, and what needs stating is the two places the board
describes a product this codebase does not have.

This lane is **Finance/Billing only**. Directory landed in the PR before it; Admin/settings is the
last third of [#2146](https://github.com/pdcarlson/Frapp/issues/2146).

### The board draws a two-tier product, and there is one tier

`4d` is a **Starter** chapter at "$3 per member / month · 42 members · renews Jan 5, 2027", paying by
"Visa ····4242", with "Next charge $126.00" and an **Upgrade to Pro** primary. Measured against the
contract, all of that is unavailable and most of it is unbuildable:

| `4d` field | Source in this codebase |
| ---------- | ----------------------- |
| Plan tier (Starter vs Pro) | **None.** `MODULE_CATALOG` splits modules `tier: "free"` / `tier: "paid"`; a chapter holds the one subscription or does not |
| Price, seats, next charge | **None.** No endpoint returns a price, a seat count or an upcoming invoice |
| Renewal date | **None** |
| Payment method brand and last4 | **None.** `IBillingProvider` has no method that reads a subscription back from Stripe |
| Status | `chapters.subscription_status` — `incomplete` \| `active` \| `past_due` \| `canceled` |
| Lapse date | `chapters.past_due_since` |
| Customer / subscription id | `GET /v1/billing/status`, gated on `billing:view` |

Two rules follow, and they are the lane's main judgement call:

- **Omit, never placeholder.** The five missing fields are not rendered at all. A meta row reading
  "Next charge —" claims we know there is one, which is the confidently-wrong signal §7 bans one
  surface over. Wiring them is an `IBillingProvider` change and a behavior issue, not a chrome lane.
  **This rule was broken once inside this lane and is recorded rather than quietly fixed**: the
  panel's `<h2>` — `4d`'s slot for the chapter's *current* plan — hardcoded the literal "Pro", so a
  chapter that had never completed checkout read "Pro · Incomplete" above a matrix telling it every
  paid module was locked. A hardcoded name is a placeholder that does not even degrade. The slot
  now derives from `subscription_status`, which answers the question the panel actually needs:
  `active`/`past_due` hold the subscription ("Pro"), `incomplete`/`canceled` hold nothing ("No
  subscription" rather than "Free", because `subscriptionWriteState` returns `CANCELED` ahead of
  its free-tier check, so a canceled chapter is read-only even for writes a never-subscribed one
  could make), and `null` names the section rather than asserting a plan the chip is refusing to
  assert.
- **Sell nothing that cannot be bought.** There is no "Upgrade to Pro" button, because there is no
  Pro to upgrade *to* from a Starter that does not exist. The panel's primary action is the recovery
  for the status the chapter is actually in, which is #929's split: `past_due` → Portal,
  `canceled` → checkout, `incomplete` → checkout, `active` → the Portal as a secondary.

The plan matrix keeps `4d`'s **shape** — two columns, "what you have now" and "what the paid tier
adds" — and fills it from `MODULE_CATALOG`, which is what `4d` note 3 asks for ("rows read from the
module catalog"). Its grouping follows the board's own rule: rows that share a verdict are grouped
(`4d` puts "Events, Tasks, Points, Polls" on one line) and each paid module gets its own, because
each is a distinct thing the chapter is being sold.

**`tier === "paid"` is not the row filter, and the first cut of this lane used it.** The catalog is
the master plan's, not a manifest of what is built: twenty entries are `tier: "paid"` and seven of
them (`academics`, `philanthropy`, `risk`, `lines`, `networking`, `standards`, `serviceFirst`) have
no controller, no route, no nav row and no `@RequireModule` anywhere in the repo. Under a heading
reading "What the subscription unlocks", with a `--success` dot and the word "Included", each was a
promise of a capability that does not exist — the same invention this lane refused one block up
when it omitted `4d`'s price and seat count rather than placeholder them. The filter is now "does a
member have somewhere to go", derived from `nav-config.ts`'s `module` keys, plus `dues` (its
surface is this page's own invoice list) and never `billing` (`BillingController` is class-level
`@SubscriptionExempt()`, so a "Billing — not included in Free" row would tell an `incomplete`
president that the page they are standing on is locked behind the purchase they are making from
it). Nine rows, not twenty. Pinned in `plan-matrix.spec.tsx` against the catalog and the nav, so
both transcribing the board's rows back in and re-widening the filter are test failures rather than
review catches.

### The two invoice lists were one list

The route rendered the same `useInvoices()` rows **twice** to anyone holding `billing:manage`: a
"Member Invoices" card with a checkbox table, search, three count badges, CSV export and Pay, and
directly beneath it `InvoiceAdminCard` with a second list of the same rows, its own status filter,
overdue badges and the DRAFT/OPEN/VOID transitions. `GET /v1/invoices` returns the whole chapter to
a `billing:view` holder and only the caller's own rows to everyone else, so the two were never
showing different data — the two cards were the only thing making them look like two subjects.

Flattening them does not resolve that, it exposes it: two bare identical lists stacked on one page
is worse than what shipped. **So the flatten forces the merge**, and it is recorded here rather than
left in the diff because it is the largest thing in the lane. Nothing is gated differently than it
was: the officer half is still `billing:manage`, the member half is still open to anyone who can
reach the route.

One thing the merge could have broken quietly, and did not: `useMembers` (`GET /v1/members`, gated on
`members:view`) used to fire only because `InvoiceAdminCard` mounted inside
`<Can permission="billing:manage">`. Hoisting the list out of that wrapper would have fired a
guaranteed 403 for every member on every visit, so the query is `enabled` on the same
`can("billing:manage", …)` the officer column reads — the idiom `chat/renderers/event-card.tsx`
already uses for the attendance roster.

### What was deleted

| File | What went | Note |
| ---- | --------- | ---- |
| `app/(dashboard)/billing/page.tsx` | The whole client body | Now a ten-line server shim with `metadata`, as lane 4's `/documents` and lane 5's `/members` already are |
| — | The "Subscription Status" card and its three bordered id boxes | Plan status now lives in the `4d` panel. The boxes rendered "—" three times for every member, who cannot read `GET /v1/billing/status` at all |
| — | `CardTitle`/`CardDescription`: "Monitor chapter billing health and member invoice progress.", "Track dues collection and overdue balances.", "Track chapter dues across every member. Stripe webhooks move invoices to PAID automatically." | Page-narration paragraphs, removed outright |
| — | The `CardFooter`: "Stripe webhooks handle automatic PAID transitions. Manual Paid / Void buttons exist for corrections and cash-paid dues." | Narration explaining the UI to itself. The buttons say what they do |
| — | The preview-data warning card, and `stateMicrocopy.billing.previewTitle` / `previewDescription` with it | "Showing preview billing data / Sign in to load live chapter subscription and invoice records" fired on `statusQuery.isError`, which for most members is the ordinary 403 — telling a signed-in member to sign in. Each read now degrades where it is. `writing.md` §6 and its Billing table moved in the same change, per [`README.md`](README.md) §2's scope note |
| `subscription-checkout-card.tsx` | Deleted; absorbed into `plan-panel.tsx` | Every behaviour kept and re-pinned: the #860 bounded poll and its 10 × 3s budget, the #929 status→action split, the stale-`?checkout=success` guard, the fail-open on an unresolved status, and the deliberate absence of a checkout button on the timed-out branch |
| `invoice-admin-card.tsx` | Deleted; absorbed into `invoice-list.tsx` | See above. The #707 overdue derivation and the #1621 two-threshold split came across intact |
| — | The three `Open: n` / `Overdue: n` / `Paid: n` `Badge` pills | The last badge row on the page, and §8 deleted that shape one family over. Every number survives in the count line `/members` uses for "42 alumni" |
| — | Two destructive overdue **cards** (`CardHeader` + `CardTitle` + `CardDescription` each, for one sentence each) | One line each now, on the page surface with the hairline `components.md` §2 makes the load-bearing edge |
| — | The `<Table>` with its six `<TableHead>`s | `1t` one route over: "table card, … card title, checkbox column — gone". The checkbox stays, because CSV export is selection-driven and #336 made that real; it is a row control now rather than a column |
| — | The Radix `Select` filter | One native `<select>` on `dashboardFilterSelectClassName`, which is the flattened routes' filter control. The page already had one; the card had the other |

### Acceptance

- [x] Route flush on the shell: no wrapper `<Card>` anywhere, page body on `--background`,
      `PageHeader` on **every** path including offline
- [x] Plan status is on this page, in the `4d` panel — not a sidebar subscription card. Lane 2
      already deleted the nav's ("no account menu in the nav, no subscription card, no BETA row",
      `dashboard-shell.tsx`), so this is the other half of that removal landing
- [x] The `4d` plan panel takes the board's own `--surface-1` / radius 16 / hairline rather than
      `<Card>`, which paints `--card` one rung up the ladder. **It is not the page's only framed
      block**, and an earlier draft of this line said it was: the plan matrix beneath it is framed
      too (radius 14 + hairline), which is exactly what `4d` draws at its own `:250`, and `4d`
      draws a third frame on the "Who can see this page" row this lane leaves to Admin. The real
      distinction is that no frame here is a `<Card>`: what the lane deleted is the `--card` fill,
      not the hairline
- [x] PRO chips at `4b`'s geometry — 18px, r5, 10.5/700, tracked 0.04em, outline with no fill — in
      their own module, not five overrides on `Badge` (28/8/12.5, filled)
- [x] Past-due: the chip swaps to destructive and **one line** appears at the top of this page and
      nowhere else (`4d` note 4). It keys on `subscriptionStatusKind(status) === "destructive"`,
      which is the existing definition of the lapsed states, so it also fires for `canceled` — a
      generalisation of a note written against a two-state board, not a departure from it.
      `incomplete` is `warning` and gets no banner; an unresolved status gets nothing at all
- [x] Members without billing rights get `4b`'s "Ask an officer", naming the action their chapter's
      status actually needs. It replaces "A chapter officer with `billing:manage` can complete
      checkout and unlock these features" — a permission key quoted at the one person who cannot act
      on it. **Only `deniedFallback` carries it**, and an earlier cut of this line said the
      opposite: it claimed all three non-granted `<Can>` branches render it, by analogy with
      `subscription-gate.tsx`'s `DefaultRecovery` ("naming someone who can fix it beats naming
      nobody"). That analogy is about a *notice*, whose job is to name a recovery; this slot is the
      action itself, and `can.tsx` documents the three branches as three different facts. Passing
      the copy to `fallback` told a treasurer holding `billing:manage` to ask an officer for the
      length of their own permission fetch, and passing it to `offlineFallback` said it permanently,
      with no Retry. `fallback` is back to `null` and `offlineFallback` to the gate's own §10
      control-slot state. **And `active` passes no copy at all**: `4b` writes "Ask an officer" for a
      *locked* row, and on a healthy chapter nothing is blocked, so an officer without
      `billing:manage` gets the plan and its status and no invented errand
- [x] Stripe stays **blocking** and nothing is optimistic. Both actions `await mutateAsync`, disable
      their own button for the duration and hand off with `window.location.assign`. Neither moves
      the status chip; the chip reports the chapter record and nothing else, which is what the #860
      poll exists to preserve
- [x] `--gold-ask-*` untouched and still not merged into `--accent-*`. This lane's accent uses are
      the PRO chip's border and text, the selection bar and the selected row — all product UI, all
      retinting per chapter as they should. The board's PRO chip reads as fixed gold only because
      its demo tenant is the house tenant, which is the trap [`tokens.md`](tokens.md) § L-01 names;
      taking `--gold-ask-*` for it would have frozen it gold on every chapter and spent Ask's tokens
      on something that is not Ask. `ask-pill.tsx` is not in the diff, so L-05 does not fire
- [x] PRO takes the accent **because it is not a status**. `status-contrast.spec.ts` measures that
      an accent badge is indistinguishable from a status badge under a green- or red-accented
      chapter, and `writing.md` §5 bans status colour used decoratively. PRO states an entitlement;
      the verdict column beside it is the semantic `--success` dot
- [x] Whole-screen `OfflineState`/`LoadingState` swapped for the **nested** family with `sole`, the
      same swap §9 made and for the same reason: the whole-screen variants paint `--card`
- [x] Every verdict cell in the matrix names its own column in its visually hidden text
      ("Not included in Free"), because `4d` draws this block with no table semantics and a linear
      read of "Events · Pro · Not included · Included" parses most naturally as the inverse of the
      fact. An earlier draft asserted in a comment that the header carried `role="row"` semantics;
      it did not, and that false claim is what left the cells announcing a bare "Included"
- [x] The matrix's "not included" dash is `--muted-foreground` (7.47:1 on `--background`), not
      `--disabled` (**2.45:1**, under §6's 4.5:1 release gate). WCAG's inactive-control exemption
      does not cover it: the dash is informational content, not a disabled control
- [x] Two live regions on the route, not four. The lapse banner and the overdue summary are durable
      page content rather than announcements of a change, so neither is `role="status"`; what keeps
      it is the loading state and `SubscriptionNotice`, which are about transitions
- [x] The select-all checkbox takes its name from its visible label. It kept an
      `aria-label="Select all visible invoices"` from the table header cell it replaces — which had
      no visible text — so once the flatten put "Select all shown" beside it the accessible name no
      longer contained the visible words (WCAG 2.5.3, and a dropped voice command)
- [x] No em dash in user-facing copy on this route, verified by stripping comments and grepping what
      remains. ~~**Two characters survive and neither is prose**~~ — **this claim was wrong, and lane
      7's sweep is what caught it.** A third survives and it *is* prose:
      `components/billing/pay-invoice-dialog.tsx:214`'s "Payment complete — this invoice is now
      marked paid.", rendered on `/billing` through `invoice-list.tsx`. `git log` shows that file was
      last touched by lane 1 and never by lane 5, so the sweep that produced this line did not reach
      the dialog. It is left in place — lane 7's copy scope is the routes no lane touched — and the
      record is corrected here rather than the sentence being quietly deleted, because a verification
      claim that was not performed is worse than an unfixed string. The two that **are** correctly
      described: the matrix's `–` for "not included",
      which is `aria-hidden` with the word "Not included" beside it and is the glyph `4d` itself
      draws, and `—` as the unknown-value placeholder in the overdue count, which is the
      convention the surface already used. One string was **rewritten** rather than passed over:
      "Payment received — activating your chapter" is now "Payment received, activating your
      chapter", pinned by a case that greps the rendered output
- [x] `writing.md`'s Billing table updated in the same change: the Preview/unauthenticated row and
      the Offline (permission check) row deleted with their strings, and **seven** new states added
      (offline, the plan panel's loading message, a failed billing-status read, the overdue read
      failure, the two lapse banners, and the "Ask an officer" family). §7's rule is that strings
      living inline at their surface component MUST still match these tables, so a new state with
      no row is the ad-hoc divergence §7 exists to prevent
- [x] 117 cases across six files, green, and each carried invariant names the issue it came from
      (#336/#1200, #707/#1196, #1621, #858/#1753, #860, #929, #1201). The count is kept current on
      purpose — §8 and §9's equivalent lines are what a later audit measures "did this lane's
      coverage survive" against, and a stale one reads a gain as unexplained cases

### What this lane did NOT do, deliberately

| Left | Why |
| ---- | --- |
| `4d`'s 200px Chapter settings rail | It is the Admin third of #2146. What is taken here is `4d`'s **page body**, on the route the product already has, with `PageHeader` supplying the title the rail would have. Whether `/billing` eventually redirects into a settings tab is that lane's call |
| `4d`'s "Who can see this page and manage billing" role-chip row | It is `4c`'s per-page settings pattern, and there is no per-page settings drawer on this surface to put it in. Building one is Admin |
| `4d`'s sub-line, "Billed to the chapter card. Members never see this page" | Narration, and **false here**: `/billing` is gated on `billing:view` and a member reaches it to pay their own invoice. That is precisely why `4b`'s "Ask an officer" has a job on this screen |
| `4b`'s PRO chips and locked-module sheet **in the nav** | The nav is lane 2's surface. This lane's brief is "this page only", and the chip module it adds is the one the nav lane will import |
| Seats, price, renewal, card and next charge | No data source, as above. An `IBillingProvider` change with its own issue, not a chrome lane |
| The shared `DefaultRecovery`'s "Reopen the subscription from the billing portal" | #929 established that the Portal cannot resume a terminated subscription, so that sentence names a dead end — and `subscription-gate.tsx` says it on every gated surface in the app. Fixed **on this route** (both branches point at the plan panel, whose canceled action is a fresh checkout) and left alone on the other fourteen, because changing the shared default is a copy change across chat, tasks, events and documents and does not belong in a Finance PR. Flagged on the PR |
| `PayInvoiceDialog` | Unchanged. It is a Stripe Elements sheet, not chrome, and `1j` is about the upload sheet |
| The Create invoice dialog's `DialogDescription` | §8 deleted the upload sheets' descriptions on `1j`'s "no instructional paragraph". This is the case §8 itself carved out for the folder dialog: a genuine description, because a draft invoice is invisible to the member until a second, separate action |
| A `<Can>` around the whole invoice surface | There never was one — the surface is visible to every member who can reach the route, and only the officer half was gated. The one `<Can>` left wraps the Create trigger, and it is there for its **default** `offlineFallback`: an officer whose permission read is paused with nothing cached gets §10's control-slot "Offline, can't check your access" in that slot instead of a list that has quietly lost four buttons. `can-fallback.spec.tsx`'s `SURFACE_GATES` ledger loses its `invoice-admin-card` row for the same reason, with the removal justified in that file rather than silently dropped |
| `4b`'s PRO chip on the page's own gated write buttons | `4b`'s third bullet says a button that hits a gated write "stays visible, disabled, and carries the same PRO chip", and this route has four of them (Create invoice, Send, Mark paid, Void). They are disabled with no chip, deliberately: `4b`'s chip means **"not in your plan"**, and that is not what blocks these. A `past_due` chapter *has* the plan and is behind on payment; a `canceled` one had it and ended it. Marking either "PRO" would state the wrong one of the two kinds of locked `4b` exists to keep distinct, and the surface already says the right thing through `SubscriptionNotice`. The chip belongs on a control gated by *entitlement*, which on this route is nothing and in the nav (`4b`'s own frame) is lane 2's |
| Folding `CHAT_CONTROL_CLASS` into `denseRowControlClassName` | Unchanged from §8 and §9: still the same string in two files, still a chat edit |

---

## 11. Admin: chapter settings, Roles, Study Zones, Reports — lane 5

The third of [#2146](https://github.com/pdcarlson/Frapp/issues/2146), and the one the board
actually draws: `4d` frames the settings page, `4e` draws the Roles tab in full, and `4c` draws the
per-page settings drawer. So unlike §8 and §9 this section derives little — but it departs from the
board in five places, and each departure is the product refusing to be what the board drew.

### The rail (`4d`)

`4d` pin 1 is the whole brief: *"Settings sub-nav · one page, left tabs, Danger zone pinned last.
Replaces the sidebar Roles row: Roles is a settings tab (also deep-linkable from the Admin group)."*

| Deleted | Why |
| ------- | --- |
| The page-narration paragraph, "Configure your organization identity, modules, branding, and chapter administration" | It restated the rail immediately under it. `1f` pin 2 gives a route's body one toolbar row with "no wrapper card, no description paragraph" |
| The **Beta** and **Audit** tabs | Both rendered `SettingsComingSoon` stubs naming "Chunk 08". Generated chrome advertising unbuilt work is the epic's own definition of what goes |
| `settings-coming-soon.tsx` | Its last consumer went with them |
| The 2px rail indicator | `4d` draws an active tab as a filled accent chip, not an edge rule |

The **Organization** tab held three unrelated jobs — chapter profile, semester rollover, and a
"Billing & danger zone" card — which is why it needed a sentence explaining itself. It is now
**Chapter**, **Semester** and **Danger zone**, three rail entries, as `4d` draws them. Rail geometry
is the board's: 200px (was `w-56`, 224px), 34px rows at radius 10, 2px gaps, Danger zone pinned by
`mt-auto` and drawn destructive.

**Two board tabs are deliberately not built.** This is `4d`'s equivalent of §10's "describes a
product this codebase does not have":

| Board tab | Why not |
| --------- | ------- |
| **Join code** | `apps/web` has no join-code surface at all — a repo-wide grep for `join_code`, `joinCode` and `invite_code` returns nothing outside the generated API SDK. Building one is capability, which the closing section of this document puts outside the greenfield |
| **Subscription** | `4d` puts plan status behind this rail and captions it "Members never see this page". §10 already refused that caption, because `/billing` is gated on `billing:view` and a member reaches it to pay their own invoice. Making it a tab would hide it from the members it is for. `/billing` stays a route, and Danger zone keeps the Stripe portal link |

**Two tabs the board does not draw are kept**: **Dues** and **Workflows**. Both are live chapter
configuration with no other home, slotted after Fields. The board draws a simplified chapter; its
rail is not an inventory of this product's settings.

### Roles (`4e`)

The board is emphatic that this is one surface — *"roles gate everything, so this is the one place
they're edited"* — and the code had it as **four sub-tabs behind a second tab bar**: Pack, Matrix,
Custom, Live roles. `?tab=roles` landed on **Pack**, a read-only list of archetype role names, so
the deep link `4d` pin 1 asks for arrived somewhere that could not do anything.

| Deleted | Replaced by |
| ------- | ----------- |
| `MatrixView`, the old capabilities × roles table | `roles-matrix.tsx`. The old one was **read-only**, and every pack-role cell rendered the literal string `n/a` because no client-side capability data exists for archetype roles. A grid that cannot be edited and cannot answer half its own cells is a diagram |
| `PackView`, the read-only archetype list | The pack name it existed to show, as the header's "role pack" label — where `4e` draws it |
| `roles-page.tsx`'s per-role permission checklist, in both the edit and create forms | The matrix. `4e` pin 2: "Click flips and saves" |
| The sub-tab bar itself | One flat tab |

`roles-page.tsx` is **not** deleted, and the distinction matters: it was never a duplicate of the
matrix. It is the role *lifecycle* — create, rename, recolour, reorder, delete, presidency transfer,
and the orphan-president claim banner — none of which `settings-roles-tab.tsx` reimplements. What it
lost is the permission editing the matrix took.

**Custom roles stay a section rather than matrix columns, and the board does not settle this.**
`4e` pin 1 says "Custom roles append as columns", but `4e`'s columns are the `roles` table and
custom roles are `chapter_custom_roles` — a different table, holding capabilities rather than
permissions, enforced through the bridge model in
[`../../behavior/rbac.md`](../../behavior/rbac.md). Appending them as columns would draw two
incompatible grant models in one grid and imply that a cell in the wrong one is editable.

**Two defects fixed rather than re-decided**, both found while reading the surface this lane
replaces:

- `handleSaveRole` PATCHed the whole `permissions` array from a draft captured when the role was
  selected. With a second editor now writing the same field, renaming a role after changing its
  permissions would have rolled those changes back. The key is now absent from the payload.
- The nav's Roles row is gated on `roles:manage`; the settings page's config read is gated on
  `chapter-config:view`. A member holding the first and not the second — freely constructible from
  the matrix itself — saw the row, clicked it, and landed on "Couldn't load chapter configuration".
  The Roles tab no longer sits inside that gate, which it never needed: the matrix reads `useRoles`
  and `usePermissionsCatalog`, neither of which is chapter config. Only the default-invite-role
  control degrades.

### The per-page settings drawer (`4c`)

Nothing like it existed. `page-settings-drawer.tsx` is the shared shell, in `layout/` because `4c`
pin 1 says "same gear, same drawer, on every page" — the second adopter must not draw its own 400px
panel.

**It is a right-side `Sheet` at 400px, not the board's in-layout rail.** `4c` pin 2 says the drawer
"takes the right slot like Ask and Notifications", and Notifications is already a right-side
`Sheet` (`dashboard-notification-drawer.tsx`) — so this is the same primitive at the board's width
rather than a second mechanism. Taking the rail literally would mean handing every settings-bearing
route the full-bleed contract (§ the lane-3 note in [`README.md`](README.md)) and rebuilding its
padding and scroll, which is a shell change and not a page one.

**Study Zones gets Access and nothing else.** `4c` pin 4 scopes the other two sections precisely:
"per-module knobs **the API already has** (check-in window, point value, announcement channel)".

| `4c` section | On Study Zones |
| ------------ | -------------- |
| **Access** | Built. The chips are the live `roles` rows holding each `geofences:*` permission, read from the same hooks `4e` edits, with `4c`'s own footer — "Roles are managed in Roles" — linking out. Rows derive from the catalog's namespace, so a permission added later needs no edit here |
| **Defaults** | **Not built.** A zone's numbers (`minutes_per_point`, `points_per_interval`, `min_session_minutes`, `pause_grace_minutes`) are columns on each zone, set per zone in its own forms. There is no chapter-level geofence config route to hang this on. Inventing one is capability; lifting the per-zone fields up would make four numbers that differ per polygon look like one chapter-wide setting |
| **Posts to chat** | **Not built.** Same reason: no announcement-channel setting exists for this module |

Both absences are pinned by a test, so a later lane adding a Defaults section has to delete the
test that says why there wasn't one.

### Study Zones and Reports, flush

`4d`'s rail supplies no page body for either, and the board draws neither route, so the grammar is
derived exactly as §8's and §9's were.

| Route | Deleted |
| ----- | ------- |
| `/geofences` | The narration paragraph, "Draw a polygon from GPS coordinates, set the reward rate, and members can start tracked study sessions when they're inside the zone" — which explained the page to the one member who had already proved they know what it is by holding `geofences:manage` and navigating here |
| `/reports` | The narration paragraph, and two wrapper cards. `1t` names this inventory exactly one route over: "header card, description, filter card, table card, card title". "Choose a report" named the control immediately under it; "Each report respects the same chapter + permission scoping as the rest of the dashboard" reassured the officer about something no other route stops to mention |

The Preview card's description is **kept**, moved onto the page surface: it reports the row count
actually returned and whether the export is partial. `1t` deletes a card's description *of itself*,
not a line of state.

### Left alone, deliberately

| Not done | Why |
| -------- | --- |
| `/study` | The Admin nav's "Study Zones" points at `/geofences`. `/study` is "Study hours" in the **Chapter** group — a member-facing surface for starting a tracked session, not an admin one. Out of this slice |
| The `/roles` redirect shim | Already a seven-line `redirect("/settings?tab=roles")` from #538, and `proxy.ts` still needs the prefix listed for auth to apply before the redirect runs. Deleting a route is a behavior change |
| Replacing `window.confirm` | **Already done.** There is not one live `window.confirm` call left in `apps/web`; every grep hit is a doc comment or a spec string, and every confirmation already routes through `useConfirmDialog`. The `4c`/`4e` brief's line item had no work in it |
| `/chat-admin` and `/discord-import` | Also in the Admin nav group, and neither is named by #2146's Admin slice ("Roles / Study Zones / Reports / chapter settings"). Two more routes is a second PR, not a wider one |
| Restyling the `Switch` primitive to `4c`'s 36×22 | A shared primitive used across every surface. Lane 2's, not a page lane's |
| A `?subtab=` param | The Roles tab has no sub-tabs left to address |
| Arrow-key navigation in the `4e` matrix | Every editable cell is a real `<button>`, so the matrix is keyboard-reachable and operable — but at 7 roles × 40 permissions that is ~280 Tab stops, and the WAI-ARIA **grid** pattern (roving `tabindex`, arrow keys, `role="gridcell"`) is what a data shape this size actually calls for. It is a self-contained follow-up on a surface this lane is otherwise done with, and the board says nothing about it. Filed as [#2173](https://github.com/pdcarlson/Frapp/issues/2173) rather than folded in |

---

## 12. Chapter accent, 404 and error polish — lane 7

The last lane, and the only one that **adds** a surface rather than flattening one. Recorded in the
same shape as the rest.

### The accent was already end to end. One thing was not, and three claims about it were false

The seed → semantic-token chain needed no repair: `deriveSignetPalette` emits thirteen roles,
`signetAccentSemanticVars` bridges the seven the stylesheet declares, and `useChapterTheme()` writes
exactly those seven onto `:root`. The declared accent slot and the applied set match 1:1, and
`--primary-pressed` / `--accent-subtle-hover` follow through `color-mix()` without being written.

- [x] **`::selection`**, which did not exist anywhere in the repo, so every surface fell through to
      the user agent's system blue. It is **neutral**, not accent-wired, and the first cut of it was
      the other way: review found `--primary` / `--primary-foreground` invisible on the chat self
      bubble, which paints that exact pair. Value, pair and reasoning live at
      [`../design-system/foundations.md`](../design-system/foundations.md) §13; the lane note is in
      [`tokens.md`](tokens.md). **The board takes no position on it** — option `3a` does not mention
      selection — so this is an extension, flagged as one rather than presented as a transcription
- [x] The Accent tab's card description, **every clause of which was false**: it promised the accent
      to "branded PDF reports" it has never reached (`report-pdf.renderer.ts` draws from five fixed
      constants and the branding payload carries no colour), checked contrast "against white" a year
      after [#1157](https://github.com/pdcarlson/Frapp/issues/1157) moved the check to the dark card,
      conflated an unparseable hex with one that fails contrast (the first falls back, the second
      **saves anyway** and discloses), and deferred the chapter palette to "Chunk 07" from inside
      chunk 07. Rewritten and pinned in `settings-accent.spec.tsx`
- [ ] The six `--signet-accent-*-alpha` roles are generated, persisted to `chapters.theme_palette`,
      bridged to nothing and read by nothing on any surface. Not removed here: the shape is
      persisted, so dropping them is a migration question rather than a token one

### No-retint, which is the lock this lane was most likely to break

The audit found the enforcement uneven in a way that is the opposite of what you would guess. The
*mark* is the best-guarded asset in the repo — `check-brand-assets.mjs` reads pixels since
[#2153](https://github.com/pdcarlson/Frapp/issues/2153), and `auth-screen.spec.tsx` pins the chip's
className. What had no **policy** guard were the two families declared in `signet.css` itself.

- [x] `--gold-ask-*`, `--gold-house`, `--gold-on-house` and `--scrollbar-*` asserted to be
      self-contained colours, not reads of anything. The existing tests compared these values against
      `signet.ts`, which is a *consistency* check between two files and stays green if both move
      together
- [x] `signetAccentSemanticVars`' key set asserted disjoint from that family. This is the single edit
      that would retint every fixed token at once, and [`tokens.md`](tokens.md) L-01 names it as a
      live trap ("A lane that merges them on the board's authority breaks the no-retint rule on every
      chapter that picks an accent") without anything stating it as a rule
- [x] The 260px crest asserted to carry no accent class and no filter, which
      `auth-screen.spec.tsx` cannot see because it tests a different component
- [ ] **`apps/web/app/favicon.ico` is still unguarded.** No script generates it and none checks it;
      it is absent from `sync-brand-assets.mjs`'s pair list and from every roster in
      `check-brand-assets.mjs`. A regressed favicon passes CI silently. Left for the asset pipeline
      rather than folded in

### 404 and error, board `1k`

The board allows crest art in exactly one place. Both routes were missing entirely: an unmatched URL
rendered Next's built-in fallback, which injects `body{color:#000;background:#fff}` and a system-ui
stack, so a dark-only product's 404 shipped as black-on-white — the same defect the #920 slice fixed
on `global-error` and left standing one boundary over, because nothing in `apps/web` calls
`notFound()` and so nobody reached it from inside the product.

- [x] `app/not-found.tsx` and `app/error.tsx`, both through one `CrestPage` recipe. A
      `grep -rn CrestPage apps/web` is the proof that no empty state grew crest art, and
      `crest-page.spec.tsx` asserts that inventory rather than describing it
- [x] `error.tsx` reports to Sentry. Before it existed, every render error below the root layout
      bubbled to `global-error`, which reports; catching them here without `captureException` would
      have made the product look better and report less
- [x] `writing.md` §7 carries both rows, in the same change

Three places the board is transcribed rather than lifted, which is the standing rule from lane 2's
scrollbars:

| Board `1k` draws | Shipped | Why |
| ---------------- | ------- | --- |
| `opacity:.9` on the crest | full opacity | `#DDB844` at 90% over `#1A1A1A` composites to `#CAA840`, which is not the mark gold, on the surface that renders the mark largest. The board's own note — "at native colors, never recolored" — is the half that governs. Quiet is carried by the crest's `#1A1A1A` field sitting flush on a `--surface-1` page instead |
| `border-radius:24px` | `rounded-2xl` (20) | [`../design-system/foundations.md`](../design-system/foundations.md) §8 locks the map at a 20 ceiling and calls an off-map radius "a defect, exactly as a raw hex value is" |
| 40px buttons | `Button size="sm"` (44) | §9's touch floor is 44 on every platform and §3's ladder has no 40 step |

One Next 16 API point worth not rediscovering: the error boundary's recovery prop is **`retry`**, not
`reset`. Both exist, so reaching for `reset` from memory type-checks and ships the wrong behaviour —
`retry()` re-fetches and re-renders, `reset()` re-renders without re-fetching, which is a Retry that
replays the same failed render against the same cache.

### Copy

- [x] Seventeen route titles carried `"<Page> — Signet"`. Replaced by one `title.template` on the
      root layout (`"%s · Signet"`, the separator the board uses throughout its own chrome), so no
      route spells the product name. The default moved from `"Signet Admin Dashboard"` to `"Signet"`:
      Admin is one permission-gated group in `nav-config.ts` and everything above it is a member
      surface
- [x] `scripts/ci/__tests__/signet-web-titles.test.mjs` **re-specified, not bumped.** It is a required
      check and it asserted the old shape twice over: every route title had to *match* `/Signet/`, and
      the root layout had to read `title: "Signet Admin Dashboard"`. Under a template the first is
      unsatisfiable by design — a route that still says Signet renders it twice — so the per-route
      assertion is now the **inverse**, and the "says Signet" half moved to the template, asserted
      once where the name is actually spelled. The lock's self-check gained a row so that assertion
      cannot be deleted, and its floor rose to 18
- [x] `/points` gained `(dashboard)/points/layout.tsx`, whose only job is a title. It is the one real
      nav destination whose page is `"use client"`, and a Client Component cannot export `metadata`;
      without it the template change left that tab reading a bare `"Signet"` next to sixteen siblings
      reading `<Page> · Signet`. The other metadata-less routes under `(dashboard)` are `redirect()`
      shims and paint no tab
- [x] `settings-modules-tab.tsx` shipped "Per-feature toggles arrive with Settings customization
      (Chunk 07)." — the same anachronism as the Accent card's, one tab over on the same page, and
      missed by the first pass because the sweep was scoped to the card being rewritten
- [x] Every em dash in product copy on a route **no lane touched** — `/service`, `/tasks`, `/events`,
      `/points`, `/profile`, `/chat-admin`, `/study`, `/discord-import`, `/no-access` and the
      onboarding overlays. Verified with a JS/TSX-aware lexer rather than a line grep, because this
      repo's comment prose is heavily em-dashed and a naive sweep is 93% false positives
- [ ] **Em dashes remain in product copy on routes lanes 2 to 5 already flushed** — `/chat`,
      `/settings`, `/billing`, `/reports`, `/backwork`. Left alone deliberately: they sit on other
      lanes' surfaces and this lane's scope is the untouched routes. §10's claim that Finance was
      "verified by stripping comments and grepping what remains. Two characters survive and neither
      is prose" is **wrong**, and is corrected in place there

The [`../design-system/writing.md`](../design-system/writing.md) §7 carve-out held: the only em
dashes left on the swept routes are `Once members check in — or you record attendance manually —
they'll show up here.` and `Reconnect to start a session — tracking needs a live location check.`,
both approved strings that need their own writing.md change.

### What this lane did NOT do, deliberately

| Not done | Why |
| -------- | --- |
| Board `2e`'s live mini-shell preview in the accent picker | `2e` is the chapter-creation wizard, a whole frame (org picker, suggested colours, swatch row) that no lane in the table owns. Half of it is worse than none. The invariant `2e`'s caption states — "The Signet mark and ✦ Ask never change" — is instead in the product, in the Accent card's own copy, and pinned by a test |
| An exact-fidelity preview | The generator is server-side by design: `@repo/chapter-theme`'s root barrel re-exports through a `./signet.js` specifier Turbopack cannot resolve ([`tokens.md`](tokens.md) §1), and it pulls `@radix-ui/colors`, `colorjs.io` and `bezier-easing`, which is a large client chunk for one admin tab a lane after [#2145](https://github.com/pdcarlson/Frapp/issues/2145) split bundles. The swatch stays an approximation, as it already was |
| `global-error.tsx` taken to `1k` | It replaces the root layout and its docstring bans importing the component tree, which is what makes `error.tsx` above it safe to build from `Button` and `CrestPage`. Consolidating them would remove the backstop that justifies the other. Its `reset` prop is noted above and left |
| A `(dashboard)/error.tsx` that keeps the nav | `1k` draws the error state full-page. A second boundary inside the shell would be a second answer to one question |
| L-06 and L-07 | Both are open locks needing a design decision, not a token edit. See [`tokens.md`](tokens.md) |

---

## What this checklist does not cover

Deleting a **route** or a **capability** is a behavior change, not chrome, and belongs to
[`../../behavior/`](../../behavior/README.md) with its own issue. Nothing on this list removes a
route, a permission, or a data contract. If a lane finds itself doing that, it has left the
greenfield's scope.
