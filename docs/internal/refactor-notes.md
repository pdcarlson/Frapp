Refactoring onChange handler for checkboxes to dedicated handleRoleChange function inside MemberDetailSheet.

## 2026-03-27 - Added Global ThrottlerGuard
Enabled global rate limiting across the API to mitigate abuse.

Scoped named throttlers by HTTP method: `read` (100/min) applies to GET, HEAD, and OPTIONS; `write` (30/min) applies to other methods, so read traffic is not capped by the stricter write limit.
