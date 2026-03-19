# Invite Controller Tests

## Overview
Added tests for the `InviteController` in `apps/api/src/interface/controllers/invite.controller.ts` to ensure API endpoints properly delegate logic to the underlying `InviteService`.

## Coverage
- `create`: Verifies correct delegation for creating a single invite.
- `createBatch`: Verifies correct delegation for batch generating invites.
- `redeem`: Verifies correct delegation for redeeming an invite.
- `list`: Verifies correct delegation for fetching all chapter invites.
- `revoke`: Verifies correct delegation for revoking an invite.
