# Performance Optimizations

## 2024-03-19 - Attendance markAutoAbsent Bulk Insert
Resolved an N+1 query issue in the `markAutoAbsent` method of `AttendanceService` (located in `apps/api/src/application/services/attendance.service.ts`).

### Issue
Previously, the service looped through all required members and executed an `await this.attendanceRepo.create(...)` for each member that needed an ABSENT record. This resulted in a separate database round-trip for each insertion, leading to linear degradation in performance as the number of members in a chapter increased.

### Fix
*   Introduced a new `createMany(data: Partial<EventAttendance>[]): Promise<void>` method in the `IAttendanceRepository` interface.
*   Implemented `createMany` in `SupabaseAttendanceRepository` using Supabase's native array `.insert()` to execute a single bulk SQL insert.
*   Refactored `markAutoAbsent` to accumulate the necessary absent records in an array and dispatch a single `createMany` call.

This optimization ensures that the auto-absent process remains fast and scales efficiently regardless of chapter size.
