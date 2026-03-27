## 2026-03-27 - Optimize sequential database queries
**Learning:** Backend service methods often perform sequential `.findById` or `.findByChapter` lookups when resolving multiple entities (e.g., currentMember, targetMember, and roles), leading to N+1-like network roundtrips to Supabase.
**Action:** Use `Promise.all` to parallelize independent database queries and updates to significantly reduce overall latency during complex workflows like role transfers.
