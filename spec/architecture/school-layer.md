# School layer: data model and permissions

**Status: Proposed, pending Paul.** Nothing here is built. Asked by Winston (`whewitt-frapp`), 2026-11-11, for [#4192](https://github.com/pdcarlson/Frapp/issues/4192). Until Paul accepts it, the specs listed in [§ 9](#9-specs-this-would-change) describe the system, and this doc changes none of them.

This doc is one part of #4192's design. It covers the tables, isolation, permission scopes and the migration of existing chapters. Three parts are decided elsewhere, and this doc defers to them:

- **URLs and tenant context:** [ADR-27](adr/README.md) (PR [#4213](https://github.com/pdcarlson/Frapp/pull/4213)). It settles `/c/<slug>` and `/s/<school>`, the `tenant_slugs` and `school_slugs` registries, the header-first `ChapterGuard`, route-declared tenant kinds (`@TenantKinds`), `SchoolGuard` and `x-school-id`.
- **The screens.**
- **The IFC recruitment module:** pipeline stages, form fields, bids, the master-list rules and screens. It is [`spec/behavior/ifc-recruitment.md`](https://github.com/pdcarlson/Frapp/pull/4218) (PR #4218), and this doc stores what that one specifies: where the two touch, the recruitment doc owns behavior and this one owns tables, keys and isolation.

The concept this builds on is [#4192 § Concept](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804509311), with Winston's answers in [#4192 § answers](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804810927).

**How to read the claims.**
- **Today's code and schema** was read at `main` `88c2b85` (2026-11-11), and each claim cites the file. Counts such as "52 tables" are what a read found at that commit, not totals anything keeps current.
- **Law** comes from search excerpts the hub relayed. It is unverified and it is not legal advice ([§ 6](#6-risks)).
- **"Derived"** marks a statement reasoned from the code rather than run.

## Contents

1. [Decisions this design makes](#1-decisions-this-design-makes)
2. [Tables](#2-tables)
3. [Eligibility and GPA](#3-eligibility-and-gpa)
4. [Isolation](#4-isolation)
5. [Permission scopes and council roles](#5-permission-scopes-and-council-roles)
6. [Risks](#6-risks)
7. [Migrating existing chapters](#7-migrating-existing-chapters)
8. [Open questions for Paul](#8-open-questions-for-paul)
9. [Specs this would change](#9-specs-this-would-change)

## 1. Decisions this design makes

| # | Decision | Why, in one line |
|---|---|---|
| D1 | A council is a row in `chapters` with `kind = 'council'` | It gets roles, tiers, chat, events, documents, the audit log and Stripe for free, and membership already keeps it out of every chapter's data |
| D2 | Chapters link to a school and to a council through affiliation tables (`school_chapters`, `council_chapters`), never a parent column | Paul's [#4068](https://github.com/pdcarlson/Frapp/issues/4068) decision 11 |
| D3 | `schools` is its own table. Its email domains are rows, and a verified domain belongs to exactly one school | Only a unique row can stop a second "school" receiving another's students |
| D4 | `school_members` is a person's own record at a school, apart from `members` | Winston, 2026-11-11: a person belongs to their school directly and stays after leaving a chapter |
| D5 | One `pnms` row per person per school, and a PNM needs no Frapp account | One record, many chapters' interest; a QR-code form works without the app |
| D6 | `rush_candidates` is extended (`pnm_id`, `origin`, a separate `bid_state`), not replaced | Its API, chat commands and anonymous votes keep working, and shipped cards can't undo a new bid state |
| D7 | Only a PNM's own action, or their council registration, links a PNM to a chapter | A chapter can't make itself "interested" in someone and read their record |
| D8 | Raw GPA lives in a restricted, encrypted table. Only security-definer functions reach it, and each one logs the read in the same transaction | Winston chose to store GPA "with extra care". Whether to store it at all is Paul's call ([§ 3.1](#31-the-call-for-paul)) |
| D9 | The GPA keys are **explicit-grant only**: `*` doesn't satisfy them, and `roles:manage` can't grant them | Otherwise every council's admin, and anyone who can edit roles, reads GPAs |

### Why a council is a kind of chapter (D1)

Winston's words: a council "literally follows the same structure, just different role names". The real schema bears that out.

- **The tenant table already carries everything a council needs.**
  - About 52 tables take a `chapter_id` foreign key to `chapters`, from `roles` and `role_tiers` to `chat_channels`, `events`, `chapter_documents`, `chapter_audit_log`, `invites` and `notifications`.
  - Stripe sits on the tenant row too: `stripe_customer_id` and `subscription_status` (`00000000000000_initial_schema.sql`). So Winston's "someone on the IFC pays" fits the existing billing model, once [Q3](#8-open-questions-for-paul) sets the price.
- **#4071's tiers apply unchanged.**
  - `role_tiers`, `roles.tier_id` and `roles.permission_overrides` key on `chapter_id` (`20261111140000_role_tiers.sql`), and the database keeps `roles.permissions` true.
  - `PermissionsGuard` reads that one column, filtered to the active tenant (`apps/api/src/interface/guards/permissions.guard.ts`).
  - A council's role editor is the same page with council keys in it.
- **Membership keeps a council out of a chapter's data.** A council officer is a `members` row in the council tenant only. `ChapterGuard` checks membership in the tenant a request names (`apps/api/src/interface/guards/chapter.guard.ts`), so a council officer naming a chapter is refused with `403 chapter.context.invalid`. RLS agrees: `realtime_can_read_chapter_scope` checks membership by tenant id (`20260827190000_secdef_search_path_pg_temp.sql`).
- **Membership alone doesn't keep chapter routes away from a council's own tenant.** Without a kind check, a council officer naming *their council* on `/v1/points` would be served points for the council.
  - ADR-27 adds the kind check. Every route declares the kinds it serves with `@TenantKinds(...)`, the default is chapter only, and a wrong kind gets the same `403 chapter.context.invalid`.
  - Kind comes from `chapters.kind`, never from `org_archetype`.
  - This doc relies on that check rather than adding its own (corrected 2026-11-11; an earlier draft claimed membership alone was enough).
- **It matches decision 11.** A council is a peer tenant that a chapter affiliates with, not a parent that reads it.

**The separate-table option, and why not.** A separate `councils` table, with `council_members`, `council_roles` and council chat, events and documents, keeps the data further apart. But it rebuilds roles, tiers, overrides, rank rules, presidency transfer, the audit log, chat and billing a second time, and every later fix would land twice. The separation it buys already exists: a council and a chapter are different tenants, and ADR-27's kind check holds the routes apart.

**What the kind costs.**
- **Every query that pages all of `chapters` must say which kinds it means.** These include:
  - the scheduled sweeps in `supabase-scheduled-jobs.repository.ts`;
  - `findChaptersWithStalePalette`;
  - the chapter-directory claim flow (`chapters.directory_id`);
  - every chapter count.

  Each gets a kind filter, or a recorded reason for not having one, in its existing tenant-scope spec. ADR-27 lists the same work.
- **`GET /v1/chapters`** (`ChapterController.listForCurrentUser`, the switcher's list) returns councils too, with `kind`, per ADR-27 rollout step 1.
- **New councils start with `subscription_status = 'incomplete'`** (the column default), and `ChapterGuard.enforceSubscription` blocks every write not marked `@FreeTier`. Every council route a council needs before it pays is marked `@FreeTier`: setup, chapter invitations, roles. Recruitment routes wait on [Q3](#8-open-questions-for-paul).

## 2. Tables

**House posture for every new table:** RLS on with **no policies**, reached by the API through the service-role client. This is the posture every chapter table has (`00000000000000_initial_schema.sql`: "RLS enabled with no permissive policies = default deny").

The API reaches Postgres only through supabase-js over PostgREST: `@supabase/supabase-js` is its only database dependency, and `supabase/config.toml` exposes `schemas = ["public"]`. So two things this design needs are written as security-definer functions in `public`:
- reaching a schema PostgREST doesn't expose ([§ 3.2](#32-storage));
- doing two writes in one transaction ([§ 2.5](#25-pnms-and-interest)).

Each such function has `execute` revoked from `public`, `anon` and `authenticated` and granted to `service_role` only, with `search_path` pinned as in `20260827190000_secdef_search_path_pg_temp.sql`.

### 2.1 Schools

```sql
create table schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,            -- "Example State University"
  short_name  text not null,            -- "ESU" (example)
  aliases     text[] not null default '{}',   -- seeded from chapter_directory's school aliases
  status      text not null default 'unverified'
              check (status in ('unverified', 'verified', 'suspended')),
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- The school's URL slug lives in ADR-27's school_slugs registry, renamed by staff only.

create table school_email_domains (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references schools(id) on delete cascade,
  domain             text not null,
  include_subdomains boolean not null default false,  -- student.example.edu under example.edu
  status             text not null default 'proposed'
                     check (status in ('proposed', 'verified', 'rejected')),
  verified_via       text check (verified_via in ('edu_match', 'staff')),
  verified_by        uuid references users(id) on delete set null,
  verified_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint school_email_domains_domain_shape
    check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);
create unique index school_email_domains_verified_key
  on school_email_domains (domain) where status = 'verified';
```

**Why domains are rows.** A unique index across schools is what stops a second "school" from receiving `example.edu`'s students. A `text[]` column on `schools` can't enforce that.

**Verification states.**
- Only a **verified** domain verifies students.
- The index is partial on `verified`, so proposing a domain reserves nothing. A squatter's unverified school can't block the real one.
- The shape check rejects a leading `@` or `.`, capitals and spaces.

**One school per address.** The unique index alone can't guarantee it, because `include_subdomains` lets one row cover others. So verifying a domain (the `verify_school_domain` function) refuses it when it equals, contains or sits under another school's verified domain whose `include_subdomains` reaches it. Example: `student.example.edu` is refused while another school holds `example.edu` with subdomains. The check runs under a lock on the table, so two verifications can't race.

**How a domain gets verified (ADR-27).**
- **`.edu` domains verify automatically** (`edu_match`) when the proposed domain matches the school's directory record and no other school holds it.
- **Every other domain**, and every `.edu` conflict, goes to a staff queue.
- An automatic match is a derived convenience, not proof the school owns the domain, so staff can reverse one ([§ 6](#6-risks)).

**Who creates a school.** Staff, a council's founder, or a chapter founder whose school isn't on Frapp yet. It starts `unverified`. An unverified school can hold proposed affiliations, but its students can't verify against it and nothing campus-wide opens. Who may create one is [Q4](#8-open-questions-for-paul).

**Names.** `schools.name` and `short_name` are the school's own, editable by staff. `aliases` is copied from the directory rows the school was matched from, the same aliases `search_school_names` already matches in `20261107043000_chapter_directory_search.sql`. School search can then reuse them, so founders searching "ESU" and "Example State" land on one school.

### 2.2 School membership

```sql
create table school_members (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references schools(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  status           text not null
                   check (status in ('pnm', 'member', 'alum', 'staff')),
  verified_via     text not null check (verified_via in ('email_code', 'sso', 'staff')),
  verified_email   text,                  -- the school address the code went to
  verified_at      timestamptz not null,
  directory_visibility text not null default 'hidden'
                   check (directory_visibility in ('hidden', 'officers', 'school')),
  left_at          timestamptz,           -- transferred out; the row stays for history
  created_at       timestamptz not null default now(),
  unique (school_id, user_id)
);
create unique index school_members_verified_email_key
  on school_members (school_id, verified_email) where verified_email is not null;
```

**A row exists only once a person with a Frapp account has proved they're at the school.** That means a one-time code sent to an address on a verified domain, or SSO later. A chapter membership never creates one. If it did, any chapter founder could enrol a roster in a school of their choosing.

**Statuses** (ADR-27 names `pnm`):

| From | To | When |
|---|---|---|
| (none) | `pnm` | A person with an account verifies through an interest form or council registration |
| (none) | `member` | A person verifies their school email any other way, for example on joining a chapter at the school |
| `pnm` | `member` | They join any chapter or council at the school |
| `member` | `member` | They leave a chapter. **The row stays**: leaving deletes a `members` row, and nothing here references `members` (Winston's D4) |
| `member`, `pnm` | `alum` | Graduation, by hand or from class year once there's a field for it |
| any | (`left_at` set) | They transfer out. The row is kept for history and grants nothing |

**A PNM without an account is not a school member.** `user_id` is required, so a form submitter with no account exists only as a `pnms` row ([§ 2.5](#25-pnms-and-interest)). When they make an account and verify the same school email, the API creates their `school_members` row with status `pnm` and sets `pnms.user_id`. This is how this doc reads ADR-27's "the submitter becomes a school member with status `pnm`". The two agree for every submitter who has an account.

**Leaving a chapter.** There's no self-serve "Leave chapter" today (ADR-27 scenario 12 needs one). When it's built, it deletes the `members` row and leaves `school_members` alone. ADR-27's `/` then sends the person to `/s/<school>`.

**Directory visibility** is off by default (`hidden`). What other chapters can see of a visible member is a phase 5 decision.

**Account deletion.** `anonymize_user` tombstones the `users` row in place, so `on delete cascade` never fires (its latest definition, `20261111180000_document_pins_and_stars.sql`, says so). The function must delete the person's `school_members` rows explicitly ([§ 3.5](#35-retention-and-deletion)).

### 2.3 Councils

```sql
alter table chapters
  add column kind text not null default 'chapter'
    check (kind in ('chapter', 'council')),
  add column council_type text
    check (council_type in ('ifc', 'panhellenic', 'nphc', 'mgc', 'other')),
  add column council_verified_at timestamptz,
  add column council_verified_by uuid references users(id) on delete set null,
  add constraint chapters_council_fields_kind check (
    (kind = 'council') = (council_type is not null)
    and (kind = 'council' or council_verified_at is null)
  ) not valid;
alter table chapters validate constraint chapters_council_fields_kind;
```

**Writing the constraint.** It's added `not valid` and then validated, so the long lock is only the validation scan. `npm run check:migration-safety` doesn't judge this: it checks filenames, versions and the promotion and rollback ledgers, not DDL. The advisory Squawk job does judge it (`.squawk.toml`).

**ADR-27 settles the kind values as `chapter` and `council`.** A school's Greek life office is not a tenant: its staff hold a role on the council ([§ 5.2](#52-school-level-roles)).

**The archetype is not the council type.**
- `chapters.org_archetype` already uses `ifc` to mean *an IFC member fraternity*: it's the default in `20260523120000_chapter_customization.sql`, and `packages/org-archetypes/src/index.ts` defines it.
- A council gets a new archetype key, `council`, and `council_type` says which council it is.
- `Archetype.council` already names each chapter archetype's council ("Interfraternity Council" for `ifc`, "Panhellenic Council" for `npc`). That's the default for which council type a chapter is offered to join ([§ 2.4](#24-affiliations)).

**Keeping archetype and kind apart.** The code doesn't do this on its own, so the build must:
- **Hide the council archetype from chapter founders.** Every client builds its archetype list from `Object.values(ARCHETYPES)`: the web wizard (`chapter-wizard.tsx`), web Settings (`settings-org-tab.tsx`) and mobile create-chapter (`create-chapter.tsx`). Those lists filter `council` out, and council creation picks it for you.
- **Refuse archetype changes that cross kinds.** `ChapterOnboardingDto.org_archetype` is a bare `@IsString()`, and `ChapterConfigService.patchConfig` writes it. Both refuse `council` on a chapter and any chapter archetype on a council.

**Modules don't keep a council away from chapter features. Route kinds do.**
- `enabled_modules` is deep-merged on every config patch, and `isModuleEnabled` reads a missing key as on (`packages/validation/src/index.ts`).
- So a module map can't lock anything. What keeps points, dues, study zones, backwork, tasks and rush away from a council is ADR-27's default: those routes serve the `chapter` kind only.
- The council archetype's module map just decides what the council's nav shows.
- The new `council-recruitment` module key gets an explicit `false` in every chapter archetype. Its routes serve `council` only, so a chapter can't reach them whatever its map says.

**Councils start unverified** ([§ 5.3](#53-creating-a-council-picking-a-role-renaming-titles)). An unverified council can set itself up and propose links, but it sees no chapter or PNM data until the conditions below hold. Grade import and FERPA releases also wait for `council_verified_at`.

**`chapters.university`** is `not null` and gets the council's school name. [§ 7](#7-migrating-existing-chapters) step 6 covers its future.

**One council of a type per school**, checked in the creation function. A second IFC at the same school is refused. A dispute over which group is "the" IFC goes to staff, or later to the school's office.

### 2.4 Affiliations

```sql
create table school_chapters (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  chapter_id  uuid not null references chapters(id) on delete cascade,  -- either kind
  is_primary  boolean not null default true,
  status      text not null default 'proposed'
              check (status in ('proposed', 'active', 'declined', 'ended')),
  proposed_by uuid references users(id) on delete set null,
  confirmed_by uuid references users(id) on delete set null,   -- an officer of the chapter
  confirmed_at timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);
create unique index school_chapters_one_primary
  on school_chapters (chapter_id) where is_primary and status = 'active';
create unique index school_chapters_live_pair
  on school_chapters (school_id, chapter_id) where status in ('proposed', 'active');

create table council_chapters (
  id            uuid primary key default gen_random_uuid(),
  council_id    uuid not null references chapters(id) on delete cascade,
  chapter_id    uuid not null references chapters(id) on delete cascade,
  status        text not null default 'proposed'
                check (status in ('proposed', 'accepted', 'declined', 'suspended', 'ended')),
  proposed_by_side text not null check (proposed_by_side in ('council', 'chapter')),
  proposed_by   uuid references users(id) on delete set null,
  decided_by    uuid references users(id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create unique index council_chapters_live_pair
  on council_chapters (council_id, chapter_id) where status in ('proposed', 'accepted', 'suspended');
```

**Why the school link is an affiliation.** Two reasons:
- Decision 11: a chapter links up "through an affiliation, never a parent column".
- City-wide chapters exist. Such a chapter has one primary school, which is where its campus link and its councils live, and can hold a second active link.

**A chapter joins a school only when one of its officers confirms (ADR-27).** Every path into a school starts at `proposed`: the migration, a founder's pick at creation, or a council's invitation. A holder of `chapter-config:manage` in that chapter moves it to `active`. Nothing creates an `active` row directly.

**A council's school link is written by the creation function.** The council row, its primary `school_chapters` row (`active`, because the founder verified at that school), its tiers and its roles are all written in one transaction by `create_council`.
- **Why one function.** `ChapterService.create` today issues separate inserts, chapter first, so no trigger on the chapter insert could see the affiliation.
- **The rule it enforces:** the function writes a council only with its school. A later attempt to end a council's only primary affiliation is refused.

**`council_chapters` needs both sides to agree** (ADR-27's proposed, accepted and declined states).
- **Who proposes.** Either side: the council needs `council:chapters_manage`, and the chapter needs `chapter-config:manage`. The other side accepts or declines.
- **What the function checks** (`set_council_chapter_status`, under a lock on both tenant rows):
  - `council_id` is a council;
  - `chapter_id` is a chapter;
  - the two share an active `school_chapters` row for the same school.
- **Suspending and ending.** Only the council can suspend a link, for example over standing. Either side can end it.
- **A council sees nothing of a chapter until the link is `accepted`.** "Nothing" means no interest, no announcement path, and no listing beyond what the chapter's public school listing shows.

**A chapter may sit in more than one council**, for example a Panhellenic chapter at a campus that also has a multicultural council. Each council still sees only its own registrations ([§ 2.5](#25-pnms-and-interest)).

**No school is required to start a chapter.** Winston set that requirement aside. A chapter with no affiliation works as today, and adding one later changes no chapter data and, under ADR-27's flat `/c/<slug>`, no chapter URL.

### 2.5 PNMs and interest

The recruitment worker owns the pipeline's stages, fields and screens: Lead → Met → Engaged → Bid-ready → Bid extended → Accepted or Declined, plus Dropped, with notes, tags, a fit rating and follow-ups, all chapter-private. This section fixes only identity, links and ownership.

```sql
create table pnms (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references schools(id) on delete cascade,
  user_id           uuid references users(id) on delete set null,   -- set once they have an account
  school_email      text not null,
  email_verified_at timestamptz,           -- the one-time code on the form
  first_name        text not null,
  last_name         text not null,
  preferred_name    text,
  class_year        smallint,
  phone             text,
  phone_shared      boolean not null default false,
  merged_into_id    uuid references pnms(id) on delete cascade,   -- a merged duplicate goes with its survivor
  created_via       text not null check (created_via in ('interest_form', 'council_registration', 'council_import')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint pnms_school_email_lower check (school_email = lower(school_email))
);
create unique index pnms_school_email_key on pnms (school_id, school_email) where merged_into_id is null;

create table council_recruitment_seasons (
  council_id  uuid not null references chapters(id) on delete cascade,
  term        text not null,             -- "Spring 2027"
  opens_at    timestamptz not null,
  closes_at   timestamptz not null,
  bid_window_opens_at  timestamptz,
  bid_window_closes_at timestamptz,
  status      text not null default 'planned' check (status in ('planned', 'open', 'closed')),
  primary key (council_id, term)
);

create table pnm_council_registrations (
  id          uuid primary key default gen_random_uuid(),
  pnm_id      uuid not null references pnms(id) on delete cascade,
  council_id  uuid not null references chapters(id) on delete cascade,
  term        text not null,             -- the council's recruitment season, e.g. "Spring 2027"
  status      text not null default 'registered' check (status in ('registered', 'withdrawn', 'released')),
  created_at  timestamptz not null default now(),
  unique (pnm_id, council_id, term),
  foreign key (council_id, term) references council_recruitment_seasons (council_id, term) on delete cascade
);

create table pnm_interests (
  id          uuid primary key default gen_random_uuid(),
  pnm_id      uuid not null references pnms(id) on delete cascade,
  chapter_id  uuid not null references chapters(id) on delete cascade,
  registration_id uuid references pnm_council_registrations(id) on delete set null,
  source      text not null check (source in ('interest_form', 'council_registration', 'council_import')),
  created_at  timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique (pnm_id, chapter_id)
);

alter table rush_candidates
  add column pnm_id uuid references pnms(id) on delete set null,
  add column origin text not null default 'manual' check (origin in ('manual', 'pnm')),
  add column bid_state text not null default 'none'
    check (bid_state in ('none', 'extended', 'accepted', 'declined', 'expired', 'rescinded')),
  add column bid_expires_at timestamptz,
  add column bid_verdict_at_extend text,     -- the eligibility verdict when the bid went out
  add column closed_reason text,
  add column final_vote_count integer;       -- copied from the ballots before they're purged
create unique index rush_candidates_chapter_pnm_key
  on rush_candidates (chapter_id, pnm_id) where pnm_id is not null;

create table rush_stages (                   -- the chapter's own stages, each in a fixed category
  id         uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  key        text not null,                  -- what rush_candidates.stage holds today
  label      text not null,
  category   text not null check (category in ('new', 'contacted', 'met', 'engaged', 'bid_ready', 'closed')),
  position   integer not null,
  hidden     boolean not null default false,
  unique (chapter_id, key)
);
```

**What the recruitment doc needs stored, and where.** That doc owns the behavior. This list is only the columns:
- **Stage categories:** `rush_stages`. `rush_candidates.stage` keeps holding the stage key, as it does today, so existing rows keep working. Automatic moves read the category, never the label.
- **Bid state:** a new `bid_state` column, apart from the legacy `bid_status`. The existing routes and shipped cards keep reading `bid_status`'s two values, mapped from `bid_state` (`accepted` reads as `extended`, everything else as `none`). Extend refuses any `bid_state` other than `none` or `expired`, so an old card can't undo an acceptance. The contract change runs `npm run check:api-breaking:shipped`.
- **Votes:** `final_vote_count`. The ballots in `rush_candidate_votes` are deleted after the season, so the count is copied to the row first.
- **Notes:** the recruitment doc's notes need a chapter key, `rush:read_notes`, separate from today's `rush:notes`. #4070's backfill (`20261111010000_rush_permissions_backfill.sql`) gave `rush:notes` to every role that held the member set, New Member and Alumni included. `rush:read_notes` goes to the officer tiers in `STARTING_ROLE_TIERS` for new chapters. For existing chapters, granting it is opt-in per chapter, per #4068 decision 9.

**Identity.**
- **One PNM per school,** keyed on a verified school email, as the concept and the recruitment worker both have it.
- **Student ID** sits with the academic record ([§ 3.2](#32-storage)), never here, because a `pnms` row reaches chapters.

**Who writes a link between a PNM and a chapter (D7).** A `pnm_interests` row is written only in three ways:
1. the PNM submits that chapter's form;
2. the PNM names the chapter at council registration;
3. a council import of the PNM's own registration list names the chapter.

**An imported PNM reaches no chapter until they verify.** A council import creates `pnms` rows with `email_verified_at` null; those rows get no `pnm_interests` and no candidate until the person verifies their email and shows interest themselves. Being on a school's list isn't consent to be recruited (the recruitment doc's rule).

There is no `chapter_added` source. A chapter that adds someone by hand gets a chapter-only `rush_candidates` row with no `pnm_id`, as today. Typing a known school email never links it to an existing PNM. That's what stops a chapter attaching itself to a student who never chose it and reading their contact details and verdict.

**When a hand-added person later submits that chapter's form,** the officer is offered to link the two. The match is by email, and only against that chapter's own candidates. The officer confirms, and that's the only way a hand-added row gains a `pnm_id`.

**Interest and the chapter candidate are written together.** Function `record_pnm_interest(pnm_id, chapter_id, source)` inserts the `pnm_interests` row and creates or links the chapter's `rush_candidates` row in one transaction. It also writes the council registration when the chapter's form names a council for the term.

**The name rule covers hand-added candidates only.** Two different PNMs can share a name, so `rush_candidates_chapter_name_key` (`20260910020000_rush_candidates.sql`) is rebuilt as partial, `where origin = 'manual'`.
- **Why `origin` and not `pnm_id is null`.** `origin` never changes. A candidate created from a PNM stays `pnm` after the PNM is deleted and `pnm_id` goes null, so a deletion can't make it collide with a hand-added row and roll back.
- **A manual add still gets today's 409** when a hand-added candidate already has the name.
- **The name lookup changes, per the recruitment doc.** `SupabaseRushCandidateRepository.findByNameKey` reads with `.maybeSingle()` today, which would turn two matches into a 500. It becomes a list read: one match behaves as today, and several return `409` "Several prospects match" with their ids, so the slash command shows a picker.

**A council's master list is that council's registrations for the term,** for PNMs at the council's own school. Interest in one of its chapters doesn't add someone to a council's list unless the registration names that council. So a chapter in both the IFC and a multicultural council doesn't put an IFC registrant on the other council's list. A city-wide chapter's second school doesn't leak its students to the first school's council either, because the registration's `pnm.school_id` must equal the council's school.

**Data flows one way.** A `pnms` row holds only what every party may see: the PNM's own contact details, given for this purpose. Everything a chapter writes stays on the chapter side and has no path up (decision 11: "prospect notes and votes have no path up at all"). That includes the stage, notes, tags, rating and votes on `rush_candidates`.

**Merging duplicates** is a council officer's action (`council:recruitment_manage`) through function `merge_pnms(survivor, loser)`. It refuses when **either** row has an academic record, an eligibility verdict other than `pending`, or a release. A record must never travel to a different person, so those cases go to staff. Otherwise, in one transaction, it:
1. moves the loser's registrations and interests to the survivor, dropping any that duplicate the survivor's own (unique on `(pnm_id, council_id, term)` and `(pnm_id, chapter_id)`);
2. repoints each chapter's `rush_candidates.pnm_id` to the survivor. Where a chapter already has a candidate for the survivor, it asks that chapter to merge its two candidate rows rather than choosing for it;
3. sets `merged_into_id` on the loser.

Deleting the survivor deletes its merged rows too (`on delete cascade`), because they're the same person.

**Bids going up are push events, never reads.** The recruitment doc's push-up table (bid extended, recorded, rescinded or expired; a PNM's acceptance, decline or withdrawal) is stored as `pnm_recruitment_events` rows the chapter's or PNM's action writes in the same function call:

```sql
create table pnm_recruitment_events (
  id          bigint generated always as identity primary key,
  pnm_id      uuid not null references pnms(id) on delete cascade,
  council_id  uuid not null references chapters(id) on delete cascade,
  term        text not null,
  chapter_id  uuid references chapters(id) on delete set null,
  kind        text not null check (kind in ('bid_extended', 'bid_recorded', 'bid_rescinded', 'bid_expired',
                                            'bid_accepted', 'bid_declined', 'withdrew', 'deleted')),
  at          timestamptz not null default now(),
  foreign key (council_id, term) references council_recruitment_seasons (council_id, term) on delete cascade
);
```

Nothing a chapter writes in its pipeline reaches this table except through those named actions. The council reads it subject to the in-season limits in [§ 3.3](#33-who-sees-what).

**Cross-space unread** (ADR-27's `GET /v1/me/unread`) adds no table here. Council chat is ordinary chat in the council tenant, so counts come from the existing per-tenant chat tables, keyed by the caller's `members` rows (indexed on `user_id`, initial schema).

## 3. Eligibility and GPA

### 3.1 The call for Paul

Holding raw GPA is a security and legal decision, so it's Paul's (AGENTS.md § ADR discipline). The design is shaped so that decision is one row of this table, and the rest of the design doesn't move.

| Option | What Frapp stores | What it costs | What it buys |
|---|---|---|---|
| **A. Verdict only** | `pnm_eligibility` and the release. The import function computes the verdict and discards the grades in the same call | Officers can't see why someone failed, or fix an import mistake without re-importing. No grade reports later | Frapp never holds a grade value |
| **B. GPA, encrypted, purged when recruitment closes** (recommended; Winston's "store it, with extra care") | A, plus `pnm_academic_records`, purged within 30 days of the season closing, or at once on revocation | The full storage design below, two new secrets, and a FERPA-notice rewrite | Officers can review and correct records, and the store is short-lived |
| **C. GPA kept across terms** | B without the term purge, kept while the person is a member | Everything in B, plus long-lived records and a larger breach surface | Chapter standing and grade reporting, the concept's later phase |

**Every option requires a signed release** before a grade is imported, and before any verdict other than `pending` is written or shown (`pnm_eligibility.release_id`, below). A verdict is derived from an education record, so it needs consent too. Moving from A to B later is additive: the same tables plus `pnm_academic_records`.

### 3.2 Storage

```sql
create schema restricted;            -- PostgREST doesn't expose it ([api] schemas = ["public"])
revoke all on schema restricted from public, anon, authenticated;

create table restricted.ferpa_releases (
  id              uuid primary key default gen_random_uuid(),
  pnm_id          uuid not null references public.pnms(id) on delete cascade,
  school_id       uuid not null references public.schools(id) on delete cascade,
  council_id      uuid not null references public.chapters(id) on delete cascade,
  release_version text not null,     -- which approved text was shown; versioned in code like LEGAL_POLICY_VERSION
  records         text[] not null,   -- e.g. {gpa_cumulative, gpa_term, credits, enrollment}
  purpose         text not null,     -- "recruitment and membership eligibility"
  recipients      text[] not null,   -- e.g. {"Example State IFC", "Example State Office of FSL",
                                     --       "Frapp, as the council's service provider",
                                     --       "chapters you register interest with: eligibility status only"}
  signer_name     text not null,     -- typed full name
  authenticated_via text not null,   -- 'school_email_code': the verified address the form already requires
  signed_at       timestamptz not null,
  revoked_at      timestamptz,
  revoked_via     text
);

create table restricted.pnm_academic_records (     -- options B and C only
  id               uuid primary key default gen_random_uuid(),
  pnm_id           uuid not null references public.pnms(id) on delete cascade,
  council_id       uuid not null references public.chapters(id) on delete cascade,
  release_id       uuid not null references restricted.ferpa_releases(id) on delete cascade,
  term             text not null,
  student_id_hash  text,             -- HMAC of the student ID, for matching an import
  ciphertext       bytea not null,   -- AES-256-GCM of {student_id, gpa_cumulative, gpa_term, credits, enrolled}
  key_id           text not null,    -- which key encrypted it
  source           text not null check (source in ('office_import', 'council_import', 'self_report')),
  imported_by      uuid references public.users(id) on delete set null,
  imported_at      timestamptz not null default now(),
  purge_after      timestamptz not null,
  unique (pnm_id, council_id, term),
  foreign key (council_id, term) references council_recruitment_seasons (council_id, term) on delete cascade
);

create table public.pnm_eligibility (
  pnm_id       uuid not null references pnms(id) on delete cascade,
  council_id   uuid not null references chapters(id) on delete cascade,
  term         text not null,
  status       text not null default 'pending' check (status in ('pending', 'eligible', 'not_eligible')),
  release_id   uuid,                 -- the release in force; checked by the function that writes the verdict
  rule_version integer,
  decided_at   timestamptz,
  overridden_by uuid references users(id) on delete set null,
  primary key (pnm_id, council_id, term),
  foreign key (council_id, term) references council_recruitment_seasons (council_id, term) on delete cascade,
  constraint pnm_eligibility_needs_release check (status = 'pending' or release_id is not null)
);
-- RLS on, no policies, on every table above.
```

**Layers, from the outside in:**

1. **No client reaches it.** `restricted` isn't exposed, `anon` and `authenticated` have no grant, RLS is on with no policies, and Realtime never publishes it.
2. **Only security-definer functions read or write it, and each logs as it goes.** The functions are `import_academic_records`, `read_academic_record`, `purge_academic_records`, `record_ferpa_release`, `revoke_ferpa_release` and `delete_pnm`. Each writes its access-log row ([§ 3.4](#34-access-log)) in the same transaction, so a read whose log write fails returns nothing.
   - **Execute rights.** `execute` is granted to `service_role` only.
   - **The function rechecks scope.** It takes the acting tenant id and user id and checks them itself: the council is verified, the record belongs to that council, and a release is live. So a caller bug in the API can't widen what it returns.
3. **Encrypted in the application, not only on disk.** Supabase's disk encryption protects a stolen drive. It doesn't protect a leaked service-role key, a dump, a restored backup or a support login.
   - The API encrypts with AES-256-GCM before calling the import function and decrypts after `read_academic_record`, so the database never holds plaintext.
   - A GPA is never filtered in SQL. The council's rule ("GPA at least 2.5") is evaluated in the API at import, and only the verdict goes to `pnm_eligibility`.
   - Supabase has signalled that `pgsodium`'s column encryption is being wound down. That's derived, not checked against current docs, so it isn't the plan.
4. **One code path in the API.** An `AcademicRecordsService` with its own repository is the only caller of those functions. A dependency-cruiser rule forbids any other module importing the repository, and `check:dep-cruiser` is a required gate.

**Two new secrets, in their own Infisical path.**
- **The keys.** `ACADEMIC_RECORDS_ENCRYPTION_KEYS` is a JSON keyring by `key_id`, so rotation keeps old ciphertext readable until it's re-encrypted or purged. `ACADEMIC_RECORDS_HMAC_KEY` is for `student_id_hash`, with no rotation needed: rotating it only means re-hashing at the next import.
- **Why their own path.** Infisical syncs have no per-key filter, and every sync is configured at path `/` ([`SECRETS_MANAGEMENT.md` § 5](../../docs/internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs)). A secret at `/` therefore reaches every sync, including Vercel, and every Actions job that pulls the environment.
- **So the keys live at `/academic-records`.** Only one new sync carries that path, to the API's Render service. The existing `/` syncs don't, provided they don't pull recursively. That's not checked; it's the first thing the build verifies.
- This is open question [Q1](#8-open-questions-for-paul).

**Student ID** is the key a school's sheet arrives on (Student ID, HS GPA, College GPA, per the ICS research in #4192). **Only a school-supplied ID matches grades,** never one a PNM typed: a self-reported ID could otherwise pull another student's grades (the recruitment doc's rule).

```sql
create table restricted.pnm_student_ids (
  id          uuid primary key default gen_random_uuid(),
  pnm_id      uuid not null references public.pnms(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  id_hash     text not null,          -- HMAC with ACADEMIC_RECORDS_HMAC_KEY
  ciphertext  bytea not null,         -- the ID itself, encrypted like the grades
  key_id      text not null,
  source      text not null check (source in ('school_roster', 'grade_import', 'self_reported')),
  created_at  timestamptz not null default now()
);
create unique index pnm_student_ids_school_key
  on restricted.pnm_student_ids (school_id, id_hash) where source <> 'self_reported';
```

- **`import_academic_records` matches only on rows whose `source` isn't `self_reported`,** then on verified email. A row whose ID and email point at different PNMs is dropped and reported as a count.
- **A self-reported ID feeds only the merge queue's suggestions.** The partial unique index lets two PNMs both claim one, which is itself a merge suggestion.
- The ID is stored as an HMAC for matching and encrypted for the eligibility officer to read. `pnm_academic_records.student_id_hash` copies the matched hash.

**Who supplies GPA.** The school office or the council under the school's arrangement (`office_import`, `council_import`). `self_report` is in the check only so the choice is recorded: it's [Q6](#8-open-questions-for-paul), and stays refused unless Paul allows it. Self-reported GPA isn't FERPA data, but consumer privacy law still applies.

### 3.3 Who sees what

| Data | Chapter recruiter | Other chapters | Council officer | Council eligibility role | School office (a council role) |
|---|---|---|---|---|---|
| `pnms` shared fields (name, school email, class year) | If the PNM linked to their chapter (D7) | No ([Q5](#8-open-questions-for-paul)) | Yes, for registrants (`council:recruitment_view`) | Yes | Yes |
| Phone | If `phone_shared` and linked | No | Only with `council:recruitment_manage` ([Q10](#8-open-questions-for-paul)) | Yes | No |
| Which chapters a PNM is interested in, and bids | Own chapter only | No | **In season: counts only** ("interested in 3 chapters"). Per-chapter detail after the season closes | Same as officer | Same as officer |
| `pnm_eligibility.status` | Yes, for linked PNMs, when the release names chapters | No | Yes | Yes | Yes |
| Raw GPA, credits, student ID | **Never** | **Never** | **No, even with `*`** | Yes (`council:eligibility_manage`, explicit grant) | Only if granted `council:eligibility_manage`; `council:grades_import` uploads without reading |
| Chapter pipeline (stage, notes, tags, rating, votes) | Own chapter | No | **No** | **No** | **No** |

**Why the council sees counts in season.** Decided by Winston, 2026-11-11 ([#4192](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6805536573)): in season, the council sees each PNM's source (interest form, self-registered or import) and eligibility, plus per-chapter counts, and never which chapters a PNM signed up with. IFC officers are usually brothers in the chapters the council covers. If they could see which chapters a PNM is talking to, or who bid on whom, their own chapter would learn what the chapter rules deny it. So while `council_recruitment_seasons.status` is `open`, the council's endpoints aggregate interests and `pnm_recruitment_events` per PNM and per chapter. Acceptances are the exception, since chapters see "Accepted elsewhere" anyway. Every council read of a PNM record is logged, and the log is visible to the council admin and the school office (the recruitment doc's rule). This is enforced in the endpoint, not the table, so the test list covers it ([§ 4.3](#43-tests-that-must-exist), test 14).

Chapters see only a verdict, computed by the server. That's stricter than the releases the hub found: Boulder, Michigan, MSU and CMU give chapters the GPA itself. Strict is the right default for a vendor.

### 3.4 Access log

```sql
create table restricted.academic_record_access_log (
  id              bigint generated always as identity primary key,
  record_id       uuid,              -- null for an import row that matched nothing
  pnm_id          uuid,
  council_id      uuid not null,
  actor_user_id   uuid,
  actor_tenant_id uuid not null,
  action          text not null check (action in ('import', 'view', 'override', 'purge', 'revoke_purge',
                                                  'export_denied', 'grant', 'ungrant')),
  request_id      text,              -- ties to Sentry and API logs
  at              timestamptz not null default now()
);

create function restricted.refuse_access_log_change() returns trigger
  language plpgsql as $$ begin raise exception 'academic_record_access_log is append-only'; end $$;
create trigger academic_record_access_log_append_only
  before update or delete on restricted.academic_record_access_log
  for each row execute function restricted.refuse_access_log_change();
```

**Append-only is a trigger, not a policy.** `chapter_audit_log`'s `using (false)` policies (`20260523130000_audit_log.sql`) don't bind the service role, which bypasses RLS. The trigger binds everyone except a superuser running `alter table … disable trigger`, and that's on the migration record.

**Separate from `chapter_audit_log`.** That log mirrors member-visible rows into the `#chapter-audit` chat channel (`ChatBridgeWorkerService`), and a GPA access must never reach chat.

**What it holds.** No grade value. Its rows have no foreign keys and outlive the record they describe, so "was this seen?" can be answered after a purge.

**Who sees it.** The council's admin, and later the school office, see it on a council settings page, and eligibility officers know their reads are on it.

**Export.** A council can't export GPA (`export_denied` is logged). Exporting verdicts is fine.

### 3.5 Retention and deletion

| Event | What happens |
|---|---|
| The season closes | An hourly scheduled sweep, the pattern of `ReportRetentionService` (`apps/api/src/application/services/report-retention.service.ts`), calls `purge_academic_records`. It deletes rows where `purge_after < now()`: the season's `closes_at` plus a council setting of 0 to 30 days (the recruitment doc's default). Verdicts stay, and a `purge` row is logged per record. The same sweep copies each candidate's vote count to `final_vote_count` and then deletes the season's ballots |
| 30 days after the season closes | The chapter's notes, ratings, contact logs, form answers and follow-ups are deleted. Stage, bid outcome and dates stay (the recruitment doc's rule) |
| The season closes plus N days, for a PNM who never joined | `delete_pnm` runs for them. N is a council setting, default 180, so someone who rushes again next term keeps their history. These defaults are the recruitment doc's decision 7 for Paul |
| PNM revokes their release | Revocation is immediate and prospective. `revoke_ferpa_release` deletes the record, resets the verdict to `pending` with `release_id` null, and logs `revoke_purge`. The council's eligibility officers are notified. Deleting rather than keeping is the hub's "safest default"; whether the law requires it is lawyer question 4 |
| A Frapp user deletes their account | `anonymize_user` (called by `AccountDeletionService`) gains explicit statements, because the tombstoned `users` row fires no cascade: delete the person's `school_members` rows, and call `delete_pnm` for every `pnms` row with their `user_id`. That cascades registrations, interests, eligibility, releases and records. This is the PII scrub [`data-retention.md`](../behavior/data-retention.md) requires. Each chapter keeps its own candidate row with `pnm_id` null, as it keeps candidates today |
| A PNM with no account asks for deletion | Staff, or the council's `council:recruitment_manage` holder, calls `delete_pnm`, with the same cascade. Whether each chapter's own candidate row must also go is ⚑ [Q9](#8-open-questions-for-paul) |
| A council is deleted | Everything keyed to its `council_id` cascades: seasons, registrations, events, releases and academic records. The access log is kept. The school's `pnms` rows stay while another council at the school uses them; chapter candidates stay, unlinked |
| The school ends Frapp's access under a DPA | `purge_academic_records` runs for that school's councils, logging a row per record |

**The release** ([§ 3.2](#32-storage)) follows 34 CFR 99.30: signed and dated, naming the records, the purpose and the recipients. Electronic consent is acceptable if the signer is authenticated.
- **The text is legal copy, so it's Paul's** (⚑ [Q2](#8-open-questions-for-paul)). It's versioned in code so a change is reviewed.
- **It names Frapp as the council's service provider.** That's the hub's fix for the redisclosure rule (99.33); none of the school forms it found names a vendor.
- **Chapters are named as recipients of the verdict only.** When the release in force doesn't name chapters, chapters see `pending`.
- **A revoked release is kept** with `revoked_at` set, as the record of what was consented to and when. Only the grades are deleted.

## 4. Isolation

### 4.1 RLS

| Table | RLS | Policies | Realtime |
|---|---|---|---|
| `schools`, `school_email_domains`, `school_members` | On | None | No |
| `school_chapters`, `council_chapters` | On | None | No |
| `pnms`, `pnm_council_registrations`, `pnm_interests`, `pnm_eligibility` | On | None | No |
| `rush_candidates` (new column) | On (today) | None (today) | No |
| `restricted.*` | On | None, and no schema grant. The access log adds an append-only trigger | Never |

- **Council chat and events need no new RLS.** A council is a `chapters` row, so `realtime_can_read_chapter_scope(council_id)` already checks council membership.
- **RLS work starts with campus-wide channels (phase 5).** They'd need a `realtime_can_read_school_scope` over `school_members`. That's out of scope here, and recorded so it isn't assumed.

### 4.2 API guards

Each rule here builds on ADR-27's guard order: `ChapterGuard` resolves the tenant from `x-chapter-id` (or the claim), checks membership, then checks the route's declared kinds. A wrong kind or a non-member gets `403 chapter.context.invalid`.

1. **Every council route declares `@TenantKinds('council')`.** Every chapter route keeps ADR-27's chapter-only default. Two consequences:
   - **A chapter's `*` doesn't reach council keys.** A chapter President calling a council route with their own chapter's id is refused by the kind check before `PermissionsGuard` runs. With a council's id, they're refused as a non-member.
   - **A chapter's own `council:` strings do nothing.** A chapter role can hold any string ([`rbac.md` § Permission Model](../behavior/rbac.md#permission-model)), so a chapter could grant itself `council:recruitment_view`, but it would never reach a council route.

   A contract test fails when a route requires a `council:` key without declaring the council kind ([§ 4.3](#43-tests-that-must-exist)).
2. **Explicit-grant keys (D9).** `council:grades_import` and `council:eligibility_manage` are explicit-grant keys.
   - **`*` doesn't satisfy them.** `PermissionsGuard` today returns `true` on `*` before any key check (`permissions.guard.ts`), and `RbacService` does the same. Both check an `EXPLICIT_GRANT_PERMISSIONS` list first: a route requiring one of these passes only if one of the member's roles lists the key itself.
   - **Role edits can't grant them.** Role create and update, tier edits, overrides, custom-role capabilities and the Discord import all refuse to add or remove these keys (`400 roles.permission.explicit_grant`). They move only through `PUT /v1/council/eligibility-officers`, which:
     - takes the council admin (the `PRESIDENT`-key role);
     - needs a verified council;
     - logs `grant` or `ungrant` in the access log;
     - notifies every current holder and the admin.

     So neither `*` nor `roles:manage` alone reads a GPA, and every change of who can is on the record.
3. **Reserved namespaces.** Role create and update refuse a `council:` string in a chapter tenant (`400 roles.permission.reserved`). It's belt and braces with rule 1, and it keeps keys that do nothing out of a chapter's role editor.
4. **Cross-tenant reads only through endpoints built for them, each scoped by a join, never by an id alone.**
   - **A chapter reading its PNMs.** The route serves the chapter kind. It reads `pnms` and `pnm_eligibility` only for a PNM with a `pnm_interests` row for the active chapter, or one linked through the active chapter's `rush_candidates.pnm_id`. Any other id returns **404**, not 403, because PNM ids are guessable and a 403 confirms the id exists ([`multi-tenancy.md`](../behavior/multi-tenancy.md) § 403 vs 404).
   - **A council reading its master list.** The route serves the council kind and needs `council:recruitment_view`. It reads only:
     - registrations for its own `council_id` and term;
     - from PNMs at its own school;
     - with interests limited to its `accepted` chapters.

     It never reads `rush_candidates`. An unverified council, or one with no accepted chapter, gets an empty list.
   - **A council reaching a chapter's officers** (phase 2). This is a council write that delivers into each accepted chapter's notifications, for the roles the chapter has marked as council contacts. It isn't a read of the chapter.
   - **School pages.** They resolve a school through `x-school-id` and ADR-27's `SchoolGuard`, which checks for a live `school_members` row. They read only `schools`, the school's active `school_chapters` and the public fields of those tenants.

### 4.3 Tests that must exist

These extend the layers [`multi-tenancy.md` § How the invariant is tested](../behavior/multi-tenancy.md) already requires, on top of ADR-27's ten.

**Route level** (`apps/api/test/cross-tenant-isolation.e2e-spec.ts`):
1. A council officer names an accepted chapter of their council on any chapter route: `403 chapter.context.invalid`, whatever their token's claim says.
2. A chapter President (`*`) names their own chapter on every council route (enumerated from route metadata): `403 chapter.context.invalid` from the kind check.
3. **Explicit-grant keys:**
   - A council admin (`*`) without an explicit grant calls `read_academic_record`'s route and is refused. Granted through the eligibility-officer endpoint, they're served.
   - A council `roles:manage` holder who tries to add `council:eligibility_manage` to a role gets `400 roles.permission.explicit_grant`, and the role is unchanged.
4. A chapter role write containing `council:recruitment_view` gets `400 roles.permission.reserved`. This is tested on its own, apart from test 2.
5. **A chapter can't read a PNM it isn't linked to.**
   - Chapter A can't read a PNM linked only to chapter B: 404.
   - Chapter A hand-adds a candidate with that PNM's school email: the candidate gets no `pnm_id`, and reading the PNM is still 404.
   - Chapter A can't read chapter B's `rush_candidates` row for a PNM both are linked to: 404.
6. **A council sees only its own.**
   - Council X can't read council Y's master list, eligibility or records, at one school (IFC against Panhellenic) or two.
   - A chapter accepted in both councils doesn't put X's registrant on Y's list.
7. Council routes never return `rush_candidates`, its notes or its votes. This is asserted by enumerating the council's routes and the serialized bodies.
8. An unverified council, or one with only `proposed` links, gets empty lists and `403` on grade import.
9. A read of a GPA writes an access-log row with the actor and tenant. When the log insert is made to fail, the read returns no record.
10. A chapter's PNM response never contains a GPA, credit or student-ID field, even for a PNM with a record. This is asserted on the serialized body.
11. A verdict other than `pending` is never shown to a chapter when the release in force doesn't name chapters, or when there's no release.
12. **Revocation:** the record is gone, the verdict is `pending` with no `release_id`, and a `revoke_purge` row exists.
13. `set_council_chapter_status` refuses a link to a tenant of the wrong kind, or to a pair with no shared active school.
14. **In-season counts:** while the season is `open`, every council route returns interests and bids as counts, never as PNM-and-chapter pairs (acceptances excepted). After it closes, the per-chapter detail appears. A council `recruitment_view` holder never receives a phone number.
15. **Grades never match a self-reported ID:** an import row whose student ID matches only a `self_reported` row is dropped, and no record or verdict is written.
16. **Bid state:** Extend on a candidate whose `bid_state` is `accepted` or `declined` returns 409, and the legacy `bid_status` reads `extended` for `accepted` and `none` for the rest.

**Function and migration level** (`npm run check:pglite-migrations`, which runs SQL against a real Postgres):
- **Purge:** `purge_academic_records` deletes exactly the rows past `purge_after`, and keeps the one a second short of it.
- **Account deletion:** `anonymize_user` deletes `school_members` and every `pnms` row for the user, with its cascade, and leaves the chapter's candidate row with `pnm_id` null.
- **Merge:** `merge_pnms` refuses when either side has a record, a non-pending verdict or a release. On success it moves interests without violating the unique indexes.
- **Append-only:** the access log refuses update and delete as the service role.
- **Domains:** `verify_school_domain` refuses an overlapping domain.
- **Names:** a hand-added duplicate name is refused, two PNM-linked candidates may share a name, and deleting a linked PNM never collides with the partial index.
- **Existing chapters:** after the school migration, no `chapters`, `members` or `roles` row changed, and every chapter is `kind = 'chapter'`.

**Repository level** (`createTenantHarness`, ledgered in `tenant-scope-coverage.spec.ts`):
- **A colliding-twin spec per new repository.** Two councils at one school (registrations, eligibility), two schools (`school_members`, `pnms`), two chapters (`pnm_interests`), each proving its filter is applied.
- **The academic-records repository gets a real spec, not a backlog entry.** It passes the acting council and asserts the function's arguments carry it.
- **Each tenant-paging sweep** gains a council twin and proves it's filtered by kind.

**Shared code in a council.** One API spec runs presidency claim, invite redemption with and without a named role, and the default-invite fallback in a seeded council ([§ 5.3](#53-creating-a-council-picking-a-role-renaming-titles)).

## 5. Permission scopes and council roles

### 5.1 Council scope

`PermissionScope` (`packages/validation/src/permission-registry.ts`) is `"chapter"` today, kept "so a level above the chapter can later add its own keys to this list without a second catalog". It becomes:

```ts
export type PermissionScope = "chapter" | "council";
```

New registry entries (`councilPermission(...)`) are mirrored in `SystemPermissions` (`apps/api/src/domain/constants/permissions.ts`), where `permissions.spec.ts` already fails if the two lists drift.

| Key | Module | Grants |
|---|---|---|
| `council:chapters_manage` | council | Propose, accept, suspend and end member chapters |
| `council:recruitment_view` | council-recruitment | Read the master list: PNM fields, interest **counts**, verdicts, acceptances (in-season limits, [§ 3.3](#33-who-sees-what)) |
| `council:recruitment_manage` | council-recruitment | The council's registration form, roster imports, merges, deleting a PNM on request, season dates and rules, bid-day release, and PNM phone numbers |
| `council:grades_import` | council-recruitment | **Explicit grant.** Upload grade files and see the import summary (counts). Reads no grade |
| `council:eligibility_manage` | council-recruitment | **Explicit grant.** Read GPA, credits and student ID, set the eligibility rule, override a verdict. Includes `council:grades_import`. Every read is logged |
| `council:recruitment_reports` | council-recruitment | Export the Greek life office's reports |
| `council:announce` | council | Announcements to member chapters' council contacts |
| `council:calendar_manage` | council | The council calendar member chapters see |

- **`PERMISSION_MODULES` gains `council` and `council-recruitment`.** `PermissionDefinition` gains `explicitGrant: boolean`, and `EXPLICIT_GRANT_PERMISSIONS` is derived from it, so the guard and the role editor read one list.
- **The catalog filters by tenant kind.** `GET /v1/roles/permissions-catalog` returns chapter keys to a chapter. A council gets the council keys, plus the shared chapter keys a council uses: `members:view`, roles, chat, events, documents, billing and the audit log. Explicit-grant keys appear in a council's role editor read-only, with a link to the eligibility-officer page.
- **`PermissionsGuard` changes in one place only:** the explicit-grant check ahead of the wildcard (§ 4.2 rule 2). Tenant kind is ADR-27's check.
- **School-level roles:** none in this design ([§ 5.2](#52-school-level-roles)).

### 5.2 School-level roles

There's no school-scope key and no school tenant.
- **Greek life office staff are members of the council** with a role holding `council:grades_import` and `council:recruitment_reports`, as the recruitment doc has it. They read GPA only if the council admin grants them `council:eligibility_manage`.
- **The school-level duties** (names, domains, duplicate councils, council verification) are Frapp staff's until a school asks for more. A school tenant of its own stays possible later ([Q8](#8-open-questions-for-paul)).
- **Campus moderation is not office work.** Winston: council officers moderate school-wide spaces. That's a council key (`council:campus_moderate`) added with phase 5.

### 5.3 Creating a council, picking a role, renaming titles

Winston: any IFC member can create the council, the creator picks their own role, and titles are customizable.

1. **Seed data.** `create_council` seeds a council role pack, which is data beside `STARTING_ROLE_TIERS` and `DEFAULT_SYSTEM_ROLES`: `COUNCIL_STARTING_ROLE_TIERS` and `COUNCIL_SEEDED_ROLES`, chosen by kind. No code branches on a role's name.
   - **Tiers:** Executive board, Officers, Delegates. Every tier carries `members:view`, the baseline every member route needs ([`rbac.md`](../behavior/rbac.md) § Role Lifecycle). The Executive board tier adds `council:recruitment_view`, `council:announce`, `council:calendar_manage` and `council:chapters_manage`.
   - **Roles, each with the `system_key` the shared code resolves:**
     - **Council admin** (`PRESIDENT`, holding `*` as an override, as a chapter's President does);
     - President, VP Recruitment, VP Judicial, Treasurer and Secretary in Executive board;
     - **Delegate** (`MEMBER`) in Delegates.
   - **Why Delegate carries `MEMBER`.** Delegate is the floor that presidency claim walks to (`RbacService.resolveEligibleClaimants`), the invite fallback (`InviteService`) and the base access an outgoing President keeps.
   - **What VP Recruitment gets.** `council:recruitment_manage` and `council:recruitment_manage` as overrides. The eligibility keys come only through the explicit grant, which the creation flow offers right after setup.
   - **What a council doesn't get.** No `NEW_MEMBER` or `ALUMNI` role: semester rollover, which needs them, serves the chapter kind only. The spec in [§ 4.3](#43-tests-that-must-exist) proves claim, invite and redeem work in a council.
2. **Picking a role.** The creation flow shows the seeded titles plus "Something else", which names a new role in Executive board. The creator gets the role they picked **and** Council admin. That separates the creator's title, say VP Recruitment, from who holds the wildcard until the real President takes it, through the existing Transfer presidency flow ([`rbac.md` § Presidency Transfer](../behavior/rbac.md#presidency-transfer)).
3. **Renaming.** Every seeded role and tier renames the way a chapter's do. `system_key` makes a rename a pure relabel, so Council admin can be renamed too. Different IFCs' titles fit one structure because only `system_key` carries meaning, never a name.
4. **Who may create.**
   - The creator needs a verified `school_members` row at that school.
   - The school must have no council of that type yet.
   - The council starts **unverified**. It can propose links to chapters and set itself up (`@FreeTier` routes, § 1). It sees nothing until links are accepted, and can't import grades, collect releases or grant eligibility officers until staff, or later the school's FSL office, set `council_verified_at` (ADR-27). How the real IFC proves itself is ⚑ [Q4](#8-open-questions-for-paul).

## 6. Risks

Plainly, for Paul.

**Legal** (unverified, and not legal advice):
- **Frapp's FERPA notice would become untrue.** [`spec/behavior/legal.md`](../behavior/legal.md) § FERPA Notice, and the published `/ferpa` page, say Frapp "does not access student education records". Options B and C break that sentence. Option A arguably doesn't hold grades, but it does hold verdicts derived from them, so A needs counsel too.
- **FERPA binds schools, not Frapp.** Frapp is reached through the school's contract and the redisclosure rule. A school that finds a redisclosure can bar the recipient for five years (34 CFR 99.67, per the hub), so one bad export by one council could cost every chapter at that school.
- **The lawful path is unsettled.** It's either the school-official exception (a DPA under which the school controls retention and deletion) or written consent under 99.30. The design supports both, but which applies changes who Frapp's customer is for this data. So does whether an IFC is a student organization or a school body.
- **A verdict is a disclosure.** "Not eligible" tells a chapter something about a GPA. That's why chapters see a verdict only when the release names them.
- **State law.** CCPA/CPRA lists "education information" with no FERPA exemption, so it may reach a for-profit Frapp. SOPIPA and NY Ed Law 2-d look K-12 only. Breach-notice rules differ by state, and a GPA alone may not trigger them.
- **Schools will ask for paperwork Frapp doesn't have:** a DPA (purpose limits, no sale, subprocessor approval, deletion on request, audit rights) and the HECVAT security questionnaire. Without them, an office may refuse to send grades, and the feature falls back to option A or self-report.

**Security:**
- **An explicit-grant check missed anywhere reopens GPA to every admin.** The wildcard short-circuit lives in both `PermissionsGuard` and `RbacService`. Both must check explicit-grant keys first, and test 3 covers each.
- **A missing kind declaration** on a council route opens it to every chapter member who names their own chapter. ADR-27's chapter-only default protects chapter routes. The contract test protects council routes.
- **A key compromise exposes every stored GPA.** Encryption moves the crown jewel from the database to the keyring. It must live only at its own Infisical path and reach only the API's runtime, which needs a sync split that doesn't exist yet ([§ 3.2](#32-storage)).
- **An eligibility officer can browse GPAs.** The log is a deterrent, not a wall. Narrowing that needs per-read reasons, or a view limited to the current import's mismatches, and both are product costs.
- **Security-definer functions are the new attack surface.** Each takes the actor and tenant as arguments and must recheck them itself. A function that trusts its caller turns any API bug into a GPA read.
- **The automatic `.edu` match** trusts the directory's school-to-domain pairing. A wrong pairing lets the wrong students verify, until staff reverse it.
- **Councils are a new tenant kind that every all-tenants sweep sees** (§ 1). A forgotten kind filter sends a council dues reminders, or counts it as a paying chapter.
- **A wrong merge** would show one student's verdict under another's name. `merge_pnms` refuses any merge that touches a verdict, record or release.

**Product:**
- **PNMs under 18.** A form submitter has no account and accepts no Terms, so nothing today stops a 17-year-old's details landing in `pnms`. The 18+ Terms (#2261) cover accounts only. ⚑ [Q11](#8-open-questions-for-paul).
- **Council officers see PNM phone numbers.** Even with the in-season counts, `council:recruitment_manage` shows every PNM's phone to an officer who is usually a chapter brother. ⚑ [Q10](#8-open-questions-for-paul).
- **A council officer who is also a chapter member** holds two memberships. ADR-27's per-tab URL context and keyed remount must keep the client caches apart.
- **The email-domain gate excludes real students:** personal addresses, transfers, schools with several domains. Staff verification (`verified_via = 'staff'`) is the escape hatch, and it's manual.

## 7. Migrating existing chapters

Nothing any chapter can do changes. No `chapters`, `members` or `roles` value is written beyond the new columns' defaults.

1. **Schema.** Add `chapters.kind` (default `'chapter'`) and the council columns, plus the new tables. Step 1 backfills nothing.
2. **Propose schools from the data we have.**
   - **Sources.** `chapters.university` is free text and `not null` (`00000000000000_initial_schema.sql`). `chapter_directory` held 13,327 rows with `university`, `university_short` and aliases at `88c2b85` (`20261107043100_chapter_directory_wikipedia_rows.sql`). A chapter claimed from the directory has `directory_id`.
   - **The script.** A new script (say `scripts/school-backfill.mjs`) writes a review sheet: chapter, its `university` text, the proposed school and match confidence. A chapter with `directory_id` takes its directory row's school. Any other chapter's text is matched by normalized name and alias.
   - **A person reviews the sheet.** Free text like "ESU", "Example State" and "Example State University" must land on one school, and only a person can confirm the long tail.
3. **Apply the reviewed sheet** as a data fix in `supabase/data-fixes/`, per environment.
   - It creates one `schools` row per confirmed school (`unverified`, with aliases) and one `school_chapters` row per confirmed chapter, at status **`proposed`**.
   - **Each chapter's officers confirm** in the app (ADR-27). Until then the chapter is exactly as it was.
   - **Unmatched chapters** get nothing.
   - **Phi Gamma Delta** is placed through the same sheet and the same confirmation. The production run is Paul's.
4. **Email domains** have no source in our data. They're proposed when a school's first council or chapter asks, and verified by the `.edu` match or the staff queue.
5. **Members aren't enrolled automatically.** After their chapter joins a school, a member is invited to verify their school email: Winston's scenario of "an existing member whose chapter gets placed in a school". The UI worker owns the prompt.
6. **Later, in its own migration:** `chapters.university` becomes derived from the primary active `school_chapters` row where one exists. It's dropped only once nothing reads it, and that migration names its readers.

**Proving the migration.** The pglite tier in [§ 4.3](#43-tests-that-must-exist) proves no existing row changed. `check:migration-safety` checks the files and ledgers, and Squawk checks the DDL. The constraint is written `not valid` and then validated, for Squawk's sake.

## 8. Open questions for Paul

⚑ marks a raise-first item (AGENTS.md § ADR discipline: security, legal or App Store copy, data deletion, pricing). Nothing on it is built until Paul says go.

1. **Q1 ⚑ Store GPA?** Option A, B (recommended) or C, from [§ 3.1](#31-the-call-for-paul). For B or C, also:
   - may the two `ACADEMIC_RECORDS_*` secrets live at their own Infisical path `/academic-records`;
   - with one new sync to the API's Render service only?
2. **Q2 ⚑ The FERPA notice and the release text.** Both are legal copy. Will counsel review them, with the lawyer questions below, before any grade or verdict is stored?
3. **Q3 ⚑ Council billing.** Winston: someone on the IFC pays. A council row can hold its own Stripe subscription today. Two questions:
   - What plan, at what price?
   - Which council features stay `@FreeTier`? The proposal is setup, chapter links and roles.
4. **Q4 ⚑ Who creates a school, and who verifies a council?** This gates GPA access.
   - **Proposed:** any verified student creates an unverified council, and staff (later the school's FSL office) verify it before grade import opens.
   - **What proof counts?** The FSL office confirming, or a national umbrella such as NIC for an IFC?
5. **Q5 ⚑ What do other chapters see on the master list?** Winston deferred it. Proposed: nothing, until a council turns on "chapters see all registrants' shared fields", a per-council setting, off by default.
6. **Q6 ⚑ Self-reported GPA:** allow it as a fallback where a school won't send grades, or refuse it? This is also lawyer question 6.
7. **Q7 Bids pushed up.** The recruitment doc sends bid events to the council (`pnm_recruitment_events`), shown as counts while the season is open. Decision 11 allows a push, never a read; is that push wanted?
8. **Q8 School office staff** are a role on the council for now ([§ 5.2](#52-school-level-roles)). Is that enough, or should a school get a tenant of its own when one asks?
9. **Q9 ⚑ A PNM's deletion request and chapters' own candidate rows.** When a PNM with no account asks to be deleted, is each chapter's candidate row the chapter's own data, which it keeps with `pnm_id` null as today, or must it go too?
10. **Q10 ⚑ Council officers and PNM phone numbers.** An officer with `council:recruitment_manage` sees every PNM's phone, and is usually a chapter brother. Accept it with read logging, hide phone from the council, or require a neutrality pledge (the recruitment doc's decision 9).
11. **Q11 ⚑ PNMs under 18.** The Terms require 18 (#2261), and some first-year PNMs are 17. A `pnms` row needs no account, so the form itself must ask the age question or refuse; allowing minors means a Terms change and parental consent (the recruitment doc's decision 4).

**Lawyer questions** (from the hub's FERPA research), for Q2:
1. Which path is Frapp on: school official (DPA), the council's agent, or a recipient named in a 99.30 consent?
2. Is an IFC a student organization or a school body, for FERPA purposes?
3. Does CCPA/CPRA apply to Frapp's handling of education information?
4. After revocation, must stored GPAs be deleted, or only not used again?
5. What breach-notice window should a DPA commit to, and which states' laws apply?
6. May Frapp accept self-reported GPA, and under what notice?
7. Is "deleted within 30 days of the season closing" a defensible retention period?

## 9. Specs this would change

If Paul accepts this, the PR that builds each part rewrites these in the same change:

| Spec | What changes |
|---|---|
| [`spec/behavior/multi-tenancy.md`](../behavior/multi-tenancy.md) | Its invariant says every query is scoped to the caller's chapter. The council master list and school pages are the named exceptions: cross-tenant reads through the joins in [§ 4.2](#42-api-guards). ADR-27 rewrites the context sections |
| [`spec/behavior/rbac.md`](../behavior/rbac.md) | "Any string is valid" gains the reserved `council:` namespace in chapters and the explicit-grant keys. Council role packs join Role Lifecycle |
| [`spec/behavior/rush.md`](../behavior/rush.md) | Through the recruitment doc (PR #4218), which owns the behavior: candidates link to a PNM, the name rule covers hand-added rows, a name matching several returns 409, `bid_state` beside `bid_status`, stage categories, `rush:read_notes` |
| [`spec/behavior/data-retention.md`](../behavior/data-retention.md) | Account deletion scrubs `school_members` and `pnms`. Academic records have the retention in [§ 3.5](#35-retention-and-deletion) |
| [`spec/behavior/legal.md`](../behavior/legal.md) | The FERPA notice (Q2) |
| [`spec/architecture/README.md`](README.md) § 5 | The new tables join the data model |
