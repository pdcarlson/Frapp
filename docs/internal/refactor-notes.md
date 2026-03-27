Refactoring onChange handler for checkboxes to dedicated handleRoleChange function inside MemberDetailSheet.

## 2026-03-27 - Added Global ThrottlerGuard
Enabled global rate limiting across the API to mitigate abuse.

`CustomThrottlerGuard` applies the `read` bucket to GET/HEAD/OPTIONS and the `write` bucket to other HTTP methods; `getTracker` falls back safely when `req.ips` is unset (no trust proxy).

CORS production origins use an HTTPS-anchored regex for `*.frapp.live` and apex `frapp.live` in `main.ts`.
