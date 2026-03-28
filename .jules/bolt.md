## 2024-05-18 - Optimize Sequential Database Operations
**Learning:** Sequential database queries and updates (like fetching currentMember, targetMember, and roles) in NestJS services cause N+1-like network roundtrips to Supabase, unnecessarily inflating response times.
**Action:** Use `Promise.all` to parallelize independent database reads and writes to minimize total latency and reduce blocking time.
