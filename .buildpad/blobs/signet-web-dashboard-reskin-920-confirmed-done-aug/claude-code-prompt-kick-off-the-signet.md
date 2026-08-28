Look at our progress on the Signet cutover. Do research into the repo and audit it before touching anything:

- Read `spec/ui/README.md`, `spec/ui/design-system/README.md`, and both committed reference files under `spec/ui/design-system/reference/` (`signet-design-system.dc.html` and `canvas-screens.dc.html`) — these HTML references win over any written doc, and canvas-screens wins where the two disagree.
- Read `.claude/skills/signet-cutover/SKILL.md` in full before writing any code.
- Read issue #920 and everything it links: #916, #917, #1150, #1164, #1165, #1149.
- Confirm current state against the frozen-surface rule: `apps/web` should still be pre-Signet (bone/bronze/Geist), `apps/mobile` should already be Signet. Don't assume — check the actual files in `packages/theme` and `apps/web`.
- Check previous chats/canvas notes and closed PRs (#910, #911, #1143, #1145, #1153, #1169) for what the accent engine and WCAG math already guarantee, and what #1150's revert already proved doesn't work (branding `--side-bg-hi` independently of the sidebar's text ladder breaks contrast for up to 48/50 chapters — don't repeat that attempt).

Then scope and kick off the `apps/web` dashboard reskin to Signet (#920), the next big workload now that the CI/CD and docs-governance hardening sprint (PRs #1163-#1181) is done and merged.

Plan the cutover in reviewable slices, not one mega-PR:
1. **Shell first** — nav, sidebar, page chrome — on Signet `design-system/` foundations tokens, with the accent engine driving chapter accents. This slice should also resolve the sidebar contrast cluster properly: derive the surface and its text tokens (`--side-bg`, `--side-muted`, hover/active states) together as one system, since #1150's revert and #1164 both concluded that's the only approach that actually holds contrast across all 50 seeded chapters.
2. **Then per-screen-family slices** (events, tasks, points, study, dues, backwork, chat, settings, etc.) — each its own PR, each following the "cutover deletes what it replaces" rule: no parallel token sets, no shim left behind "for now."
3. Fold #916 (finish the emerald/success-state color scale) into whichever slice first touches success/positive states.
4. Finish with #917 (delete the deprecated `@repo/theme` brand aliases) once nothing references them.

Before opening each PR: confirm `check-doc-tables`, `check-doc-paths`, and `check-docs-impact` all pass (all required now), and file a `triage`-labeled GitHub issue for anything found that's out of scope rather than fixing it inline or parking it in a scratch file. Once the shell slice lands, update `spec/ui/README.md` so `web-dashboard/` is no longer marked Frozen.

Use ultracode workflows with Fable 5 as the subagent model — this repo's own Agent brief on #920 already specifies `depth:deep`, `model:fable`, `ultracode:yes`, since this is cross-cutting, judgment-heavy visual work with real correctness stakes (WCAG contrast, the accent engine), not a mechanical pass.