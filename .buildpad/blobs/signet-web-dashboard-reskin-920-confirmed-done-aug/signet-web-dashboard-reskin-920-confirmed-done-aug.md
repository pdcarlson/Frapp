# Signet web-dashboard reskin (#920) — CONFIRMED DONE (Aug 23)

**Correction to prior canvas summary: #920 is complete, not pending.** Verified live via Claude Code status check (Aug 23) — dev server booted, screens rendered, tokens inspected in browser, git history checked. Full reskin shipped: shell, primitives, all 21 screen directories, 5 non-dashboard routes. Old `derivePalette` engine and legacy tokens fully removed (not overridden — they resolve to `null`). `spec/ui/web-dashboard/README.md` now reads "Active (Signet)."

**#1150 (sidebar hover/active contrast) — resolved by deletion, not stuck reverted.** The whole `--side-*` token family was deleted outright; sidebar is now fixed `--surface-1` with chapter accent shown through a generator-guaranteed-contrast pair. Hover/active states exist and are contrast-safe by construction. Also closed via this work: #916, #917, #1164, #1202, #1204, #541, #1157.

**Still open, real:**
- **#1190 and #1193** — need a design/product call, not more code. (Details not yet pulled — ask Claude Code for specifics before deciding.)
- **apps/landing** — still legitimately frozen (pre-Signet), gated on its own reskin (#913/#914). Nothing wrong here, just not started.
- **Mobile risk flagged by the agent, unprompted:** deleting `colors.dark` means an un-updated mobile binary gets a hard 400 instead of a graceful no-op, and `check:api-breaking` can't see this class of break. Filed as #1218-#1223. Worth deciding whether this blocks a mobile release before it ships.
- One stale doc line: `spec/ui/README.md:36` still cites #920 for truing-up that already finished — cosmetic, low priority.

Old blob content (all now superseded) removed. See the status-check prompt + full agent report as documents attached to this blob for the raw evidence trail.