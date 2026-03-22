# AttendanceService Tests

This document outlines the testing strategy and coverage for the `AttendanceService` in `apps/api/src/application/services/attendance.service.ts`.

## Coverage

- **checkIn**: Tested for success within grace period, rejection when outside window, role restrictions, rollback on point transaction failure, missing events, and conflicts.
- **getAttendance**: Tested for successfully returning records. Tested edge case where event does not exist strictly asserts `new NotFoundException('Event not found')`.
- **updateStatus**: Tested for successful updates, missing events, and missing records.
- **markAutoAbsent**: Tested for mandatory and role-targeted events, verifying it skips users already marked or absent, and rejects calls before grace period ends. Refactored to use `createMany` bulk database inserts to improve performance and avoid N+1 queries, with updated test assertions to match.
