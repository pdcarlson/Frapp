Run in Claude Code, local, supervised. Four independent, no-decision items from PR #1147's follow-ups.

1. **#1143 — web chapter retinting silently no-ops.** `derivePalette` writes hex values but the Tailwind config reads `hsl(var(--x))`, so changing a chapter's accent color has no visible effect on web. Real functional bug, fix it.
2. **#1145 — `bg-secondary` / `text-secondary-foreground` ship in 4 shadcn components with no token definition.** Find the 4 components, define the missing tokens in the theme layer (or swap the components to tokens that exist, whichever matches the design system's intent).
3. **#1142 — 7 dashboard routes break the 375px floor on page content** (shell now holds it, per-route content doesn't). Fix each route's overflow.
4. **#1144 — `packages/theme` has no lint or test script**, despite owning every token value in the app. Add both, matching the other packages' conventions.

Do NOT touch #1146 (visual baseline regen) — that needs a machine with matching Chromium, it's on Paul.

Report back per item with test results. File any new debt as real issues.