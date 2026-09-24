## 12. Troubleshooting

**Vercel build fails with "module not found"**
→ Ensure `transpilePackages` in `next.config.js` includes all `@repo/*` packages used by that app. The `vercel.json` `buildCommand` uses Turbo to build dependencies first.

**Render deploy fails**
→ Check that the Dockerfile path is `apps/api/Dockerfile` and the build context is the repo root (Render default).

**Supabase connection refused in deployed API**
→ Ensure `SUPABASE_URL` uses `https://` (not `http://`) and points to the cloud project, not `localhost`.

**Mobile can't reach API**
→ Expo Go requires the API to be network-accessible. Use the deployed staging URL, not `localhost`. For local dev, use your machine's LAN IP (e.g., `http://192.168.1.x:3001/v1`).

**Staging web or landing uses the wrong env var value**
→ Fix it in Infisical `staging` and let the next merge (or a re-run of **Deploy Vercel staging**) rebuild. The staging build takes every key its app reads from Infisical and removes those keys from the Vercel Preview env it pulls, so editing a Preview row or a staging sync changes nothing. The deploy log's `App config from Infisical:` line names the keys each build received ([§4.2](vercel.md#42-environment-variables-per-project)). A key the app reads but never receives is missing from `APP_CONFIG_KEYS` in `scripts/ci/lib/vercel-build-env.mjs`.

**Production web or landing uses the wrong env var value**
→ Fix it in Infisical `prod`. The production build prefers the value the job injects from Infisical over the Vercel Production row, which only fills keys Infisical lacks ([#2673](https://github.com/pdcarlson/Frapp/issues/2673)); values are never typed into the dashboard. See [§ 4 Vercel Setup](vercel.md).
