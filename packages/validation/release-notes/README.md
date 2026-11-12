# What's new lines waiting to ship

This folder is how a line gets into What's new. The writing rules live at the
top of [`../src/release-notes.ts`](../src/release-notes.ts).

**Writing a line.** A PR that changes what members see or can do adds one file
here per line: a lowercase name ending `.md` that no other PR will pick (your
branch name works, such as `claude-poll-choices.md`), holding one sentence by
those rules. A PR that changes nothing a member would notice adds none.

**Where it goes.** What's new splits each update's lines into Both, Web and
Phone (the apps put a switch over them; the changelog and the pasted text head
them Everywhere, On the web and On your phone), so the folder you put the file
in says where the change is:

| Folder | The change is |
| ------ | ------------- |
| this one | the same on the web and on your phone |
| `web/` | only on the web |
| `phone/` | only in the phone app (say "On Android" or "On iPhone" in the line when it is just one) |

A line in `web/` or `phone/` doesn't say "on the web" or "on your phone": the
switch or heading does. A line written the old way, in this folder and opening "On the
web, " or "On your phone, ", still lands under that heading with those words
taken off. Don't edit
`RELEASE_NOTES` to add a line: parallel PRs would conflict on it all day, and
one file per line never does. Every PR checks the files here, so a bad line or
a misnamed file fails in the PR that adds it.

**How it reaches members.** After each merge to `main` that touches this folder
or the notes, the What's new fold workflow
([`release-notes-fold.yml`](../../../.github/workflows/release-notes-fold.yml),
using [`scripts/release-notes-fold.mjs`](../../../scripts/release-notes-fold.mjs))
rebuilds one bot PR, `bot/whats-new`, that moves every waiting line into the
notes under that day's date (into `changes`, `web` or `phone` by its folder)
and deletes the files. It closes that PR if the
lines are removed before it merges. Merging it before a production deploy puts
the lines in that release; a line still waiting here at deploy time ships in
the next one. The bot PR merges itself once its checks pass (squash
auto-merge, the workflow's `AUTO_MERGE` switch, on since Paul asked on
2026-11-12), so nobody merges it by hand.

**Taking a line back.** Before the bot PR merges, delete the file. After, the
line is in the notes: delete it there. A revert of the PR that added the line
won't remove it, because the file is already gone.
