# PointsController Tests

The `PointsController` in `apps/api/src/interface/controllers/points.controller.ts` exposes endpoints for managing chapter member points.

## Covered Endpoints

- `GET /points/me`: Gets the point summary for the current user. Validates `window` parameter handling.
- `GET /points/leaderboard`: Gets the chapter leaderboard. Validates `window` parameter handling.
- `GET /points/members/:userId`: Gets the point summary for a specific member. Validates `window` parameter handling.
- `POST /points/adjust`: Allows an admin to adjust a member's points. Validates parameter mapping from the DTO.

## Key Test Behaviors

- Ensures default window parameters correctly fallback to `'all'` when omitted.
- Validates proper interaction and delegation to `PointsService`.
- Verifies that DTO field mapping from snake_case (e.g. `target_user_id`) to the expected service input is executed properly.
