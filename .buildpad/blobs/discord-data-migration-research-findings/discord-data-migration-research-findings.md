# Discord data migration: research findings

**Bottom line: buildable by a solo dev, MVP is a one-time read-only archive import, not live sync.** A bot with `READ_MESSAGE_HISTORY` can retroactively read full channel history — no "install-forward only" limit. A mid-size chapter server (80-150 members) exports in minutes-to-low-tens-of-minutes.

**Critical technical gotcha:** attachment CDN links expire (~24hrs, signed URLs). Must download-and-rehost every file in the same job that reads messages, or files are silently lost.

**Legal: bot token = defensible, user token/self-bot = actively banned.** Discord has shut down self-bot scraping (Spy.pet case, real enforcement). A bot-authorized, owner-directed, one-time export for data portability sits in defensible gray-area under Discord's Developer Policy — the compliance gate is purpose/retention, not volume. Must: frame as data-portability triggered by the admin, not growth-hacking; offer deletion path (already fits Signet's tenant model); post an in-channel notice before running export as a consent norm.

**Don't build the exporter from scratch — use DiscordChatExporter (DCE).** Mature, bot-token-compatible, exports JSON with `--media` flag for attachments. Signet's job is just the importer: parse DCE's JSON into Signet's schema, rehost attachments, done. This roughly halves the build.

**Role/identity mapping should be manual/admin-assisted, not automated** — every real precedent (Discord→Slack, →Matrix, →Guilded) treats this as non-automatable. Pattern: import Discord role list as reference data, admin maps "Discord role → Signet permission set" during onboarding, defaulting everyone to Member first (matches Signet's existing onboarding design).

**Recommended MVP build:**
1. Admin adds Signet bot to Discord server (one-time auth, needs MESSAGE_CONTENT + GUILD_MEMBERS intents)
2. DCE exports all channels to JSON with media download on
3. Signet importer ingests JSON, rehosts attachments to Signet storage, stores messages as immutable per-channel searchable archive tied to the chapter tenant
4. Admin-assisted role/identity mapping UI
5. In-channel notice pre-export + deletion path for compliance

**Why this scope is right:** more legally defensible than ongoing sync, sidesteps the CDN-expiry problem entirely, reuses a proven tool for the hard/fiddly part, and the resulting searchable archive is exactly the kind of corpus the RAG/"Ask your chapter anything" feature will want to index later — not throwaway migration plumbing.

**Explicitly defer/drop:** live bidirectional sync (multiplies engineering, re-triggers ToS "ongoing mining" concern, chapter doesn't need it once switched over).

**Open uncertainty, worth a light check before marketing this feature:** current enforcement climate for bot-token bulk export specifically (crackdown reports found so far are concentrated on user-token/self-bot use, not bot-authorized export).