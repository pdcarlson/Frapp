Context: Phase 1 (PR #1228, merged) built the schema foundation — nullable sender_id + author snapshot fields, chat_message_attachments, tsvector search, and the kind='imported' insert-time safety fixes (realtime, push, unread). None of that imports anything yet. This phase builds the actual importer.

**Decision from Phase 1's flagged review item:** add a dedicated `external_message_id` column on chat_messages (not a repurposed client_message_id) to hold the Discord message snowflake. Scope the dedupe/idempotency index to this new column.

Build:

1. **Migration: `external_message_id`**
   - Add `external_message_id text` to chat_messages, unique per channel (nullable — only imported rows have it), indexed for importer dedupe/re-run safety (NULLS NOT DISTINCT, same pattern Phase 1 used).

2. **Admin flow: connect + export**
   - Admin-facing screen (web, admin-gated) where the chapter admin authorizes a bot invite to their Discord server and kicks off an export. Store the bot token securely (check how other secrets are stored/injected in this repo, e.g. Infisical pattern, don't invent a new one).
   - Run DiscordChatExporter (bot token, `--media` on) as a background job — this is a long-running job, not a request-response call. Use whatever job runner exists in the repo (check first; Phase 1's audit found no queue existed — if still true, scope the minimum viable background-job mechanism rather than a full queue system).
   - Progress reporting the admin can see (percent done or channel-by-channel status), since a chapter's history could take minutes to tens of minutes.

3. **Importer: parse DCE JSON → Signet schema**
   - Map each Discord channel to a Signet chat_channel (new or existing, admin's choice — don't force auto-creation of duplicate channels if one with a matching name already exists, ask instead of guessing).
   - Map each Discord message to chat_messages with kind='imported', author_name/author_avatar_path/author_external_id from the Discord author, external_message_id from the Discord snowflake, correct historical timestamp (not import time).
   - Rehost every attachment from DCE's downloaded media into the new chat-archive bucket via IStorageProvider.uploadFile(), write chat_message_attachments rows pointing at the new location — never store or rely on the original Discord CDN URL.
   - Preserve reactions if the schema supports them; if not, note it as a gap rather than silently dropping.
   - Idempotent re-run: running the same export twice must not duplicate messages (use external_message_id + channel as the dedupe key).

4. **Admin UI: role mapping**
   - Reuse the onboarding wizard's step-machine pattern (WizardStep union + STEP_ORDER + StepDots) and ArchetypeStep's card-grid interaction, per the Phase 1 audit's recommendation, for a "map each Discord role to a Signet permission set" step. Default: everyone imported as Member, admin promotes after — consistent with Signet's existing onboarding model. This mapping only needs to inform future manual promotion, not automatically grant permissions from Discord data.

5. **Consent/compliance step**
   - Before the export runs, require the admin to confirm they've posted an in-channel notice to their Discord server (a checkbox + short copy, not enforced technically, just a deliberate friction point) — per the legal research's recommended consent norm.
   - Confirm chapter-level deletion of imported archive data is possible (should already follow from tenant deletion, but verify explicitly).

Out of scope for this phase: identity-matching Discord authors to existing Signet accounts (ship with author_name/avatar only for now, that's a fast-follow); live/ongoing sync (explicitly rejected in research).

For each item: write tests, flag ambiguity instead of guessing, report what shipped vs. what needs a follow-up issue. Run `/diff-review` before merge given the insert-at-scale and file-handling risk surface here.