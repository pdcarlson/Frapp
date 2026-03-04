# Phase 1 Audit — Post-API Completion

> Date: 2026-02-27
> Status: API Phase 1 complete. All 21 domains implemented. Frontend apps are placeholders.

---

## 1. Where We Are

### API — ~70% Spec Feature Coverage

All **21 spec domains** have controllers, services, repositories, and tests. The foundation is solid, but there are integration gaps and missing spec features within each domain.

**By the numbers:**
- 23 controllers, 22 services, 29 repositories, 22 modules
- ~120+ REST endpoints
- 297 unit tests across 26 suites (all passing)
- OpenAPI spec generated, SDK types rebuilt

### Frontend — ~1-5% Complete

| App | Status |
|-----|--------|
| Web Dashboard | Placeholder ("coming soon") — no auth, no routes, no components |
| Mobile App | 4 placeholder tabs with navigation structure — no real screens |
| Landing Page | Minimal hero (title + 2 buttons) — no features, pricing, legal |
| Docs | Real content (7 guide pages, working navigation) |

### Shared Packages

| Package | Status |
|---------|--------|
| `@repo/api-sdk` | ✅ 60 typed endpoints |
| `@repo/validation` | ✅ 15 Zod schemas |
| `@repo/theme` | ✅ Complete (Tailwind + dark mode) |
| `@repo/hooks` | ⚠️ Only `useFrappClient` — data hooks are stubs |
| `@repo/ui` | ⚠️ 3 placeholder components |

---

## 2. API Gap Analysis (What's Missing Within Implemented Domains)

### Critical Gaps (Must Fix Before Frontend)

| # | Gap | Domain | Impact |
|---|-----|--------|--------|
| 1 | **Notification triggers not wired** — no service calls `notifyUser()`/`notifyChapter()` | Notifications | Users get no push notifications for any event |
| 2 | **Chat file/image uploads** — no attachment upload URL endpoint | Chat | Can't send images or files in chat |
| 3 | **Recurring event instance generation** — `recurrence_rule` stored but never processed | Events | Weekly/biweekly/monthly events don't auto-generate instances |
| 4 | **Auto-absent marking** — required members not auto-marked ABSENT after grace period | Attendance | Admins must manually mark every absent member |
| 5 | **Member profiles** — no profile editing, photo upload, or alumni directory | Members | Users can't set display name, bio, avatar |
| 6 | **Chapter branding** — no logo upload or accent color management | Chapters | Chapters can't customize their appearance |
| 7 | **CSV/PDF report export** — reports return JSON only | Reports | Admins can't download actual report files |

### Medium Gaps (Important but not blocking)

| # | Gap | Domain | Notes |
|---|-----|--------|-------|
| 8 | Rate limiting on `points/adjust` | Points | Spec requires 50/hour default |
| 9 | Full-text search (tsvector) | Search, Backwork | Currently uses ILIKE — works but slower at scale |
| 10 | Calendar .ics file generation | Events | "Add to Calendar" action not supported |
| 11 | Billing grace period enforcement | Billing | 3-day `past_due` soft lock not enforced |
| 12 | Study session pause/resume | Study | No server-side pause; no GPS accuracy validation |
| 13 | Chat @mention parsing | Chat | @mentions don't trigger notifications |
| 14 | Semester-aware leaderboard | Points | Uses 6-month approximation instead of semester archives |
| 15 | Overdue invoice tracking | Invoices | No overdue detection or notifications |

### Low Gaps (Nice-to-have, not blocking launch)

| # | Gap | Notes |
|---|-----|-------|
| 16 | Poll manual closure | Polls |
| 17 | Chat typing indicators | Requires Supabase Realtime Broadcast (client-side) |
| 18 | Online/offline presence | Requires Supabase Realtime Presence (client-side) |
| 19 | Notification grouping | Client-side concern |
| 20 | Search result highlighting | UI concern |
| 21 | Invite revocation | Admin can't cancel unexpired invites |
| 22 | Folder management for documents | Only delete-folder implemented |
| 23 | Bulk operations (role assign, excuse) | Convenience features |

---

## 3. Next Options (Ranked)

