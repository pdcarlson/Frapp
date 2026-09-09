## 12. Troubleshooting

**Vercel build fails with "module not found"**
→ Ensure `transpilePackages` in `next.config.js` includes all `@repo/*` packages used by that app. The `vercel.json` `buildCommand` uses Turbo to build dependencies first.

**Render deploy fails**
→ Check that the Dockerfile path is `apps/api/Dockerfile` and the build context is the repo root (Render default).

**Supabase connection refused in deployed API**
→ Ensure `SUPABASE_URL` uses `https://` (not `http://`) and points to the cloud project, not `localhost`.

**Mobile can't reach API**
→ Expo Go requires the API to be network-accessible. Use the deployed staging URL, not `localhost`. For local dev, use your machine's LAN IP (e.g., `http://192.168.1.x:3001/v1`).

**Preview deploys on Vercel use wrong env vars**
→ Check that you scoped the env vars to the correct environment (Production vs Preview). Values are pushed from Infisical rather than typed into the dashboard ([§4.2](vercel.md#42-environment-variables-per-project)), so fix the scope on the sync. Staging builds pull Preview vars via `vercel pull`; nothing is push-triggered. See [§ 4 Vercel Setup](vercel.md).
