Context: Track A is nearly done. Five remaining items, most need me to act first (dashboard/local commands you can't reach), with you verifying after or handling what's left over.

1. **PR #1286** — confirm it's still green and check whether anything changed since it was last reported clean. If it's mergeable and nothing's blocking, tell me plainly it's ready; I'll merge it myself.

2. **Vercel Sentry DSN gap** — I'm going to check Vercel → frapp-web → Environment Variables and confirm/add `NEXT_PUBLIC_SENTRY_DSN` for Preview myself. Once I tell you I've done that and staging/preview has redeployed, re-sweep the deployed web bundle's JS chunks the same way you did before and confirm Sentry code is actually present now. Don't just assume the fix worked — verify it the same rigorous way you found the gap.

3. **EAS setup** — I'm going to run `eas login`, `eas init`, and commit `app.json` myself locally. Once I confirm that's done, verify: `app.json` actually has `projectId` populated and committed on the branch, and `eas.json`'s profiles are still correct and untouched. Also remind me exactly what I still need to do in the EAS dashboard for `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` per profile, since there's no auto-sync for those.

4. **PostHog project rename** — I'll rename "Default project" to "Frapp Staging" myself in the dashboard (cosmetic, no code/config change). Nothing for you to do here unless something else references the old project name anywhere in docs or code — check for that specifically and fix if found.

5. **Mobile Sentry — real gap, file it as its own scoped task, don't try to build it now.** File an issue covering: adding `@sentry/react-native`, creating a `frapp-mobile` Sentry project, wiring the DSN through EAS env vars (same pattern as Supabase above), and confirming capture works on a real device/build (not Expo Go, matching the same constraint you found elsewhere for native-only features). Don't start the implementation — just scope it clearly enough that a future session can pick it up cold.

Verify rather than assume throughout, same as your last two passes. Flag anything that doesn't match what I've described above instead of guessing.