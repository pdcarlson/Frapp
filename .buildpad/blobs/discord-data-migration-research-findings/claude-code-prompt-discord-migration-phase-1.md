Context: building a Discord data migration tool. Decided approach: bot-token export via DiscordChatExporter, import into a read-only searchable archive living in the SAME chat_messages/channels tables as live Signet chat (marked via a kind='imported' value), not a separate schema. Audit (Aug 23) found 3 schema blockers and 3 insert-time hazards that must be fixed before the importer can be written. This prompt is schema/foundation only — do not build the DCE-JSON importer itself yet, that's Phase 2.

**One product decision baked in below, flag it back to me if you disagree before merging:** sender_id becomes nullable rather than minting synthetic users rows for Discord authors. This was the audit's explicit recommendation (synthetic users rows break supabase_auth_id uniqueness and leak into member search).

Build the following:

1. **Migration: chat_messages author fields**
   - Make sender_id nullable.
   - Add author_name (text), author_avatar_path (text, nullable), author_external_id (text, nullable — stores the Discord user id for future re-matching/dedup).
   - Add a check: sender_id IS NOT NULL OR author_name IS NOT NULL (every message has a byline one way or the other).
   - Update every read path that currently assumes sender_id is always present (message list rendering, search results, any join) to fall back to author_name/author_avatar_path when sender_id is null.

2. **Migration: real chat attachments table**
   - Create chat_message_attachments (id, message_id fk, storage_path, filename, mime_type, size_bytes, width/height nullable for images, created_at). Chapter-scoped via the parent message's channel.
   - Update the composer path (composer.tsx) to write real attachment rows instead of appending "📎 filename" as text — fix this for live chat too, not just for imports, since it's the same bug either way.
   - Add the tenant-scope spec required by tenant-scope-coverage.spec.ts.

3. **Migration: real search**
   - Add a tsvector generated column on chat_messages (content + author_name), GIN indexed.
   - Rewrite searchMessages to query the tsvector column instead of the current ilike + 500ms-race-to-empty pattern. Keep result cap reasonable but don't silently return empty on timeout — if a query is genuinely slow, that's a bug to surface, not hide.

4. **Fix: push-worker announcements bug**
   - In push-rules.ts, defaultLevelFor returns 'all' for any channel literally named "announcements" — this needs a real explicit-opt-in check instead, since importing Discord's #announcements would notify the whole chapter per historical message. Add an early-exit for kind='imported' messages alongside the existing system_audit exit, same pattern.

5. **Fix: unread counts on fresh archive**
   - get_channel_unread_counts must not return a huge/negative-infinity-derived count when there's no read receipt for a channel that predates the user's membership (i.e., an imported archive). Treat "channel created before I existed" as zero unread, not everything-unread.

6. **Fix: realtime fan-out on bulk insert**
   - Bulk-importing tens of thousands of rows into chat_messages must not fan out an event per row over supabase_realtime to every connected client. Find the right mechanism (batched inserts outside the publication path, a bulk-import flag that's realtime-excluded, or equivalent) — investigate what Supabase supports here and pick the least-invasive option.

7. **New storage bucket: chat-archive**
   - Create a separate bucket (not the existing chat bucket) sized/typed for Discord media: allow video/audio/archive MIME types the live chat bucket doesn't, and confirm the size cap makes sense for real-world Discord attachments (check what Discord's own attachment size limits are and set ours at least that high). Use IStorageProvider.uploadFile() (server-side path) for the rehost job, not the client signed-URL flow.

For each item: write tests, note anywhere a decision was ambiguous rather than guessing, and report back what shipped vs. what needs a follow-up issue filed.