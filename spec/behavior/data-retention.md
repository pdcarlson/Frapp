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
