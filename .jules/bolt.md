
## 2024-03-23 - Replaced N+1 Promise.allSettled with createMany in Supabase
**Learning:** Found an N+1 insertion bottleneck in `AttendanceService.markAutoAbsent` using a loop of `this.attendanceRepo.create` with `Promise.allSettled`. This was replaced by adding a `createMany` method on the repository that leverages Supabase's `insert` with an array to perform a single bulk insert query.
**Action:** When implementing bulk insertion or updates, look for `.map` with `Promise.allSettled` or `Promise.all` calling single `.create` methods and replace them with a `createMany` bulk operation using Supabase array `.insert()`. Ensure the method signature specifies returning `Promise<void>` when we only need confirmation of completion.
