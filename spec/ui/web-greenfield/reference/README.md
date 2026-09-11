# Framework reference

Staging area for the **Claude Design web framework** that governs [#2140](https://github.com/pdcarlson/Frapp/issues/2140).
Rank 1 in the trust order in [`../README.md`](../README.md) §1: what lands here beats every written
doc, including the rest of this directory.

## Status

**Empty.** No framework artifact has been committed yet.

Until one lands, the highest-ranked source that actually exists is the written lane record in this
directory, then [`../../mobile/`](../../mobile/README.md) and
[`../../design-system/`](../../design-system/README.md). A lane that needs a visual decision the
written docs do not make should stop and ask for the artifact rather than invent one.

## What goes here

Named to match the epic's source list, so a reader can tell which artifact they are looking at:

| Filename | Contents |
| -------- | -------- |
| `web-framework.dc.html` | The framework board itself: shell, chat, token sheet, deletion list |
| `pack-NN-<topic>.md` or `.html` | The numbered Design to Code packs (00 through 07) |
| `WEB-UI-GREENFIELD-BACKLOG.md` | The backlog as handed over |
| `chat-shell-brief.md` | The originating brief |

## Rules for adding an artifact

1. **Commit the artifact itself, not a link to it.** The epic cites paths on a machine this
   repository cannot see. An artifact that is not committed is not a source of truth, because no
   agent and no reviewer can read it.
2. **Do not edit an artifact to resolve a conflict.** These are handover records. If the framework
   contradicts a shipped token or a brand lock, record the conflict in
   [`../tokens.md`](../tokens.md) under Open locks and resolve it there.
3. **`.dc.html` files are excluded from link checking.** `.github/workflows/links.yml` excludes
   `spec/ui/design-system/reference`, not this directory. A framework HTML file committed here
   **will** be crawled by lychee unless that exclude list is extended in the same PR. Extend it when
   the first HTML artifact lands.
4. **State what an artifact supersedes.** Add a row to the table above and note in
   [`../tokens.md`](../tokens.md) which open lock the artifact closes.