### Option A: Fix Critical API Gaps First (Recommended)
**Duration: 1-2 days**

Fix the 7 critical gaps before starting any frontend work. This ensures every frontend feature has a complete backend.

1. Wire notification triggers into events, chat, billing, tasks, service, study, points
2. Add chat file upload endpoint (signed URL for chat attachments)
3. Implement recurring event instance generation
4. Add auto-absent marking (cron or post-event trigger)
5. Add member profile endpoints (update display_name, bio, avatar_url, photo upload)
6. Add chapter branding endpoints (logo upload, accent color with WCAG validation)
7. Add CSV export to reports (PDF can come later)

### Option B: Start Landing Page (Parallel Track)
**Duration: 1-2 days**

The landing page has **zero API dependency**. It's pure UI/marketing. Starting it in parallel with API gap fixes is efficient and directly drives sales.

- Hero section with "Modern Ivy" design
- Feature highlights, pricing, testimonials
- Legal pages (Terms, Privacy, FERPA)
- Header/footer with navigation
- Dark mode, animations, SEO

### Option C: Start Web Dashboard Foundation
**Duration: 3-4 days for foundation + first screens**

The API surface is sufficient to build core admin screens even with the gaps. Auth + layout + dashboard + members + events could ship now.

1. Supabase Auth integration (sign-up, sign-in, session management)
2. Layout shell (sidebar, header, dark mode)
3. Dashboard home (stats, activity feed)
4. Members screen (directory, roles, invite)
5. Events screen (CRUD, attendance)

### Option D: Start Mobile App Foundation
**Duration: 3-4 days**

Similar to Option C but for mobile. The API has enough endpoints for the core member experience.

### My Recommendation

**Do A + B in parallel, then C, then D.**

```
NOW ──► Option A: Fix critical API gaps (1-2 days)
      + Option B: Landing page (parallel, 1-2 days)
THEN ─► Option C: Web dashboard (3-4 days)
THEN ─► Option D: Mobile app (3-4 days)
```

Fixing the 7 critical API gaps ensures that when we build frontends, every button has a working backend call. The landing page runs in parallel because it has zero API dependency and is the first thing prospects see.

---

## 4. Spec Compliance Summary

| Spec Section | Coverage | Notes |
|-------------|----------|-------|
| §1 Users/Personas | ✅ | All persona types supported by role system |
| §2.1 Landing | ❌ | Placeholder only |
| §2.2 Web App | ❌ | Placeholder only |
| §2.3 Mobile App | ❌ | Placeholder only |
| §2.4 Docs | ✅ | Working documentation site |
| §3.1 IAM | ✅ | Auth, RBAC, permissions, presidency transfer |
| §3.2 Backwork | ✅ | Upload, browse, auto-vivification, dedup |
| §3.3 Financials | ⚠️ | Billing + invoices done; missing Stripe PI for invoices |
| §3.4 Chat | ⚠️ | Core messaging done; missing file uploads, @mentions |
| §3.5 Study Hours | ⚠️ | Sessions done; missing pause/GPS accuracy |
| §3.6 Events | ⚠️ | CRUD done; missing recurrence generation |
| §3.7 Polls | ✅ | Create, vote, results, expiration |
| §3.8 Member Directory | ⚠️ | List done; missing profiles, alumni directory |
| §3.9 Activity Feed | ❌ | Not implemented as standalone (lives in frontend) |
| §3.10 Global Search | ⚠️ | ILIKE search; missing full-text |
| §3.11 Service Hours | ✅ | Log, approve, reject, points |
| §3.12 Tasks | ✅ | Full lifecycle with points |
| §3.13 Chapter Documents | ✅ | Upload, browse, folders |
| §3.14 Semester Rollover | ⚠️ | Archive done; missing bulk promotion |
| §3.15 Reports | ⚠️ | Data done; missing CSV/PDF export |
| §3.16 Alumni | ⚠️ | Role exists; missing alumni directory |
| §3.17 Chapter Branding | ⚠️ | Fields exist; missing upload/validation endpoints |
| §4 Onboarding | ⚠️ | Invite flow done; missing tutorial (frontend) |
| §5 Visual Identity | ❌ | Theme exists; not applied to any frontend |
