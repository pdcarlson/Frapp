# Attendance Performance Optimizations

## Bulk Marking Absences

When marking multiple members as absent (e.g., at the end of a grace period for an event), the system utilizes a bulk database insert mechanism.

Instead of making individual `create` calls for each member, which can result in an N+1 query problem, the `AttendanceService` collects all required absence records and uses the `AttendanceRepository.createMany` method. This delegates to the underlying Supabase `.insert()` capability using an array, efficiently batching the operation into a single network round-trip. This reduces the time complexity for the database interaction from O(N) to O(1).

`markAutoAbsent` therefore issues **one** write, asserted by `apps/api/src/application/services/attendance.service.spec.ts`. A second note in this directory described running the per-row creates concurrently with `Promise.allSettled` instead, which would still make N round-trips; that is not what the code does, and it was deleted rather than reconciled.
