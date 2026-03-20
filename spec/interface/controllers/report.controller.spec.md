# Report Controller Specifications

The `ReportController` exposes endpoints to generate reports for the chapter.

## Endpoints

- `POST /reports/attendance`: Generates attendance reports. Optionally supports formatting as CSV via the `?format=csv` query parameter.
- `POST /reports/points`: Generates points reports. Optionally supports formatting as CSV via the `?format=csv` query parameter.
- `POST /reports/roster`: Generates member roster reports. Optionally supports formatting as CSV via the `?format=csv` query parameter.
- `POST /reports/service`: Generates service hours reports. Optionally supports formatting as CSV via the `?format=csv` query parameter.

## Authorization
All endpoints require authentication, membership in the requested chapter, and explicit `REPORTS_EXPORT` permissions.
