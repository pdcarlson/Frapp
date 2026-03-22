# Invite Service Tests

## Overview
Added and updated tests for the `InviteService` in `apps/api/src/application/services/invite.service.ts`.

## Coverage
- `redeem`: Added test explicitly asserting a `ConflictException` is thrown when an existing member tries to redeem an invite.
- Added test verifying a `GoneException` is thrown when an invite is not found.
- Added test verifying a `GoneException` is thrown when an invite cannot be atomically claimed.
- Added test verifying member is created with an empty role array if a matching role, or the default `Member` role, is not found in the chapter.
