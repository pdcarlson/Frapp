Context: six remaining beta blockers, all human-executed setup tasks (secrets, dashboard config, production changes). Research below gives the correct current procedure for each — use it as ground truth, don't re-derive from scratch, but DO verify it against our actual repo/environment state before acting, since generic docs can be wrong for our specific setup.

For each item: verify current state first, then either (a) execute it yourself if it's safe/non-production/reversible, or (b) if it touches production or needs credentials only I have (Stripe dashboard, Apple ID, account signups), give me the exact commands/values/click-path specific to our repo, then verify afterward that it actually worked. Don't just hand me generic docs — tell me the exact thing to type or click, using our real values where you can determine them.

**1. Supabase migration repair (#919) — you can likely do this yourself, but confirm with me before writing to production**
- Run `supabase migration list` against production, confirm the orphan row is `20260228000000` with no local file.
- Prepare `supabase migration repair 20260228000000 --status reverted` and show me the dry-run proof (`migration list` before/after, then `db push --dry-run` showing the ~49 pending migrations that would apply cleanly).
- Given this is production and has been open a long time specifically because it needed care: show me the dry-run results and get an explicit go-ahead from me before running the real repair + push. Don't do it silently.

**2. Prod auth hook (#805) — depends on #1 landing first**
- Confirm the `custom_access_token_hook` function truly doesn't exist in prod (0 rows in `pg_proc`).
- Write the migration creating it with the correct grants (`grant execute ... to supabase_auth_admin`, `grant usage on schema public to supabase_auth_admin`, revoke from authenticated/anon/public) — do NOT use `SECURITY DEFINER`.
- This can go through the normal PR → merge → production-dispatch pipeline we just built. Tell me exactly when it's safe for me to flip the dashboard toggle (Authentication → Hooks) — function must exist first, or sign-in breaks.
- After I flip it, verify one real sign-in still works.

**3. #1033 EVENT_CHECK_IN_TOKEN_SECRET — tell me exactly what to do**
- Confirm what's currently missing (dev/staging/prod, Infisical + Render).
- Give me the exact secret name, where to generate a value, and exactly which Infisical/Render screens to set it in per environment.
- After I confirm it's set, verify QR check-in mint no longer 503s.

**4. Stripe going live — mostly me, verify after**
- I'll handle: business verification, generating live keys, registering the live webhook (note: this needs a NEW signing secret, can't reuse test/staging's), recreating any test-mode products with the same IDs, mobile `merchantIdentifier`/`urlScheme` config.
- Tell me exactly which env vars go where (API secret key location, web/mobile publishable key location) once I have the values.
- After I give you the keys are in place, verify: a test PaymentIntent succeeds server-side, the webhook receives a real event, and (if you can't test mobile directly) tell me exactly how to verify Apple Pay actually appears in the PaymentSheet myself.

**5. EAS project setup — you can likely run this yourself**
- Run `eas init` (writes `projectId` into `app.json` — confirm it actually gets committed, that's a common failure point) and `eas build:configure`.
- Tell me exactly which Apple IDs you still need from me (Team ID, ASC App ID, ASC API key) and precisely where in the Apple/App Store Connect dashboard I find each one — don't make me guess which "Apple ID" field means what.
- Apple Developer Program membership is NOT required for this step or simulator builds — flag clearly if we hit a point that actually requires it.

**6. PostHog + Sentry — I create accounts/projects, you wire the rest**
- I'll create 3 separate PostHog projects (dev/staging/prod — this is PostHog's own recommendation, not one project with filters) and separate Sentry projects per app (API/web/mobile).
- Once I give you the keys/DSNs, wire them into the right place per environment, watching for: `flushAt`/`flushInterval` settings so Render doesn't lose events before flush, and confirming whether our API's Render start command runs ESM or CommonJS (determines if Sentry needs `--import ./instrument.mjs` in the start command to capture anything at all).
- Verify end-to-end yourself: trigger a real unhandled error (not an HttpException, those are ignored by Sentry's NestJS integration by design) and confirm it lands in Sentry; confirm a live PostHog event appears in Activity for at least one environment.

Go in the order listed — 1 and 2 are sequential, 3-6 can happen in any order. Flag anything where our actual repo state disagrees with what I've described above rather than guessing.