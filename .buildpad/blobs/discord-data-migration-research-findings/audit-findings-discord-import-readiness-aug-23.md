**Verdict:** tenant scoping and roles are reusable. Chat model, file storage, and search all need real changes before an importer can be written. No Discord scaffolding exists yet.

**3 blockers that reshape the spec:**
1. `chat_messages.sender_id` is `NOT NULL references users(id)` — no room for a Discord author with no Signet account. Fix: make nullable, add `author_name`/`author_avatar_path`/`author_external_id` columns. Don't mint fake `users` rows (breaks `supabase_auth_id` uniqueness, pollutes member search). Import into the *same* tables via a `kind='imported'` marker, not a separate schema — avoids forking search/unread/RLS logic.
2. Chat attachments aren't real — composer just appends "📎 filename" as text. Needs a real attachments table before Discord's multi-attachment messages can import.
3. Message search is fake at scale — `ilike` leading-wildcard query capped at 10 results inside a 500ms timeout that silently returns empty. A 100k-message archive would be unsearchable. Fix is a `tsvector` column (same migration path RAG will want anyway).

**3 hazards that only fire on insert, easy to miss:**
- `chat_messages` is on the realtime publication — bulk-importing fans out an event per row to every connected client.
- Push worker treats `#announcements`-named channels as "notify all" — importing Discord's #announcements would push-notify the whole chapter per historical message. One-line fix needed first.
- Unread-count logic treats missing read-receipts as `-infinity` — fresh archive shows "47,000 unread" on day one.

