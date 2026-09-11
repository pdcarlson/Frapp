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

---

## What this checklist does not cover

Deleting a **route** or a **capability** is a behavior change, not chrome, and belongs to
[`../../behavior/`](../../behavior/README.md) with its own issue. Nothing on this list removes a
route, a permission, or a data contract. If a lane finds itself doing that, it has left the
greenfield's scope.
