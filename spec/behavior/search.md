# Global Search

A single search bar accessible from the top of the mobile and web app:

- Searches across: Backwork resources (title, department, course, professor, tags), chat messages (content), events (name, description), and members (name).
- Results are grouped by domain (Backwork, Chat, Events, Members).
- All results respect chapter scoping and permission checks (chat messages from channels the user cannot access are excluded).
- Implementation: Postgres full-text search (`tsvector` / `to_tsquery`) on relevant columns.
