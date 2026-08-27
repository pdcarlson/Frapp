Context: Stripe dev/staging is fully verified and working. Auth hook (#805) is a one-click Supabase dashboard toggle I'm doing myself. Remaining beta blockers: #1033 (QR check-in secret), #938 (EAS setup), #1173/#862 (PostHog + Sentry). You now have read-only Infisical access to dev/staging (per #1279) — use it to verify real state instead of assuming.

**1. #1033 — EVENT_CHECK_IN_TOKEN_SECRET**
- Check current state: is it set in `dev`/`staging` already (I recall it may only be in a local `.env.local`, not real Infisical envs)? Read-only access should confirm.
- If missing from dev/staging: generate a strong random value yourself (this doesn't need to be something only I can produce — it's not tied to any external account), and tell me exactly what to paste into which Infisical environment, OR if you genuinely cannot write Infisical, tell me the exact value to set myself.
- After it's set and staging redeploys, verify QR check-in mint no longer 503s — same kind of live probe you just did for the webhook.

**2. #938 — EAS project setup**
- Run `eas init` and `eas build:configure` yourself if you have `EXPO_TOKEN` / CLI access in this sandbox. If not, tell me exactly what you need me to run locally.
- Confirm `app.json` actually gets `projectId` written and committed (known failure point — it sometimes stays untracked).
- Tell me precisely which Apple IDs you still need from me (Team ID, ASC App ID, ASC API key) and exactly where in Apple/App Store Connect to find each — don't make me guess which "Apple ID" field means what.
- Flag clearly if anything here actually requires the paid Apple Developer Program ($99/yr) vs. what doesn't.

**3. #1173 / #862 — PostHog + Sentry**
- I'll create the accounts/projects myself (3 separate PostHog projects for dev/staging/prod per their own recommendation; separate Sentry projects per app). Tell me exactly what to name each and confirm that plan is still right given anything you've learned since.
- Once I give you the keys/DSNs, wire them into Infisical + the right code locations per environment.
- Watch for: Render/serverless event-loss on PostHog (`flushAt`/`flushInterval` settings), and whether our API's start command runs ESM or CommonJS (determines if Sentry needs `--import ./instrument.mjs` to capture anything at all).
- Verify end-to-end: trigger a real unhandled error (not an HttpException — Sentry's NestJS integration ignores those by design) and confirm it lands in Sentry; confirm a live PostHog event appears in Activity for at least one environment.

Verify before acting, same as last time — tell me plainly what's actually true versus what you're assuming. Flag anything ambiguous rather than guessing.