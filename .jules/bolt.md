## 2024-05-18 - Optimize Sequential Database Operations
**Learning:** Sequential database queries and updates (like fetching members then sequentially fetching users and points) in NestJS services cause N+1-like network roundtrips to Supabase, unnecessarily inflating response times.
**Action:** Use `Promise.all` to parallelize independent database reads and writes to minimize total latency and reduce blocking time.
## 2026-03-29 - Optimize Roster Report Sequential Fetch
**Learning:** The `getRosterReport` method fetched `members`, then fetched `users` and `point_transactions` concurrently, but still fetched `roles` sequentially afterwards even though its dependencies (`members`) were already resolved.
**Action:** Adding the `roles` fetch directly into the concurrent `Promise.all` alongside `users` and `point_transactions` eliminates an unnecessary network roundtrip.
