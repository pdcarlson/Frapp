# Framework reference

Staging area for the **Claude Design web framework** that governs [#2140](https://github.com/pdcarlson/Frapp/issues/2140).
Rank 1 in the trust order in [`../README.md`](../README.md) §1: what lands here beats every written
doc, including the rest of this directory.

## Status

**One artifact landed, 2026-09-11:** [`web-framework.dc.html`](web-framework.dc.html), the framework
board. It is the rank-1 source for anything it covers, and it closes L-01 in
[`../tokens.md`](../tokens.md) — see § What this board settles below.

The numbered Design to Code packs, the backlog and the originating brief are still **not here**. A
lane that needs one of those is in the position the whole directory used to be in, and should ask for
the artifact rather than invent one.

## How the board got in

The route recorded here on 2026-09-11 as an untested lead — Claude Design's **"Send to Claude Code
Web"** — was tried, and it works. It is no longer a lead.

What it does: Claude Design exports a **handoff bundle** and seeds it as the workspace of a new
Claude Code web session. The bundle that arrived carried, at the workspace root:

| Path | Contents |
| ---- | -------- |
| `README.md` | The bundle's own instructions to the coding agent |
| `chats/chat1.md` | The full design conversation, including every answered question round |
| `project/` | The board, its canvas runtime (`support.js`), and its image assets |

The agent in that session then committed the file, which is what rule 1 below requires regardless of
how a board arrives. **Both halves are load-bearing:** the export moves the file to a machine, and
the commit is what makes it a source of truth. The failed attempt skipped the second half because the
first half never happened.

The bundle offered the board in three spellings. The one committed here is the readable one:

| Bundle file | Size | Why it was or was not taken |
| ----------- | ---- | --------------------------- |
| `project/Signet Shell.dc.html` | 274 KB | **Committed, byte for byte, as `web-framework.dc.html`.** Plain HTML source: a reviewer or an agent can read and grep it |
| `project/Signet Shell export.dc.html` | 274 KB | Identical to the above plus a nine-line `<template id="__bundler_thumbnail">` preview. Nothing to gain |
| `project/Signet Shell.html` | 973 KB | Self-contained and renderable, but the board's markup is inside bundler script blobs. Unreadable as source, which is the only way this directory is consumed |

`sha256(web-framework.dc.html) = 146586b52de80509ab1afddc137ab9e217ad9ea89328b18d1a7b60c443c7c7a2`.
The rename is the only change from the bundle file.

What still does **not** work is unchanged from the last attempt, and is kept here so it is not
rediscovered:

- Sending the file to a Claude Code session on the web as a chat attachment. Rooms do not carry
  files, and a session started from the web has no inbox that a file lands in.
- `DesignSync`. It reads claude.ai/design **design-system projects**, not canvas boards, and it
  needs a `/design-login` authorization that a non-interactive session cannot perform.
- Citing a path such as `/workspace/signet-design/…`, as [#2143](https://github.com/pdcarlson/Frapp/issues/2143)
  does under Sources. No agent and no reviewer can read a path on a machine this repository cannot
  see — which is rule 1 restated.

## Reading the board

It is a Claude Design canvas: four numbered turn sections, each holding lettered options. Anchors are
the option ids, and all 32 resolve inside the file.

| Section | Holds |
| ------- | ----- |
| `t4` | `4a`–`4f` — members column, subscription markers, per-page settings, chapter settings and roles, three "spice" treatments offered as options |
| `t3` | `3a` token sheet, `3b` component inventory and states |
| `t2` | `2a`–`2g` — sign-in, sign-up, join code, no-chapter home, the three chapter-creation wizard steps |
| `t1` | `1a` the build as it stood, `1b`–`1k` the rework, plus `1s` the chat first-paint contract and `1t` the deletion list |

**It carries three references that resolve nowhere, on purpose.** This matches the boards in
[`../../design-system/reference/`](../../design-system/reference/signet-design-system.dc.html) and
the reason is the same: these files are consumed as source text, not rendered, so their runtime
scaffolding is not committed. The comment in
[`.github/workflows/links.yml`](../../../../.github/workflows/links.yml) records that convention.

| Reference in the board | What it is | Why it is not committed |
| ---------------------- | ---------- | ----------------------- |
| `./support.js` | The Claude Design canvas runtime, ~67 KB of generated JS | Same as the design-system boards, which reference it and do not carry it |
| `assets/emblem.png` | Locked emblem B, 1024² | **Already in this repository.** Byte-identical to `packages/brand-assets/assets/signet-emblem-B-tile.png` (`sha256 ca55ab2f…3337b03`). A second copy under `spec/` would be an unguarded duplicate — `scripts/check-brand-assets.mjs` compares a fixed pair list and would not see it drift |
| `uploads/google-oauth-signet-logo.png` | Google's "G" mark on the sign-in button in `2a`–`2b`, 120² | A third-party mark, incidental to the design. Not ours to vendor into `spec/` |

## What this board settles

**It closes L-01, and it does so by agreeing.** The board's token sheet (`3a`) states the same four
surface hexes and the same accent seed that lane 1 shipped in
[#2152](https://github.com/pdcarlson/Frapp/pull/2152). The ladder is now artifact-backed and no
correction to it follows. The full comparison, including the twelve roles where the board and the
theme package **do** differ, is in [`../tokens.md`](../tokens.md) § L-01.

Two things the board does **not** settle, recorded so a later lane does not over-read it:

- **L-06.** The board states `--card: #211E1A`, the shipped value. It does not adopt the `#232019`
  alternative L-06 floats, and it does not discuss adjacent-step pitch at all. L-06 stays open; the
  board is evidence for the current value, not against the concern.
- **L-08.** The board writes the mark as "`#DDB844` on `#1A1A1A`, raster only" — the spec'd pair,
  which the committed raster contradicts. The board was drawn from the same spec, so this is the
  spec restated, **not** independent evidence about the raster.
  [#2153](https://github.com/pdcarlson/Frapp/issues/2153) is unaffected.

## What goes here

Named to match the epic's source list, so a reader can tell which artifact they are looking at:

| Filename | Contents | Status |
| -------- | -------- | ------ |
| [`web-framework.dc.html`](web-framework.dc.html) | The framework board: shell, chat, auth and wizard, token sheet, first-paint contract, deletion list | **Landed 2026-09-11** |
| `pack-NN-<topic>.md` or `.html` | The numbered Design to Code packs (00 through 07) | Not here |
| `WEB-UI-GREENFIELD-BACKLOG.md` | The backlog as handed over | Not here |
| `chat-shell-brief.md` | The originating brief | Not here |

The board arrived with its own design conversation (`chats/chat1.md` in the bundle). That transcript
is **not** committed: it records how the board was reached, and the board is what the trust order
ranks. If a lane needs to know why a screen looks the way it does and the board does not say, that is
a question for the transcript, and getting it in is another run of the route above.

## Rules for adding an artifact

1. **Commit the artifact itself, not a link to it.** The epic cites paths on a machine this
   repository cannot see. An artifact that is not committed is not a source of truth, because no
   agent and no reviewer can read it.
2. **Do not edit an artifact to resolve a conflict.** These are handover records. If the framework
   contradicts a shipped token or a brand lock, record the conflict in
   [`../tokens.md`](../tokens.md) under Open locks and resolve it there. `web-framework.dc.html` was
   committed unedited under this rule, which is why its three dangling references are documented
   above rather than rewritten.
3. **A committed `.dc.html` needs an exclusion in `.github/workflows/links.yml`, and the rule that
   used to stand here was wrong on both counts.** It said `--exclude-path` takes exactly one value so
   there was no list to extend, and that lychee might not crawl such a file at all. Measured when
   `web-framework.dc.html` landed: the flag **repeats** (one value per occurrence, lychee 0.24.2),
   and lychee **does** walk into `spec` and extract `<img src>`, producing 10 errors from this
   board's image references. It skips `<script src>`, which is why `./support.js` was silent. The
   exclusion added for this board is scoped to the **file**, not the directory, so this README's own
   links stay under the gate. Re-run `npm run check:links` when the next artifact lands; a board with
   no images may need no exclusion at all.
4. **State what an artifact supersedes.** Add a row to the table above and note in
   [`../tokens.md`](../tokens.md) which open lock the artifact closes.
