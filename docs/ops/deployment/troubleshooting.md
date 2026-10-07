## 12. Troubleshooting

**Vercel build fails with "module not found"**
→ Ensure `transpilePackages` in `next.config.js` includes all `@repo/*` packages used by that app.
**Render deploy fails**
→ Check that the Dockerfile path is `apps/api/Dockerfile` and the build context is the repo root (Render default).

**Supabase connection refused in deployed API**
→ Ensure `SUPABASE_URL` uses `https://` (not `http://`) and points to the cloud project, not `localhost`.

**Mobile can't reach API**
→ Expo Go requires the API to be network-accessible. Use the deployed staging URL, not `localhost`. For local dev, use your machine's LAN IP (e.g., `http://192.168.1.x:3001/v1`).

**Staging web or landing uses the wrong env var value**
→ Fix it in Infisical `staging`, then rebuild the staging frontends the way [`SECRETS_MANAGEMENT.md` § Secret Exposed](../../internal/environment/SECRETS_MANAGEMENT.md#secret-exposed) step 3 says (which run rebuilds, and what to do while `main`'s tip is red). The staging build takes every key its app reads from Infisical and keeps only Vercel's system variables from the Preview env it pulls, so editing a Preview row changes nothing (there is no staging Vercel sync; the two were deleted on 2026-09-28). The deploy log's `App config from Infisical:` line names the keys each build received ([§4.2](vercel.md#42-environment-variables-per-project)). A key the app reads but never receives is missing from `APP_CONFIG_KEYS` in `scripts/ci/lib/vercel-build-env.mjs`.

**Production web or landing uses the wrong env var value**
→ Fix it in Infisical `prod` and redeploy. The production build takes every key its app reads from Infisical and keeps only Vercel's system variables from the Production env it pulls ([#2673](https://github.com/pdcarlson/Frapp/issues/2673), [#2810](https://github.com/pdcarlson/Frapp/issues/2810)), so editing a Vercel row changes nothing. The build log's `App config from Infisical:` line names the keys each build received, its `Removed …` line names every pulled row it dropped, and a `::warning::` names any app key Vercel held that Infisical didn't supply. See [§ 4 Vercel Setup](vercel.md).
