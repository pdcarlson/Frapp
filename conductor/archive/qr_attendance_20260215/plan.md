# Implementation Plan: QR Attendance System

## Phase 1: QR Token Service
- [x] **Task:** Implement `QrTokenService` in `application/services`.
    - **Logic:** `generateToken(eventId, chapterId)`. Use `jsonwebtoken` or `@nestjs/jwt`.
    - **Logic:** `validateToken(token)`. Returns payload or throws `UnauthorizedException`.
- [x] **Task:** Write unit tests for `QrTokenService` (mocking the JWT signing/verifying).

## Phase 2: Integration with Attendance
- [x] **Task:** Update `AttendanceService` (or create `QrAttendanceService` wrapper).
    - **Logic:** `processQrCheckIn(userId, token)`.
- [x] **Task:** Write unit tests ensuring `AttendanceService.checkIn` is called correctly upon valid token.

## Phase 3: Interface Layer
- [x] **Task:** Add endpoints to `EventController`.
    - `GET /:id/qr` (Guarded by Admin role).
    - `POST /:id/qr-check-in`.
- [x] **Task:** Define DTOs (`QrCheckInDto`).
- [x] **Task:** Write E2E tests for the full flow: Generate -> Scan -> CheckIn.

## Phase 4: Finalization
- [x] **Task:** Update Swagger documentation.
- [x] **Task:** Ensure >80% test coverage.
- [x] **Task:** Run final Build, Lint, and Type checks.
- [x] **Task:** Conductor - Final Track Verification
