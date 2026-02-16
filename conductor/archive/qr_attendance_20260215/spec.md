# Specification: QR Attendance System

## 1. Overview
The QR Attendance System allows chapter administrators to display a dynamic, rotating QR code at an event. Members scan this code with their mobile app to check in securely. This system prevents attendance fraud (e.g., sending a static QR code to a friend who isn't there).

## 2. Security & Architecture

### Dynamic QR Payload (JWT)
- **Format:** JWT signed with `CLERK_SECRET_KEY` (or a dedicated internal secret).
- **Payload:**
  ```json
  {
    "eventId": "uuid",
    "chapterId": "uuid",
    "timestamp": 1700000000,
    "nonce": "random_string"
  }
  ```
- **Expiration:** Short-lived (e.g., 10-30 seconds). This forces the user to be physically present to scan the live screen.

### Flow
1.  **Admin (Display):** Connects to `GET /api/events/:id/qr-stream` (SSE or Polling). Receives a new JWT every 10s.
2.  **Member (Scan):** Scans QR. App sends `POST /api/events/:id/qr-check-in` with the JWT.
3.  **Server (Validation):**
    - Verifies JWT signature.
    - Checks expiration.
    - Calls `AttendanceService.checkIn(userId, eventId)`.

## 3. API Contracts

### `GET /api/events/:id/qr` (Admin Only)
- **Returns:** `{ token: "jwt...", expiresAt: "..." }`
- **Use Case:** Polled by the Admin UI to render the QR code.

### `POST /api/events/:id/qr-check-in`
- **Body:** `{ token: "jwt..." }`
- **Auth:** Member JWT.
- **Logic:** Decodes token, validates event match, checks attendance.
- **Returns:** `{ success: true, pointsAwarded: 10 }`

## 4. Database Changes
No schema changes required. We utilize the existing `event_attendance` and `events` tables.

## 5. Mobile Integration (Future)
This track focuses on the **API support** for this feature. The mobile scanner implementation will happen in the Mobile App track.
