# Deletion checklist

Acceptance for lanes 2 through 7 of [#2140](https://github.com/pdcarlson/Frapp/issues/2140). The
greenfield is a **hard cleanup**: it removes generated chrome to give content more room. A lane is
not done because a new surface renders; it is done when the thing it replaced is gone.

This list is the acceptance criterion, not a suggestion. It restates the
[cutover rule](../../../.claude/skills/signet-cutover/SKILL.md): a change that supersedes an
implementation deletes it in the same change. Git history is the backup.

Every path and line count below was read out of the tree at the time this lane landed. Treat them as
a starting map, not as current truth, and re-read before deleting.

---

## 1. Command palette (Cmd+K) — lane 2

| File | Lines | Note |
| ---- | ----- | ---- |
| `apps/web/components/layout/dashboard-command-menu.tsx` | 402 | The palette |
| `apps/web/components/layout/dashboard-command-menu.spec.tsx` | 516 | Its suite, deleted with it |
| `apps/web/components/layout/dashboard-shell.tsx` | — | The `k` keybinding and the mount |
| `apps/web/components/ui/command.tsx` | 165 | The `cmdk` wrapper |

- [ ] Palette component and its suite deleted
- [ ] Keybinding removed from the shell, and the top bar's Search control removed or repointed
- [ ] `cmdk` dependency removed from `apps/web/package.json` **only if** `ui/command.tsx` has no
      surviving consumers

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

- [ ] Third column removed and the grid collapsed to two columns
- [ ] The static "Details" placeholder deleted rather than hidden
- [ ] `ThreadPanel` given a new home, or removed with a stated decision about threads

> The rail is **not empty**: it hosts `ThreadPanel` as well as the placeholder. Deleting the column
> without deciding where threads go removes a feature. Decide, then delete.

## 3. Channel search — lane 3

| File | Location |
| ---- | -------- |
| `apps/web/components/chat/channel-list.tsx` | `:188` the `query` state, `:220-226` the `filtered` memo, `:302-317` the input |

- [ ] Search input, its state, and its filter memo removed together
- [ ] No orphaned `SearchGlyph` import left behind

## 4. Ask entry and AI chrome — lane 3 or 7

| File | Lines | Note |
| ---- | ----- | ---- |
| `apps/web/components/layout/ask-pill.tsx` | 102 | Sole importer `dashboard-shell.tsx:30`, mounted at `:481` |

- [ ] Decide: remove the Ask pill, or keep it and restyle it in the greenfield top bar
- [ ] If removed, the `gold-ask-*` tokens lose their only consumer. Remove them from `signet.css`
      and `signet.ts` in the same change, or state why they stay

> **"AI page narration" does not exist in `apps/web`.** It was on the epic's deletion list, but there
> is no page-summary or narration surface in the codebase, and no model call anywhere in the app. The
> Ask pill is a **stub**: it opens a dialog that says Ask cannot answer yet. Nothing else to delete.
> Recorded here so a later lane does not go looking for it.

## 5. Shell — lane 2

| File | Lines |
| ---- | ----- |
| `apps/web/components/layout/dashboard-shell.tsx` | 498 |

Seven satellites, none imported outside the shell: `account-menu.tsx` (136),
`chapter-switcher.tsx` (215), `chapter-lockup.tsx` (141), `beta-badge.tsx` (90),
`dashboard-notification-drawer.tsx` (232), `ask-pill.tsx` (102), `dashboard-command-menu.tsx` (402).

- [ ] Each satellite either rebuilt or deleted. None left rendering beside a replacement
- [ ] `nav-config.ts`, `protected-nav-item.tsx`, and the account menu's shared bottom region survive
      or have their behavior re-homed. These carry permission and module gating, which is behavior,
      not chrome
- [ ] The responsive contract is re-stated or deliberately changed. Today it is **two states, not
      four**, switching once at `lg`. Adding a tier is a spec change

## 6. Scrollbars — lane 2

- [ ] Chrome's default scrollbars replaced using the `--scrollbar-*` tokens from
      [`tokens.md`](tokens.md)
- [ ] Applied to the shell's scroll regions, not globally to `*`
- [ ] Reduced-motion and keyboard scrolling unaffected

## 7. Standing bans to keep true

These already hold. The greenfield must not reintroduce them.

- [ ] No `next-themes`, no theme switcher, no light palette. Signet web is dark-only
- [ ] No live `dark:` variants
- [ ] No `shadow-*`. Elevation is a lighter surface step
- [ ] No legacy bone / bronze / Geist token on this surface
- [ ] No unused component left under `apps/web/components/ui`
- [ ] No customer-facing "Frapp" string or wordmark

---

## What this checklist does not cover

Deleting a **route** or a **capability** is a behavior change, not chrome, and belongs to
[`../../behavior/`](../../behavior/README.md) with its own issue. Nothing on this list removes a
route, a permission, or a data contract. If a lane finds itself doing that, it has left the
greenfield's scope.
