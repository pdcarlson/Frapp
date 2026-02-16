# Specification: Location Tracking & Study Hours

## 1. Overview
The Location Tracking & Study Hours module allows members to log study time in verified academic locations (Geofences). The system uses periodic heartbeats to ensure the user remains within the designated area and automatically awards House Points upon session completion.

## 2. Database Schema (Drizzle)

### `study_geofences`
Defines the authorized areas for study.
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `name` | text | Not Null (e.g., "Main Library") |
| `coordinates` | jsonb | Not Null (Array of `{lat, lng}`) |
| `is_active` | boolean | Default: true |
| `created_at` | timestamp | Default: now() |

### `study_sessions`
Tracks active and historical study sessions.
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `user_id` | uuid | References `users.id`, Not Null |
| `geofence_id` | uuid | References `study_geofences.id`, Not Null |
| `status` | text | 'ACTIVE', 'COMPLETED', 'EXPIRED' |
| `start_time` | timestamp | Not Null |
| `end_time` | timestamp | Nullable |
| `last_heartbeat_at` | timestamp | Not Null |
| `total_minutes` | integer | Default: 0 |
| `points_awarded` | boolean | Default: false |
| `created_at` | timestamp | Default: now() |

## 3. Architecture & Logic

### Point-in-Polygon Validation
- The server will use a geometric utility (e.g., `robust-point-in-polygon` or a custom implementation) to validate that the user's `latitude`/`longitude` is inside the `study_geofence.coordinates`.

### The Heartbeat Mechanism
1.  **Start:** User selects a geofence and starts a session. Server verifies current location is inside.
2.  **Heartbeat (Every 5 mins):** Client sends current GPS.
    - If **Inside:** Update `last_heartbeat_at`.
    - If **Outside:** Mark session as `EXPIRED` or alert user via `NotificationService`.
3.  **Completion:** User stops session. Server calculates `total_minutes` and awards points via `PointsService`.

### Reward Logic
- Chapter-configurable (e.g., 1 point per 30 minutes).
- Minimum session length (e.g., 15 minutes) required for points.

## 4. API Contracts

### `GET /api/study/geofences`
- **Auth:** Chapter Member.
- **Returns:** List of active geofences for the chapter.

### `POST /api/study/sessions/start`
- **Body:** `{ geofenceId: string, latitude: number, longitude: number }`
- **Logic:** Validates location and starts a new `ACTIVE` session.

### `POST /api/study/sessions/heartbeat`
- **Body:** `{ latitude: number, longitude: number }`
- **Logic:** Updates heartbeat. If user left the zone, session is handled accordingly.

### `POST /api/study/sessions/stop`
- **Logic:** Ends session and triggers point calculation.

## 5. Security & Decoupling
- **Multi-tenancy:** All lookups scoped to `chapter_id`.
- **Decoupling:**
    - Uses `PointsService` for accrual.
    - Uses `NotificationService` for "You left the study zone" alerts.