**Decided infra notes:** use `IStorageProvider.uploadFile()` (server-side, skips signed-URL/throttle) for the rehost job. Need a separate `chat-archive` storage bucket — live chat's bucket has no video/audio/archive MIME types and a 25MB cap enforced unbypassably at storage-api. Reuse the onboarding wizard's step-machine + card-grid pattern for the role-mapping UI (not a module-toggle screen — that doesn't exist as such).

**Not yet decided:** whether to commit this audit into `docs/` now or wait until the build spec is written. Leaning wait — nothing here is final until Paul signs off on the schema changes (nullable sender_id especially).

---

**PHASE 1 SHIPPED — PR #1228 merged Aug 24.** All 6 blockers/hazards + the storage bucket, done. Nullable sender_id landed (no synthetic users rows, as recommended). Real attachments table + backfill. Real tsvector search. Realtime/push/unread hazards all fixed via SELECT-policy exclusion of kind='imported'. chat-archive bucket live (100MB, wide MIME list). 2094 API tests pass, /diff-review caught 13 issues, 12 fixed pre-merge.

**2 items need your call before Phase 2 (importer):**
1. **DECIDED: dedicated `external_message_id` column**, not a repurposed `client_message_id`. Keeps Discord's snowflake ID separate from the live-chat idempotency key it wasn't designed for.
2. **Hosted project storage limit** — dashboard-only setting, not covered by migrations. Must be manually raised to 100MB or archive uploads >25MB will 413. Add to your human-blockers list.

**1 accepted tradeoff, not a bug:** moderating an imported message (edit/delete/pin) won't show live to other members — it'll appear on their next channel read, not instantly. Documented, not fixed, because fixing it reopens the exact Realtime fan-out problem this phase closed.

---

**PHASE 2 SHIPPED — PR #1242 merged Aug 24. The Discord migration tool is functionally complete.** Admin-runs-DCE architecture as decided: Signet never touches Discord or stores a bot credential. Full flow built: consent gate → browser uploads DCE export straight to storage via signed URLs → background worker parses/imports → channel mapping (asked, never inferred) → role mapping (worksheet only, grants nothing) → per-import purge (deletion promise made real). external_message_id got its own column as decided. 2191 API tests pass, diff-review caught 15 issues including a real cross-chapter data write, all 15 fixed pre-merge.

**Real open items, ranked:**
1. **#1246 — no chapter-deletion path exists anywhere in the product**, and nothing reaps orphaned storage objects generally. The per-import purge built here is currently the *only* deletion mechanism in Signet. Worth a look — this is bigger than Discord migration, it's a general data-governance gap.
2. **#1235 (human, still open)** — hosted Supabase storage limit still caps uploads at 25MB. Now fails visibly per-file at upload time instead of mid-job, but still blocks large archives until you raise it.
3. **#1243 — needs your product call**: no ceiling on how much a chapter can upload into the archive bucket. Deliberately left as an open decision, not a bug.
4. **Never tested against real Discord** — sandbox blocks discord.com/cdn.discordapp.com, so everything shipped is fixture-verified only. First real import should be a supervised run, ideally your own chapter's data.
5. Minor: #1244 (duplicate parser code, cosmetic), #1245 (reactions are stored but not rendered yet).

**Bottom line: the hard requirement for your chapter to adopt Signet is built.** Next real step is a live test run with your actual Discord export.

---

**PHASE 3 SHIPPED — PR #1259 merged Aug 24.** Second path added: one Signet-owned bot, standard OAuth install, native server-side export. Upload path (Phases 1-2) kept fully intact as fallback, not replaced. No new Render service — runs inside existing `frapp-api` cron, as decided.

**Real security catch, fixed pre-merge:** a confused-deputy bug — the original OAuth callback would bind whichever chapter started the flow to whatever Discord server the link recipient happened to authorize, meaning an officer could trick an admin of an unrelated Discord community into leaking that community's history into their own chapter. Fixed with a second one-time confirmation token that only the legitimate browser ever sees. Two independent review passes caught this before it shipped.

**Bonus find:** a pre-existing Phase 2 bug — attachment lookups were unpaged against a 1000-row API cap, silently dropping attachments on imports over that size. Fixed for both paths.

**4 human prerequisites before the bot path actually works (bot token alone isn't enough):**
1. Add `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` to Infisical (global secrets, same as the bot token).
2. Register the redirect URI in the Discord Developer Portal — must match `${API_URL}/v1/discord/connect/callback` exactly, per environment.
3. Enable Message Content Intent in the Discord bot settings (self-serve below 100 servers).
4. Confirm `API_URL`/`APP_URL` are actually reaching `frapp-api` in each environment.

**Not done yet, by design:** private archived threads can't be imported (would need `Manage Threads`, a delete-capable permission — deliberately left off, read-only bot).

---

**STAGING TEST RUN — PR #1262 merged Aug 24.** Testing against real deployed staging (not just fixtures) found a real bug: the OAuth callback could throw a raw 500 instead of always redirecting, discovered because staging is missing the Phase 3 migrations (see blocker below). Fixed, plus 3 regressions a naive fix would've introduced (wrong error message to the admin, no Sentry alert, a useless log line) — caught by review before merge.

**THE ACTUAL BLOCKER, ONLY YOU CAN DO THIS: promote 2 migrations to staging, together, not separately.**
- `20260824140000` (connect flow) and `20260824150000` (the chapter-access check) — the runbook has the exact promotion queries.
- Promoting only the first re-opens the confused-deputy bug from PR #1259 with every check still passing honestly — this is a real footgun, don't split them.
- Until this happens, Discord connect is broken on staging (now fails cleanly instead of 500ing, but still not working).

**2 minor follow-ups filed, not urgent:** #1260 (a request logger already logs the OAuth state token in URLs — pre-existing, low severity), #1261 (`APP_URL` isn't validated, a malformed value would fail late).

---

**FINAL VERIFICATION (Aug 24): branch protection is live, migrations were already fine — the real test is now on you, not an agent.**

- `migration-drift` is now a required check on both `main` and `production`, confirmed by reading live GitHub state back, not trusting the script's own success message.
- The migrations were already on staging (my earlier assumption was wrong) — nothing was pending, so there was nothing left to unblock on that front.
- **The Discord end-to-end test genuinely cannot be run by an agent.** Filed as #1266. Two separate reasons: (1) no staging test account exists yet with `channels:manage` (open ask, #893), and (2) the OAuth bot-connect flow is inherently human-in-the-loop — a real admin has to click through Discord's actual consent screen. No amount of agent access changes that.
- **Unverified, worth double-checking yourself:** whether the Discord secrets you set actually reached staging's runtime — the agent couldn't check this (Render dashboard access needed). Specifically worth re-confirming: **the OAuth redirect URI must point at the API origin (`api-staging...`), not the app/frontend origin** — the runbook flags this as a mistake that's already happened once before.

**What's left is just you, on staging:** log in as an admin, try the upload path (no Discord secrets needed, just an admin session) and the bot-connect path (needs the redirect URI to be exactly right). Use the earlier checklist, pointed at staging instead of local.