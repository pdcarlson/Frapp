Refactoring onChange handler for checkboxes to dedicated handleRoleChange function inside MemberDetailSheet.

## 2026-03-28 (API)

- `apps/api/src/main.ts`: CORS for `*.frapp.live` is HTTPS-only when `NODE_ENV === 'production'`, relaxed regex when not.
- `scripts/check-api-contract-drift.mjs`: removed duplicate `.spec.js` entry in `API_SOURCE_EXCLUSIONS`.
