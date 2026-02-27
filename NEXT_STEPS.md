# Next Steps Plan

## Current Progress Snapshot (as of 2026-02-27)

## What is already implemented
- **Core backend foundation (Phase 1 style scope):** auth sync, users, chapters, members, roles/permissions, invites, health endpoint.
- **Database schema foundation:** `supabase/migrations/00000000000000_initial_schema.sql` defines core + advanced domain tables (events, points, chat, study, billing, service, tasks, docs, semester archives, etc.).
- **API test coverage for foundation modules:** unit test suite currently passes for the implemented core modules.

## What is not yet implemented in this branch
- **Web app:** currently a placeholder shell ("Authentication and dashboard coming soon").
- **Mobile app:** current tab screens are placeholders ("Coming soon").
- **Landing site spec gaps:** legal pages (`/terms`, `/privacy`, `/ferpa`) and full marketing sections are not yet present.
- **Large backend domain surface from spec:** Backwork, chat, notifications, study hours, service hours, tasks, chapter documents, reports, semester rollover, and alumni features are not yet wired in this branch.

## Branch divergence note
- `origin/develop` contains a **Phase 2 events/attendance/points API commit** (`22c83a2`) that is not present on this branch.

---

## Immediate Next Step (P0)

**Unify branch baseline before new feature work:**
1. Bring `22c83a2` (events/attendance/points API) from `origin/develop` into the active line of work.
2. Resolve conflicts and re-run API tests.
3. Regenerate/commit API contract outputs (`apps/api/openapi.json`, `packages/api-sdk` types) so frontend integration can start from an updated contract.

### Why this is the right next step
- It removes duplicated implementation risk across divergent branches.
- It advances a spec-critical domain (events + attendance + points) that is central to Frapp’s value.
- It creates a stronger backend base for the first real web/mobile workflows.

---

## Next Step After P0 (P1)

**Deliver first end-to-end onboarding flow (web + API):**
- Sign in -> create chapter -> complete terms/privacy acceptance -> create first invite.
- This unlocks real manual QA and gives a usable vertical slice instead of placeholders.
