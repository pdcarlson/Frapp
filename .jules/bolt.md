## 2026-03-25 - Bulk Insert Optimization in AttendanceService
**Learning:** Found an N+1 query problem where `Promise.allSettled` was used with individual database create calls for marking members as absent. This results in multiple round trips to Supabase which degrades performance significantly, especially for chapters with many members.
**Action:** Replaced `Promise.allSettled(members.map(member => repo.create(...)))` with a bulk insert mechanism utilizing `repo.createMany([...])` which batches all inserts into a single database query using Supabase's array `.insert()` capability.
