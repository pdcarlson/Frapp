Use `/goal` — this should run long-horizon and resume on its own if idle, not need turn-by-turn driving.

Sync `.buildpad/` first. Then reverify current status of #805, #938, #1033, #806, #1064, #919, #958, #1084 directly against GitHub — the Aug 20 status check is a starting point, not gospel; more may have landed since. Wave 1 batch 1 (items 3, 4, 6, 9) is in flight on separate branches right now — pull latest and check for file collisions before touching anything those branches also touch; defer if there's a real conflict.

**Do fully, end to end, no need to check in:**
1. #958 — build the mobile join/first-run screen pair (`join.tsx`/`welcome.tsx` are routed stubs today). Wire `has_completed_onboarding` to actually gate routing to s03.
2. #1084 — build the mobile chapter-creation wizard UI (API side is already complete per the Aug 19 audit).
3. Read-only check: confirm the code paths consuming `EVENT_CHECK_IN_TOKEN_SECRET`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and the EAS project id are correctly wired to env values with no code-side gap. If you find a real code bug, fix it. If it's genuinely just a missing value only I can supply, don't stub around it or invent one.

**Do NOT attempt, no exceptions:**
- Repairing/applying production schema drift (#919) or flipping the #805 hook toggle in production. Both need Supabase dashboard/Management API access this environment doesn't have, and #919 specifically should never be applied by an agent — a wrong move breaks prod sign-in.
- Creating or setting values in Infisical, Render, Vercel, or EAS/Apple/Google consoles. No credentials exist for these here; don't work around that gap.

**For everything you can't finish:** don't just say "blocked" — write one ordered runbook in the PR description covering every remaining item, in the order they actually need to happen (e.g., #919 before #805-in-prod), with exact secret/env var names and exactly where each one goes (Infisical path, Render service, Vercel/EAS console). I should be able to follow it without re-reading any prior audit.

Same discipline as Wave 0/1: typecheck + test pass before moving to the next item, draft PR per item rather than one giant PR.