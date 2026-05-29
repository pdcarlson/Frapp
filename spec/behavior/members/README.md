# Member Directory and Profiles

- Every chapter has a searchable member directory.
- Each member has a profile card showing: display name, profile photo, role(s), point balance, join date, and optional bio.
- Profile photos are stored in Supabase Storage under `chapters/{chapter_id}/profiles/{user_id}`.
- Members can edit their own display name, bio, and profile photo. Admins with `members:view` permission can view all profiles.
- Search by name, role, or join date.
