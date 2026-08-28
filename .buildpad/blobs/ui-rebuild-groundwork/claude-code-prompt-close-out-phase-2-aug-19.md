We're closing out Phase 2 (UI/mobile cutover) — do not start on any new feature work (messaging, AI recaps, etc.), those are parked for later. Scope is just finishing what's already in flight:

1. **#958** — build the two remaining screens (s02 Join, s03 First-run) plus the mobile chapter-creation wizard (mirror `apps/web/components/onboarding/chapter-wizard.tsx` and its `POST /v1/chapters/onboard` call). This is the one real engineering gap left before the app is screen-complete.

2. **#919 (P1)** — investigate the schema drift between the deployed database and `supabase/migrations/`. Report exactly what's out of sync and what a safe reconciliation looks like before we run device smoke tests. Don't apply anything destructive without flagging it to me first.

3. Once #805/#938/#1033/#806/#1064 are done on my end (dashboard provisioning, in progress), prep whatever's needed on the code side for **#808**, the device smoke-test pass that's the actual Phase 2 exit gate.

4. Epic hygiene: **#937** will have only #958 as an open blocker once the above lands. Tell me when it's ready to close and whether anything else needs to be swept into it or split out first.

Give me a status report when done — don't move on to Phase 3 (RAG-ready data architecture) or Phase 4 (Discord migration) without checking in first.