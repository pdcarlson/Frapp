# AttendanceController Tests

This document describes the test specifications for the `AttendanceController` in `apps/api/src/interface/controllers/attendance.controller.ts`.

## Coverage

The tests cover all public endpoints of the controller:
- `checkIn` (`POST /events/:eventId/attendance/check-in`)
- `list` (`GET /events/:eventId/attendance`)
- `updateStatus` (`PATCH /events/:eventId/attendance/:userId`)
- `markAutoAbsent` (`POST /events/:eventId/attendance/auto-absent`)

## Test Cases

### `checkIn`
- **Scenario**: Should call `attendanceService.checkIn` with correct parameters.
- **Expected**: `attendanceService.checkIn` is called with `eventId`, `userId`, and `chapterId`.

### `list`
- **Scenario**: Should call `attendanceService.getAttendance` with correct parameters.
- **Expected**: `attendanceService.getAttendance` is called with `eventId` and `chapterId`.

### `updateStatus`
- **Scenario 1**: Should call `attendanceService.updateStatus` with correct parameters, including an `excuse_reason`.
- **Expected 1**: `attendanceService.updateStatus` is called with `eventId`, `userId`, `chapterId`, `status`, `excuse_reason`, and `adminId`.
- **Scenario 2**: Should fallback `excuse_reason` to `null` if not provided in the DTO.
- **Expected 2**: `attendanceService.updateStatus` is called with `excuse_reason` set to `null`.

### `markAutoAbsent`
- **Scenario**: Should call `attendanceService.markAutoAbsent` with correct parameters.
- **Expected**: `attendanceService.markAutoAbsent` is called with `eventId` and `chapterId`.
