# Research: single-bot Discord export feasibility

**Verdict: buildable and a real UX win, but trades 3 solvable infra blockers for 1 external one Discord controls, not us.**

**All 3 original blockers dissolve under a single Signet-owned bot (not per-chapter):**
1. Credential storage — one global bot token = same secret-storage pattern already used for Stripe keys. Not a per-tenant problem anymore.
2. No .NET runtime — a native paginated fetch (`GET /channels/{id}/messages`, before/after cursors) in plain Node is ~20-40 lines. `@discordjs/rest` handles rate-limiting automatically, REST-only with no gateway/websocket needed. DCE isn't required at all.
3. Render free-tier limits — real, but a plan cost, not a wall: needs a paid Background Worker (~$7/mo, 512MB), not the free tier (which doesn't support background workers and spins down web services after 15 min idle). Must stream messages/attachments page-by-page, never buffer in memory.

**OAuth confirmed exactly as hoped:** admin clicks "Add to Server" → Discord's own consent screen → done. No token ever touches the admin. Retroactive full history still works (permission-gated, not join-date-gated).

**The new blocker this trades in: Discord's own approval gates.**
- Bot verification required at 100 servers.
- Message Content Intent review required at ~10,000 unique users — without it, message content/attachments return empty, breaking the export entirely.
- This is a single point of failure across every chapter at once, and a bot whose whole purpose is bulk-exporting message content to a paid competing platform is close to the profile Discord's reviewers are most skeptical of. One data point found: a ticket-transcript bot was denied Message Content Intent twice with a category-level "we don't want bots like this" response — a real warning sign, not proof of denial.
- Below the threshold (~100 chapters), this is entirely blocker-free.

**Recommendation:**
1. Build the single-bot + native REST export — works with zero friction through beta and early growth.
2. Host on a paid Render Background Worker, stream everything, never buffer.
3. Apply for Discord verification early (eligible from 75 servers) and treat approval as a real product risk, not a formality.
4. Keep the already-shipped admin-owned-bot/DCE path (Phase 1+2) as a fallback — it's nearly free to retain since the schema/importer/mapping UI is already built against an upload flow. If the shared bot is ever throttled or denied, chapters fall back to self-export.
5. Close #1246 (no chapter deletion path) before Signet becomes the sole operator of every chapter's Discord data — Discord's Developer Terms make deletion-on-request a contractual obligation.

**Open unknowns:** real approval odds for an export/archival (not moderation) bot — untested; CDN download bandwidth limits at 100k-300k message scale with video — undocumented, only resolved by an actual test run.