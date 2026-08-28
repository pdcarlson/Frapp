Context: I believe I've set STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET in Infisical dev + staging (#1278). You now have read-only access to dev/staging Infisical per the #1279 resolution — use it to verify rather than assume.

1. Confirm both `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` are present and non-empty in both `dev` and `staging` (names/presence only, never print the actual secret value — same rule as before).
2. Confirm `STRIPE_PRICE_ID`'s value (if you can safely compare without printing it in full) matches `price_1U93Pm3Dzz3XLCb6okJnzjat`.
3. Check whether staging has redeployed since the value was set — Render won't pick up new Infisical values on an already-running service. If it hasn't redeployed, tell me explicitly rather than assuming it has.
4. If everything above checks out, tell me exactly how to fire Stripe's "Send test webhook" button for endpoint `we_1U93QB3Dzz3XLCb6mYeeNzUF` myself, and what a 200 vs 401 response means (I want to run this myself and understand the result, not have you interpret it for me blind).
5. If you have a way to verify the webhook secret without me clicking anything (e.g., via the Stripe connector), do that first and tell me the result — but don't guess if you're not sure the check is real.

Flag anything that looks off rather than reporting success by default.