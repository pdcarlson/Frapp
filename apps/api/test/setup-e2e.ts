// Deterministic environment for the API E2E suite.
//
// The E2E specs boot the full `AppModule`, whose `ConfigModule.forRoot` runs
// `validateEnv` (src/config/env.validation.ts) at import time and throws if any
// of these required vars is missing. The values themselves are never exercised
// against live Stripe or Supabase: specs that need those clients override
// `SUPABASE_CLIENT` and (when they hit billing routes) `BILLING_PROVIDER`.
// Health e2e boots `AppModule` without a billing-provider override; the dummy
// `sk_test_dummy` secret is a documented skip for StripePriceConsistency, so
// boot does not call `prices.retrieve`. A real-looking `sk_test_` / `sk_live_`
// in the environment *would* retrieve. Setting non-empty defaults here (only
// when unset, so a real local `.env.local` still wins) keeps the suite hermetic
// — it runs in GitHub Actions with no secrets or live services.
//
// Wired via `setupFiles` in `test/jest-e2e.json`, which Jest executes before
// each spec module is evaluated — i.e. before the top-level `import { AppModule }`
// triggers the config validation.
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_test_dummy';
process.env.STRIPE_PRICE_ID ||= 'price_test_dummy';
