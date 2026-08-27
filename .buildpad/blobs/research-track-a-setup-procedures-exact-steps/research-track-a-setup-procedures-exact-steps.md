# Research: Track A setup procedures (exact steps)

**TRACK A REMAINDER — MOSTLY DONE, STATE WAS BETTER THAN ASSUMED (Aug 27). PR #1286 merged, green.**

**#1033 (QR secret) — already done.** Set in dev+staging since Aug 25 (Paul did it, forgot). Redeployed automatically, route confirmed healthy (401, not 503). Full proof needs an authenticated staging test user, which doesn't exist yet — same #893 gap as Discord testing hit. Worth prioritizing #893 since it keeps recurring as the thing blocking full verification.

**Sentry — proven live on staging API with a real event** (deliberately tripped the spike detector, landed correctly, scrubbing intact). **Real gap found: the web dashboard's deployed JS has zero Sentry code** — likely `NEXT_PUBLIC_SENTRY_DSN` never reached Vercel's Preview environment. **2-minute check for you: Vercel → frapp-web → Settings → Environment Variables → confirm `NEXT_PUBLIC_SENTRY_DSN` is set for Preview.**

**EAS (#938) — can't run from sandbox** (no EXPO_TOKEN, api.expo.dev blocked). You run locally:
```
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init
git add app.json &amp;&amp; git commit
```
`eas build:configure` is NOT needed — `eas.json` already exists correctly. Also set `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` manually in the EAS dashboard (no auto-sync from Infisical). **Android can proceed today; iOS device builds need Apple Developer Program ($99/yr) enrolled first** — simulator/Android are free.

**PostHog — mostly already set up, revise the "3 projects" plan.** Real design here is 2 projects: staging (exists, called "Default project" — just rename it to "Frapp Staging", free) and production (gated on #709, a real prerequisite — deleted-user handling must land first). Skip a dev project entirely, intentional. Adding a 2nd project needs a credit card on file (stays $0 usage).

**Sentry projects — API and web already correctly split**, environment separated by tag not project (correct design). **Real gap: mobile has no Sentry at all** — needs actual code work (`@sentry/react-native` isn't in the app), not just a dashboard step. File as its own task, not a quick config fix.

**Your two technical worries from the original prompt didn't apply here** — no event-batching library exists to lose events (API posts each one immediately), and the API is CommonJS with Sentry initialized before bootstrap, so no `--import` flag needed.

**What's left to actually do, in order:**
1. Merge PR #1286 (green, ready).
2. Check the Vercel Sentry DSN gap (2 min).
3. Run the 3 EAS commands locally.
4. Rename the PostHog project.
5. Decide whether #893 (staging test user) is worth doing now — it keeps blocking full verification across multiple features.
6. File mobile Sentry as a real future task, not urgent.