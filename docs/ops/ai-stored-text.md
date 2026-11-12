# Stored AI text: the Ask diagnostics window

Frapp keeps no prompt or answer text, with the exceptions in [`spec/behavior/ai.md` § Stored AI text](../../spec/behavior/ai.md#stored-ai-text). This page is how the one that is built works in operation: the 14-day beta diagnostics window on Ask Frapp (#4315, ADR-28 decision 8). The rules are the spec's; the table shapes are the migration's (`20261112200000_ai_ask_diagnostics.sql`).

## What has to be true before anything is kept

All of these, together:

1. The server has AI on (`AI_ENABLED`).
2. The server holds a key, `AI_STORED_TEXT_KEY`. There is no plaintext fallback: with no key, nothing is stored.
3. The server names one chapter, `AI_DIAGNOSTICS_CHAPTER_ID`. Only that chapter's AI settings page shows the row.
4. That chapter's president starts the window from Chapter settings, AI, and confirms. The yes is written to the chapter's audit log, and the end date is fixed 14 days out. Nothing extends it.
5. The member's Ask panel showed the "saved for the Frapp team" line before the question was sent. A client that does not know about the window never has an answer kept.
6. The answer had no channel messages in front of the model, and Ask was not refused before it began.

The names of the two variables and where each is read are in [`ENV_REFERENCE.md`](../internal/environment/ENV_REFERENCE.md).

## What is kept, and when it goes

One row per exchange in `ai_diagnostics_exchanges`: who asked (ids), when, and one sealed value holding the question, what the model wrote, the names of the sources it was given, the tools it used, the model and prompt version. It is sealed with AES-256-GCM under the server's key, bound to the chapter, so a row moved to another chapter does not open.

A row is deleted when:

- the window reaches its end date (a sweep runs every ten minutes, whether or not AI is still on);
- the president stops the window early, which deletes everything it kept;
- the member who asked leaves the chapter, deletes their account, or answers No on the AI sheet;
- the chapter is deleted.

## Turning it off, and moving it to another chapter

The order matters, because the row in Chapter settings is drawn only for the chapter the server names:

1. The president stops the window in Chapter settings, AI. Everything kept is deleted at once.
2. Then unset `AI_DIAGNOSTICS_CHAPTER_ID` in Infisical, or point it at the next chapter, and redeploy the API.

If the variable was changed while a window was still open, nothing more is kept for the old chapter and the sweep still deletes its rows at the end date. Its president no longer sees the row, so to delete sooner run `delete from public.ai_diagnostics_windows where chapter_id = '<chapter id>';`. Until that row is gone the new chapter's president cannot start a window (the table holds one window at a time, and the API answers `ai.ask.diagnostics.already_on`). `POST /v1/ai/ask/diagnostics/stop` itself still works for the old chapter's president while its window exists and `AI_ENABLED` is on.

## Setting the key

The value is `<key id>:<base64 of 32 random bytes>`, for example an id of `k1`. Generate the bytes with `openssl rand -base64 32`. It is an app secret, so it goes in Infisical, never on Render directly ([`SECRETS_MANAGEMENT.md`](../internal/environment/SECRETS_MANAGEMENT.md)). Production and staging get different keys.

To rotate: put the new key first and keep the old one after it, separated by a comma. New rows seal with the first key and old rows still open. Drop the old key once no row sealed with it is left, which is 14 days at most for this window.

## Reading what was kept

No API serves this text. A Frapp team member reads it on their own machine:

1. Export the rows from the database as one JSON object per line with `chapter_id` and `sealed`, for example from the Supabase SQL editor:

   ```sql
   select json_build_object('chapter_id', chapter_id, 'sealed', sealed)
   from ai_diagnostics_exchanges
   order by created_at;
   ```

2. With `AI_STORED_TEXT_KEY` set in that shell (from Infisical, not typed as an argument), pipe the lines through the reader from `apps/api`:

   ```sh
   npm run -s ai:open-diagnostics < rows.jsonl
   ```

   It prints each exchange as a line of JSON and exits non-zero if a row could not be opened, saying why without printing the row.

Treat the output as the stored text it is: don't paste it into an issue, a PR, Sentry, PostHog or a chat, and delete the export and the output when the question is answered. The rows themselves are gone on the window's end date.
