Read-only audit, don't touch source — Cursor agents are mid-flight in worktrees on Wave 1 items right now.

Check current real status of each item below against the live repo/GitHub, not against any earlier canvas note (things may have moved since Aug 19):

1. **#805** — is `custom_access_token_hook` enabled in staging and prod? This is the single highest-priority item: without it, no production token carries `active_chapter_id` and the app can't render chapter data at all.
2. **#938** — EAS dev build done? Gates all push/Stripe mobile testing.
3. **#1033** — is `EVENT_CHECK_IN_TOKEN_SECRET` set? QR check-in returns 503 without it.
4. **#806 / #1064** — Stripe publishable key configured?
5. **#919** — deployed DB schema drift vs migrations, is this resolved or still open?
6. **#958** — mobile join/first-run wizard, still the one missing screen pair?

For each: open/closed, and if open, what's actually blocking it (config/secret Paul needs to set vs. code work vs. unclear).

Also flag: has anything from Wave 1 (items 3, 4, 9, 6, currently in flight) touched any file relevant to these 6 items? Should not have, but confirm.

Report back a simple table: item, status, what's actually left, who needs to act (Paul vs. an agent).