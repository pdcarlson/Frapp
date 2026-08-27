Context: Phases 1-2 (#1228, #1242) built the schema, importer, admin wizard, and consent/purge flow for Discord migration, fed by an admin-run DiscordChatExporter export the admin uploads manually. Research confirmed a simpler path: one Signet-owned Discord bot, installed per-chapter via standard OAuth "Add to Server" (no token ever touches the admin), with a native server-side export replacing DCE entirely. This phase adds that path as a second, easier option — it does NOT replace or delete the existing upload flow, which stays as a fallback if Discord ever throttles or denies the shared bot at scale.

**Correction: no new Render service.** A separate Background Worker needs a paid plan (~$7/mo) we're not taking on right now. Phase 2's importer already runs its chunked job inside the existing `frapp-api` service via `@nestjs/schedule`/`ScheduledJobsModule` — reuse that same in-process cron pattern for the export job instead of standing up new infra. This means the export job shares the API's existing RAM/CPU with live traffic, so the streaming/chunking discipline below isn't optional — it's what keeps this from starving the API. If contention becomes a real problem later, the fix is upgrading the existing API service's plan, not adding a second service.

**Human prerequisites — I will do these before this prompt can be run, flag back if anything else is needed first:**
1. Register a Discord Application + Bot in the Discord Developer Portal, owned by Signet (not a chapter).
2. Generate the bot token, store it in Infisical as a new global secret (one value, all environments) — same pattern as existing secrets like Stripe keys, not per-tenant.
3. Configure the bot's OAuth2 settings: scope `bot identify guilds`, permissions bitfield for View Channels + Read Message History only.
4. NOT doing yet: applying for Discord bot verification / Message Content Intent review — unnecessary below ~100 servers, revisit before that threshold.

Build:

1. **"Connect Discord" flow (web, admin-gated on `channels:manage`)**
   - Generate the Discord OAuth authorize URL with combined `bot identify guilds` scopes and the fixed permissions bitfield.
   - On callback, use the `identify`/`guilds` scopes to verify the authorizing user actually has Manage Server (or Administrator) permission on the guild they're connecting — do not trust the client-supplied guild id alone, same class of bug as the cross-chapter write #1242's review caught.
   - Store the chapter ↔ Discord guild_id mapping (new column/table — chapter-scoped, RLS as usual). This is the only "credential" per chapter: a guild id, not a secret.
   - Offer this as an alternative to the existing upload flow in the `/discord-import` wizard, not a replacement — same consent step applies either way.

2. **Native export job (new, replaces DCE for this path only)**
   - Use `@discordjs/rest`, REST-only (no gateway connection needed), with the global bot token from Infisical.
   - Paginated fetch per channel: `GET /channels/{id}/messages` walking backward via `before` cursor until a page returns fewer than the requested limit. Also enumerate archived threads (public + private) via their dedicated endpoints — don't silently skip them.
   - Verify every fetched message's guild/channel actually belongs to the chapter-authorized guild_id before writing anything — re-derive from the API response, not from client input.
   - Stream attachments directly from Discord's CDN into the existing `chat-archive` bucket via `IStorageProvider.uploadFile()`, using a readable-stream pipe — never buffer a full file in memory. Reuse the existing manifest/dedup pattern from Phase 2 where possible.
   - Feed the fetched messages into the SAME parser/mapper Phase 2 built for DCE JSON if at all possible — transform API responses into that intermediate shape rather than writing a second importer. If the shapes don't line up cleanly, extract the shared downstream logic (message → chat_messages row mapping) into a common function both paths call.
   - Run as a Cron-based chunked job inside the existing `frapp-api` service, same 45s-slice/cursor/lease pattern as the existing importer worker — must survive restarts and be resumable, not a single long-lived synchronous call. Be conservative with memory given this now shares a process with live API traffic.

3. **Reuse everything downstream unchanged:** consent gate, channel mapping (asked, never inferred), role mapping worksheet, per-import purge. This phase only changes how bytes get from Discord into Signet, not what happens after.

4. **Rate limit and error handling**
   - Respect `@discordjs/rest`'s built-in rate-limit handling; don't hand-roll retry logic.
   - If Discord returns empty message content (would indicate a missing/unapproved intent, or a scope problem), fail loudly with a clear error rather than silently importing empty messages.

5. **Keep the DCE upload path fully intact** — this is a second option in the wizard, not a migration off the first one.

For each item: write tests, flag ambiguity instead of guessing, report what shipped vs. what needs a follow-up issue. Run `/diff-review` before merge — this path reintroduces cross-tenant risk in a new place (one shared bot touching every chapter's data) so tenant-isolation checks deserve extra scrutiny.