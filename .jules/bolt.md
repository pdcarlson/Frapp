## 2024-03-14 - Optimize Bulk Inserts with Supabase
**Learning:** Performing multiple individual `.insert()` operations via `Promise.allSettled` or `Promise.all` causes significant N+1 request overhead over the network, leading to performance bottlenecks when marking bulk attendances.
**Action:** Always use Supabase's array `.insert([])` capability via a `createMany` repository method to execute a single query for bulk creations instead of looping single creates.
