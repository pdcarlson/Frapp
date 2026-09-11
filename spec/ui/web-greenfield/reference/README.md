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
3. **Check how lychee reaches a committed `.dc.html` before assuming it is safe.**
   `.github/workflows/links.yml` excludes `spec/ui/design-system/reference` — and its own comment
   records two things worth knowing before copying that remedy. First, `--exclude-path` **takes
   exactly one value**, which that path already occupies, so there is no "list" to extend. Second,
   lychee's walk does not extract `<script src>` and only reaches such files when the directory is
   passed explicitly, so a framework artifact here may not be crawled at all. Verify with
   `npm run check:links` when the first HTML artifact lands, and only change the workflow if that
   run actually fails.
4. **State what an artifact supersedes.** Add a row to the table above and note in
   [`../tokens.md`](../tokens.md) which open lock the artifact closes.
