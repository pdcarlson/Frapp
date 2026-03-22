# Points Controller Specification

The points controller provides the HTTP interface for points management and querying within the Frapp platform.

## Endpoints

### `GET /points/me`
Gets the current user's point summary.
- Takes an optional `window` query parameter (`all`, `semester`, or `month`), defaulting to `all`.

### `GET /points/leaderboard`
Gets the chapter leaderboard.
- Takes an optional `window` query parameter (`all`, `semester`, or `month`), defaulting to `all`.

### `GET /points/members/:userId`
Gets a specific member's point summary.
- Protected by `PermissionsGuard` and requires `SystemPermissions.POINTS_VIEW_ALL`.
- Takes an optional `window` query parameter (`all`, `semester`, or `month`), defaulting to `all`.

### `POST /points/adjust`
Adjusts points for a member.
- Protected by `PermissionsGuard` and requires `SystemPermissions.POINTS_ADJUST`.
- Expects `AdjustPointsDto` in the request body containing:
  - `target_user_id`: The ID of the user to adjust points for.
  - `amount`: The amount of points to adjust.
  - `category`: The category of the adjustment (`MANUAL` or `FINE`).
  - `reason`: The reason for the adjustment.
