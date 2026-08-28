This can only be done by you — it needs your Discord admin access and can't be verified in a sandbox (Discord is blocked there). This is the true readiness test for the migration tool.

**1. Create a Discord bot for the export**
- Discord Developer Portal → New Application → Bot tab → Add Bot.
- Under Privileged Gateway Intents, enable **Message Content Intent** and **Server Members Intent** — the export will silently come back empty/thin without these.
- Copy the bot token (treat it like a password — you're about to use it once, locally, and never store it anywhere in Signet).

**2. Invite the bot to your chapter's server**
- OAuth2 → URL Generator → scope `bot` → permissions: View Channels, Read Message History. Nothing else needed.
- Use the generated URL to invite it to your server.

**3. Post the in-channel notice**
- Before exporting, post a short heads-up in your server that you're archiving history to migrate to Signet. This is the consent step the wizard will ask you to confirm.

**4. Run DiscordChatExporter locally**
- Install DCE (GUI or CLI — CLI is easier to script if the server has many channels).
- Export all channels with media: `--media --utc -f json` flags, using your bot token. Check DCE's own docs for exact channel/guild targeting syntax.
- Confirm the output folder has a JSON per channel plus a media/attachments folder.

**5. Run the import in Signet**
- Go to `/discord-import` (needs `channels:manage` permission).
- Walk the wizard: Consent → Upload (your browser uploads straight to storage, not through Signet's servers) → Channels (map each Discord channel to a Signet channel — nothing is auto-merged) → Roles (worksheet only, doesn't grant anything) → Review.
- Watch the progress bar; it runs as a background job.

**6. Verify after import**
- Spot-check message timestamps are the original Discord dates, not import date.
- Confirm attachments/images actually load.
- Confirm a regular member account sees the imported messages, and that they didn't trigger a flood of push notifications.
- If anything looks wrong, the per-import purge (`DELETE /discord-imports/{id}`) cleanly removes just that import — safe to retry.

**Known limits going in:** files over 25MB will fail per-file until #1235 (storage limit) is raised. Large servers may take a while — no confirmed real-world timing yet, only fixture data was tested.

**After this works:** the Discord migration requirement is genuinely done, and beta scope should be fully clear. Report back what breaks — if the real export throws something the fixtures didn't cover, that's the next thing to fix.