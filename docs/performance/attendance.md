# Attendance Performance Optimizations

## Bulk Marking Absences

When marking multiple members as absent (e.g., at the end of a grace period for an event), the system utilizes a bulk database insert mechanism.

Instead of making individual `create` calls for each member, which can result in an N+1 query problem, the `AttendanceService` collects all required absence records and uses the `AttendanceRepository.createMany` method. This delegates to the underlying Supabase `.insert()` capability using an array, efficiently batching the operation into a single network round-trip. This reduces the time complexity for the database interaction from O(N) to O(1).

## Reduced Iteration for Checked-In Members

In `apps/api/src/application/services/attendance.service.ts`, the creation of the `checkedInOrExcused` Set has been optimized to reduce iterations over existing attendance records.

Instead of chaining `.filter()` and `.map()` calls—which involves allocating an intermediate array and iterating through the records twice—the system utilizes a single `.reduce()` operation. This consolidates the filtering and extraction logic into one pass, reducing memory allocations and improving the overall throughput when processing large numbers of attendance records.
