## 2024-05-18 - Optimize Sequential Database Operations
**Learning:** Sequential database queries and updates (like fetching members then sequentially fetching users and points) in NestJS services cause N+1-like network roundtrips to Supabase, unnecessarily inflating response times.
**Action:** Use `Promise.all` to parallelize independent database reads and writes to minimize total latency and reduce blocking time.

## 2024-03-24 - Optimize DB fetch using Promise.all
**Learning:** Sequential DB operations without transactional guarantees, like fetching `currentMember` and `targetMember` separately before transferring presidency, result in unnecessary N+1 network roundtrips.
**Action:** Identify adjacent DB fetch or update statements that don't depend on each other and combine them using `Promise.all` to execute concurrently, lowering overall request latency.
