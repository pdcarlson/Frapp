# Current build state

**Aug 20 (later still) update — Batch 2/3 follow-ups all merged, engineering caught up again.** Ten more PRs reviewed and merged today, all clean, no CI red, nothing blocked:

- **#1112, #1113, #1114, #1115, #1116, #1117** — every prompt drafted after the previous review batch ran successfully: releaseDispatch tenant-scope hardening, branding.md spec fix (logos now match the shared `image` kind, GIF + 25MB), points-reason constant dedup, mobile `@repo/org-archetypes` thaw, TypeScript 7 follow-ups, and the date-formatting/mobile-analytics-opt-out batch (with three date-format clusters — stopwatch, bare-date, minute-duration — deliberately kept separate and now protected by tests).
- **#1108, #1109, #1110, #1111** — four routine dependabot bumps, all merged clean.
- **#1118, #1119, #1122, #1123, #1124, #1125, #1126** — scheduled-jobs characterisation test, and the full React Compiler lint cleanup (chat/auth/realtime, stacked PRs) landed: every v7 recommended compiler rule is now enabled at upstream severity, zero held off. Plus deleted the dead `useAnalytics` hook. **#1121** added an env-docs runbook.

**TOOLING DECISION (Aug 20, later still): Cursor is parked.** GitHub MCP never stabilized across either review batch — down in the large majority of sessions, generating chronic unfiled-issue debt. Claude Code (local) is primary again for everything going forward, not just judgment work. See the MCP-outage note for detail.

**Human-only blockers — refined with a live audit today, none moved:**
1. **#919** prod schema drift — staging in sync (43/43). Prod: **42 pending + 1 foreign row** (`20260228000000_enable_rls_on_remaining_tables`, not in this repo). `db push` refuses until the foreign row is repaired by hand (runbook: no blind `migration repair`). Blocks #805's prod half.
2. **#805** prod auth hook — **staging already enabled and token-verified.** Prod: not enabled, and the `custom_access_token_hook` function itself **doesn't exist yet in prod** (0 rows in `pg_proc`). Do not flip until #919's migrations land — enabling a missing function breaks sign-in.
3. **#1033** `EVENT_CHECK_IN_TOKEN_SECRET` — still unset in Infisical (dev/staging/prod) and on both Render API services. QR check-in mint still 503s.
4. **#806 / #1064** Stripe — **staging web is fully wired** (Infisical, Render, Vercel all have it). **Prod web is not**: Infisical prod Stripe keys exist but are empty strings; Render prod has no Stripe vars at all. **Mobile (#1064): `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is missing in every environment**, not just prod. No E2E payment proven yet.
5. **#938** EAS project — still not done. No `projectId` in `app.json`, `eas.json` still has placeholder Apple IDs, zero `EXPO_PUBLIC_*` keys in Infisical.
6. **Sync `.buildpad/`** — still owner-only, still worth doing before naming specific docs in prompts.
7. **Device-verify** join/welcome/wizard flow — still gated on #805 + #938.

**#958 (mobile join/first-run) is closed** — shipped via #1101/#1102, confirmed live on `origin/main`. No longer an open item; #937 (Phase 2 epic) still open, device smoke tracked separately as #808.

**New debt spotted, small:** `supabase-task.repository.spec.ts` seeds an invalid `TaskStatus` value; `spec/behavior/events.md` still says POST for the check-in mint route (code is GET); issue #342's stale-text fix may not have landed; two issues drafted in #1121 never filed (mobile tutorial-replay spec gap, #937 hygiene comment) — drafts saved on canvas, file by hand.