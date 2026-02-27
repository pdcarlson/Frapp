# Next Steps Plan

> Last updated: 2026-02-27
> See [ROLLOUT_STRATEGY.md](ROLLOUT_STRATEGY.md) for the comprehensive master rollout plan.

---

## Current Progress Snapshot

### API (`apps/api`) — ✅ PHASE 1 COMPLETE (~95% of spec domains)

**23 controllers, 22 services, 29 repositories, 297 passing tests across 26 suites.**

| Domain | Status | Tests |
|--------|--------|-------|
| Auth/User Sync | ✅ | 3 |
| Users | ✅ | 3 |
| Chapters | ✅ | 5 |
| Members | ✅ | 4 |
| Roles/RBAC | ✅ | 10 |
| Invites | ✅ | 12 |
| Events | ✅ | 8 |
| Attendance | ✅ | 11 |
| Points | ✅ | 10 |
| Billing (Stripe) | ✅ | 19 |
| Financial Invoices | ✅ | 19 |
| Backwork | ✅ | 15 |
| Chat (channels, messages, reactions, pins) | ✅ | 25 |
| Notifications | ✅ | 18 |
| Service Hours | ✅ | 20 |
| Tasks | ✅ | 25 |
| Study Hours (geofences, sessions) | ✅ | 27 |
| Chapter Documents | ✅ | 8 |
| Polls | ✅ | 14 |
| Semester Rollover | ✅ | 8 |
| Reports & Export | ✅ | 8 |
| Global Search | ✅ | 4 |
| Health | ✅ | 0 (e2e) |
| Guards/Interceptors | ✅ | 21 |

**Shared packages:**
- `@repo/api-sdk` — ✅ Regenerated with all endpoints
- `@repo/validation` — ✅ Zod schemas for all domains
- `@repo/theme` — ✅ Complete
- `@repo/eslint-config`, `@repo/typescript-config` — ✅ Complete

**Database:** ✅ All tables in `supabase/migrations/` match implemented domains.

---

## Priority Order (Updated)

```
✅ DONE ─► Phase 1: Complete the API
NOW ──────► Phase 2: Landing Page (sales-ready marketing site)
            Phase 3: Web Dashboard (admin experience)
            Phase 4: Mobile App (member experience)
            Phase 5: Integration, Polish, Launch
```

---

## Immediate Next Actions (P0)

1. **Start Phase 2: Landing Page** — See `ROLLOUT_STRATEGY.md` § Phase 2
   - Hero section, feature highlights, pricing, testimonials
   - Legal pages (/terms, /privacy, /ferpa)
   - "Modern Ivy" design with Navy + Royal Blue + Emerald palette
   - No backend dependency — pure UI

2. **Start Phase 3: Web Dashboard Foundation** (can run in parallel)
   - Supabase Auth integration
   - Layout shell with sidebar navigation
   - Dashboard home page
   - First admin screens (Members, Roles, Events)

---

## Completed Milestones

| Milestone | Date | Description |
|-----------|------|-------------|
| Ground-up rebuild | 2026-02 | Migrated to Supabase, spec-driven architecture |
| Phase 1 Foundation | 2026-02 | Auth, Users, Chapters, Members, Roles, Invites |
| Phase 2 Events/Points | 2026-02 | Events, Attendance, Points |
| Full codebase audit | 2026-02-27 | Comprehensive audit and rollout strategy |
| Sprint 1: Financials + Backwork | 2026-02-27 | Billing, Member Invoices, Backwork |
| Sprint 2: Chat | 2026-02-27 | Channels, Messages, Reactions, Pins, Read Receipts |
| Sprint 3: Notifications + Tasks | 2026-02-27 | Notifications, Service Hours, Tasks |
| Sprint 4: Remaining Domains | 2026-02-27 | Study Hours, Documents, Polls, Semester, Reports, Search |
| **Phase 1 Complete** | **2026-02-27** | **All 21 API domains implemented, 297 tests** |
