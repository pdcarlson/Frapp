# StudyController Test Specification

## Components Tested
- `StudyGeofenceController`: Handles geofence creation, reading, updating, and deletion.
- `StudySessionController`: Handles study session initiation, heartbeat events, stopping, and listing.

## Guard Coverage
The following dependencies/guards are properly mocked to simulate real application contexts without hitting an actual database:
- `SupabaseAuthGuard`: Authentication check.
- `ChapterGuard`: Verifies chapter association.
- `PermissionsGuard`: Authorization check.

## Coverage Summary
The `study.controller.spec.ts` covers the payload mapping of routes and verifies the appropriate underlying `StudyService` methods are called with matching parameters for both the Geofence and Session controllers.

## Expected Behavior Verified
- Controllers correctly instantiate.
- Controllers extract route parameter payload components successfully and pass them transparently to business logic layers (e.g. `userId`, `chapterId`, `geofenceId`, `lat`, `lng`).
