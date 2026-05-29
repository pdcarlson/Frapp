# Data Retention

## Chapter Cancellation

- When a chapter's subscription is canceled, all data is preserved **indefinitely** in read-only mode.
- Members can still log in and view all existing data (chat history, Backwork, points, events, etc.) but cannot create new content, invite members, or perform any write operations.
- If the chapter re-activates (resumes payment), full access is restored immediately with no data loss.

## Individual Account Deletion

- On request (via settings or support), a user's personally identifiable information (PII) is scrubbed: email, display name, bio, avatar, profile photo.
- Their point transactions, attendance records, chat messages, and service entries are preserved but **anonymized** — attributed to "Deleted User" with a null user reference.
- The user's Supabase Auth account is deleted.
- This is irreversible.

## Inactive Chapter Cleanup

- Frapp reserves the right to delete data for chapters that have been inactive (canceled subscription, no logins) for more than 2 years.
- This is documented in the Terms of Service.
- Before deletion, an email notification is sent to the last known admin email with a 30-day warning.

## Analytics Events (Pseudonymous)

Frapp ships product analytics (PostHog or equivalent) to measure feature usage and find bugs. The pipeline is pseudonymous by construction:

- **User identity is a hash.** Events are keyed by `hmac_sha256(salt, user_id)`. The raw `user_id` is never sent to the analytics provider.
- **Per-environment salt held outside the analytics provider.** The HMAC salt is provisioned per environment (prod / staging / local) and stored as a secret in the same secret store as other credentials — **not** in the analytics provider's environment. Compromise of the analytics dataset cannot be rainbow-tabled back to user IDs without access to the secret store.
- **Chapter-level opt-out.** Chapter presidents can disable analytics for their chapter via chapter settings. When opted out, the client emits zero events for that chapter's members regardless of the active environment. Opt-out is enforced client-side at the SDK boundary and server-side as a defense-in-depth check before any server-originated event is sent.
- **Event payloads exclude content.** Event names and properties describe behavior ("opened-channel", "ran-slash-command"), not content. Message bodies, document contents, transcript text, and personal-information fields are never sent.
- **Account deletion clears the pseudonym mapping.** When a user account is deleted (per the *Individual Account Deletion* section above), the user's hashed ID is added to the analytics provider's "deleted users" list, which triggers a delete-all-events workflow for that hash.
