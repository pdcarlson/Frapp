Context: Buildpad canvas notes (last updated Aug 21) say the Signet web-dashboard reskin (#920) has NOT been started as an actual visual overhaul — only foundational work has landed (accent engine, WCAG contrast math, token naming in #910/#911; a Wave 0 tokens+nav-config restructure in #1143/#1145/#1152). `spec/ui/README.md` reportedly still marks `web-dashboard/` and `landing/` as "Frozen (pre-Signet)". #1150 (sidebar hover/active states) was built and reverted for breaking contrast on 48/50 seeded chapters.

Before I plan next steps I need current ground truth, not canvas notes. Please check:

1. **Issue #920** — current status (open/closed), any linked PRs, any commits referencing it, any branch/worktree that touches it.
2. **`spec/ui/README.md`** — does it still mark `web-dashboard/` and `landing/` as Frozen (pre-Signet)? Quote the exact current line.
3. **Actual rendered state of apps/web** — pull up 3-4 core screens (dashboard home, sidebar/nav, an event or task list page) and describe what design system they're actually using right now: old pre-Signet tokens, new Signet tokens, or a mix. Cite specific files/class names as evidence, not impression.
4. **Git history since Aug 21** — any merged PRs touching `apps/web` UI/styling that I might not know about (search commit messages and PR titles for reskin/redesign/sidebar/nav/theme keywords).
5. **#1150's current state** — confirm it's still reverted, not re-landed in a different form.
6. **#917 and #916** — still blocked/open, or did either land?

Report back plainly: what's actually done, what's actually still pending, and whether the canvas summary above is accurate, outdated, or wrong. Don't fix anything yet — this is a status check only.