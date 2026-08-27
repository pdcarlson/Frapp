Context: we're scoping a Discord data migration tool. Decided approach (see research): admin adds a bot to their Discord server, we run DiscordChatExporter (bot token) to produce JSON + downloaded media, then a Signet-side importer parses that JSON into a read-only, searchable, per-channel archive tied to the chapter tenant. No live sync, no thread reconstruction — just preserve history and make it readable/searchable.

Before I write a build spec, audit the current codebase for import-readiness. This is a status check, not a build task — don't write the importer yet.

1. **Chat data model** — what does the current messages/channels schema look like (packages/chat-core or wherever it lives)? Could an "archived/imported" message coexist with live Signet messages in the same tables, or does it need a separate archive schema? Does the schema support a message that has no live Signet author (just a display name/avatar snapshot), since Discord authors won't map to Signet accounts at import time?

2. **File storage** — how does Signet currently store uploaded files (chat attachments, documents, backwork)? What's the upload path, storage backend, and any size/type limits that a bulk rehost job would need to respect or bypass? Is there an existing bulk-upload or background-job pattern we could reuse for rehosting potentially thousands of files?

3. **Tenant scoping** — confirm every relevant table enforces chapter_id scoping already (this matters more than usual here since we'd be bulk-writing another platform's data at scale). Any existing pattern for a chapter-scoped background/async job (something like a job queue, or is everything currently request-response only)?

4. **Roles/permissions** — what does the current role/permission model look like, and is there anything resembling an "admin mapping UI" pattern already in the codebase (e.g., the onboarding wizard's module-toggle screen) we could reuse for a "map Discord role → Signet role" step?

5. **Search readiness** — is there any existing full-text search or search-index infrastructure on messages/documents already, or would a searchable archive need to build search from scratch? This matters for RAG too, worth noting overlap.

6. **Existing scaffolding** — grep for any prior Discord-related code, env vars, or bot tokens already in the repo (sometimes half-started things get forgotten). Also check if there's an existing background job runner (cron, queue, worker) we'd hook a long-running export/import into, since this won't be a synchronous request.

Report back: what exists and is reusable, what's missing and needs to be built new, and any schema changes that should happen before writing the importer (e.g., a nullable author_id + a display-name-snapshot column) rather than after.