Run in Claude Code, local, supervised. Two small, standalone fixes from PR #1153's follow-ups.

1. **#1150 — chapter branding paints the sidebar but not its hover/active steps.** Measured ~1.1:1 contrast — the highlight is effectively invisible. Fix the hover/active state to use a properly-contrasted step of the chapter accent, same derivation pattern the rest of the accent engine uses.
2. **#1152 — the 375px floor gate (`responsive-floor.spec.ts`, added in #1153) reports but cannot block**, because it lives in the deliberately-non-required `web-visual-regression` job. Decide the right fix: either move it to a required job, or make it its own required check (matching the `pr-base-guard.yml` pattern from #1132/#1138). Don't touch the visual-regression job's non-required status itself — that's deliberate for baseline-drift reasons.

3. **#1155 — the five `--hue-*` tokens have zero consumers.** Delete them, or if there's a real reason to keep them, state it in a comment. Don't leave them silently unused.
4. **#1156 — the cloud sandbox can't build `apps/web`** because bringup only writes `apps/api/.env.local`, so the `/chat` static export throws on missing `NEXT_PUBLIC_SUPABASE_*`. Fix the bringup script so agents can self-verify a web build going forward.

Do NOT touch #1149 (dark-mode contrast) — correctly deferred to #920 (the full Signet reskin). #1151 is already fixed (PR #1154). Do NOT touch #1146 (visual baseline regen) — needs Paul's machine with matching Chromium.

Report back with test results. File new debt as real issues.