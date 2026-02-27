# Next Steps Plan

> Last updated: 2026-02-27
> See [ROLLOUT_STRATEGY.md](ROLLOUT_STRATEGY.md) for the comprehensive master rollout plan.

---

## Current Progress Snapshot

### What is implemented

**API (apps/api) — ~38% of spec domains:**
- Auth sync, Users, Chapters, Members, Roles/RBAC, Invites, Events, Attendance, Points, Health
- 9 controllers, 9 services, 8 repositories, 84 passing unit tests
- OpenAPI export + auto-generated TypeScript SDK
- Guards: SupabaseAuth, Chapter, Permissions (full chain)
- Observability: RequestId, Logging, AllExceptionsFilter

**Database — 100%:**
- All 25+ tables defined in `supabase/migrations/` (ahead of API implementation)

**Shared packages — ~75%:**
- api-sdk, theme, validation, eslint-config, typescript-config: ✅ Complete
- hooks, ui: ⚠️ Stubs/minimal

**Web, Mobile, Landing — Placeholder shells only (~1–5%).**

### What is NOT implemented

**API domains not yet built (12 remaining):**
- Backwork, Chat, Notifications, Study Hours, Financials (endpoints), Service Hours, Tasks, Chapter Documents, Semester Rollover, Reports & Export, Global Search, Polls

**Frontends:**
- Web: No auth, no routes, no components
- Mobile: Placeholder tabs only
- Landing: Basic hero only; no features section, pricing, legal pages

---

## Priority Order

```
NOW ─► Phase 1: Complete the API (12 remaining domains)
       Phase 2: Landing Page (sales-ready, parallel with API)
       Phase 3: Web Dashboard (admin experience)
       Phase 4: Mobile App (member experience)
       Phase 5: Integration, Polish, Launch
```

**Rationale:** The API is only 38% complete. Building frontends without backend endpoints produces throwaway code. API-first ensures every frontend feature has a working backend to call.

---

## Immediate Next Actions (P0)

1. **Start API Sprint 1:** Billing endpoints + Backwork domain
   - Billing: Checkout flow, webhook handler, subscription status, member invoices
   - Backwork: Upload (signed URLs), browse with filters, auto-vivification, duplicate prevention
   - See `ROLLOUT_STRATEGY.md` § Phase 1, Sprint 1 for full checklist

2. **Start Landing Page design** (can run in parallel)
   - Hero section, feature highlights, pricing, footer, legal pages
   - See `ROLLOUT_STRATEGY.md` § Phase 2 for full checklist

---

## Completed Milestones

| Milestone | Date | Description |
|-----------|------|-------------|
| Ground-up rebuild | 2026-02 | Migrated from Clerk/Drizzle to Supabase, spec-driven architecture |
| Phase 1: Foundation | 2026-02 | Auth, Users, Chapters, Members, Roles, Invites, Health |
| Phase 2: Events/Points | 2026-02 | Events, Attendance, Points with tests and OpenAPI/SDK |
| Branch integration | 2026-02-27 | Merged Phase 2 work, resolved conflicts |
| Full codebase audit | 2026-02-27 | Comprehensive audit and rollout strategy created |
