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
*and* members *and* messages (`1b` pin 8), so this field was the narrower of the two.

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
- [x] No `shadow-*`. Elevation is a lighter surface step. ~~**This one is not clean today.**~~
      **Closed by lane 3**, both halves. The two live sites
      (`apps/web/components/chat/mention-list.tsx:128` and `:140`) dropped their `shadow-md`, and
      `md` is now bound in the shared preset (`packages/theme/src/tailwind.config.ts`) against a new
      `--shadow-md: none` in `signet.css`, so the gap cannot reopen by someone typing `shadow-md`
      again. The original diagnosis was exactly right: `boxShadow` bound `xs`/`sm`/`DEFAULT`/`lg`
      only, so `shadow-md` fell through to Tailwind's built-in and compiled a real drop shadow past a
      ban everyone believed the `none` tokens enforced. `grep -rn 'shadow-md' apps packages` is now
      clean
- [ ] No legacy bone / bronze / Geist token on this surface
- [ ] No unused component left under `apps/web/components/ui`
- [ ] No customer-facing "Frapp" string or wordmark

---

## What this checklist does not cover

Deleting a **route** or a **capability** is a behavior change, not chrome, and belongs to
[`../../behavior/`](../../behavior/README.md) with its own issue. Nothing on this list removes a
route, a permission, or a data contract. If a lane finds itself doing that, it has left the
greenfield's scope.
