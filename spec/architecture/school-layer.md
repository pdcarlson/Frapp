# School layer: data model and permissions

**Status: Proposed, pending Paul.** Nothing here is built. Asked by Winston (`whewitt-frapp`), 2026-11-11, for [#4192](https://github.com/pdcarlson/Frapp/issues/4192).

This doc covers one part of the design: the tables, the isolation rules, the permission scopes and the migration of existing chapters. Three other parts of #4192 are written separately, and this doc doesn't decide them:

- the URL and tenant-context framework and its ADR (`/c/<slug>`, `/s/<school>`);
- the screens;
- the IFC recruitment module (pipeline stages, forms, the master-list screens).

Where this doc depends on one of them, it says so.

The concept this builds on is [#4192 § Concept](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804509311), with Winston's answers in [#4192 § answers](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804810927).

**Statements about today's schema** were read from `supabase/migrations` on `main` at `88c2b85` and cite the migration. **Statements about law** come from search excerpts relayed by the hub. They are not verified and they are not legal advice ([§ 6](#6-risks)).

## Contents

1. [Decisions this design makes](#1-decisions-this-design-makes)
2. [Tables](#2-tables)
3. [Eligibility and GPA](#3-eligibility-and-gpa)
4. [Isolation](#4-isolation)
5. [Permission scopes and council roles](#5-permission-scopes-and-council-roles)
6. [Risks](#6-risks)
7. [Migrating existing chapters](#7-migrating-existing-chapters)
8. [Open questions for Paul](#8-open-questions-for-paul)

## 1. Decisions this design makes

| # | Decision | Why, in one line |
|---|---|---|
| D1 | A council is a row in `chapters` with `kind = 'council'` | It gets roles, tiers, chat, events, documents, the audit log and Stripe for free, and tenant isolation already separates it from every chapter |
| D2 | Chapters link to a school and to a council through affiliation tables, never a parent column | Paul's [#4068](https://github.com/pdcarlson/Frapp/issues/4068) decision 11 |
| D3 | `schools` is its own table, with verified email domains in their own table | A domain must belong to exactly one school, and only a unique row can enforce that |
| D4 | `school_members` is a person's own record, apart from `members` | Winston, 2026-11-11: a person belongs to their school directly and stays after leaving a chapter |
| D5 | One `pnms` row per person per school, and a PNM needs no Frapp account | One record, many chapters' interest; a QR-code form works without the app |
| D6 | `rush_candidates` is extended with a nullable `pnm_id`, not replaced | Its API, chat commands and anonymous votes keep working, and a chapter can still add a candidate the council never sees |
| D7 | Raw GPA lives in a restricted, encrypted table that only the API reads, and every read writes an access-log row | Winston chose to store GPA "with extra care". Whether to store it at all is Paul's call ([§ 3.1](#31-the-call-for-paul)) |
| D8 | Endpoints scoped to a council or school check the tenant's **kind** as well as the permission | A chapter President holds `*`, which would otherwise satisfy every `council:*` check |

### Why a council is a kind of chapter (D1)

Winston's words: a council "literally follows the same structure, just different role names". The real schema bears that out.

- **The tenant table carries everything a council needs.** About 52 tables take a `chapter_id` foreign key to `chapters`, from `roles` and `role_tiers` to `chat_channels`, `events`, `chapter_documents`, `chapter_audit_log`, `invites` and `notifications`. Stripe sits on the tenant row too (`stripe_customer_id`, `subscription_status`, `00000000000000_initial_schema.sql`). So a council row gets every one of them, and Winston's "someone on the IFC pays" falls out of the existing billing model.
- **#4071's tiers apply unchanged.** `role_tiers`, `roles.tier_id` and `roles.permission_overrides` (`20261111140000_role_tiers.sql`) key on `chapter_id`, and the database keeps `roles.permissions` true. `PermissionsGuard` reads that one column, filtered to the active tenant (`apps/api/src/interface/guards/permissions.guard.ts`). A council's role editor is the same page with council keys in it ([§ 5](#5-permission-scopes-and-council-roles)).
- **Isolation is the default, not a feature to build.** A council officer is a `members` row in the council's tenant, not in any chapter. `ChapterGuard` resolves one tenant per request and checks membership in it (`apps/api/src/interface/guards/chapter.guard.ts`). So a council officer is refused every chapter route, today's included, with no new code. RLS agrees: `realtime_can_read_chapter_scope` checks membership by tenant id (`20260827190000_secdef_search_path_pg_temp.sql`), so a council officer can't subscribe to a chapter's Realtime topics either.
- **It matches decision 11.** A council is a peer tenant that a chapter affiliates with. It isn't a parent that can read the chapter.

**The separate-table option, and why not.** A separate `councils` table, with `council_members`, `council_roles`, and council chat, events and documents, keeps the data further apart. But it would rebuild roles, tiers, overrides, rank rules, presidency transfer, the audit log, chat and billing a second time, and every later fix would have to land twice. The separation it buys already holds, because the two are different tenants.

**What the kind costs, and how to contain it.** A council row shows up in every query that pages all of `chapters`. Each such query has to say which kinds it means:

- **Scheduled sweeps that read every tenant** (`findChaptersWithStalePalette`, the dues, task and event reminders in `supabase-scheduled-jobs.repository.ts`). Most of them are harmless for a council: a council with no dues config has no invoices to remind about. Each one still gets an explicit kind filter, or a recorded reason for not having one, in its existing tenant-scope spec.
- **Chapter counts, analytics and the chapter-directory claim flow** (`chapters.directory_id`, `chapter_directory_requests`). A council is never claimed from the directory, and isn't counted as a chapter.
- **The chapter list a user sees** (the switcher, `/v1/users/me/chapters`). This list should include councils, grouped apart from chapters. The framework worker owns that UI.
- **Modules.** A council's `enabled_modules` comes from its archetype ([§ 2.3](#23-councils)), so modules it should never have (points, study zones, backwork) are off and can't be turned on.

## 2. Tables

Every new table follows the house posture: RLS is enabled with **no policies**, the API reaches it through the service-role client, and the API is the only control on every REST path. The two exceptions are the restricted academic tables, which get a stronger posture ([§ 3.2](#32-storage)), and anything later added to Realtime ([§ 4.1](#41-rls)).

### 2.1 Schools

```sql
create table schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,            -- "Example State University"
  short_name  text not null,            -- "ESU" (example)
  slug        text not null unique,     -- URL segment for /s/<school>; the framework worker owns its format
  status      text not null default 'unverified'
              check (status in ('unverified', 'verified', 'suspended')),
  directory_university text,            -- the chapter_directory.university value this school was matched from
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table school_email_domains (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references schools(id) on delete cascade,
  domain             text not null,          -- lower-case, no leading "@" or "."
  include_subdomains boolean not null default false,  -- student.example.edu under example.edu
  verified_at        timestamptz,            -- null: proposed, not yet trusted
  verified_by        uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint school_email_domains_domain_lower check (domain = lower(domain))
);
create unique index school_email_domains_domain_key on school_email_domains (domain);
```

- **Domains are rows, not a `text[]` on `schools`.** A unique index across schools is what stops a second "school" from claiming `example.edu` and receiving its students. An array column can't enforce that.
- **Only a verified domain verifies students.** Frapp support verifies a domain at first. Later, the school office tenant's `school:manage` holder can do it ([§ 5.2](#52-school-scope-and-the-office-tenant)). Anyone can propose a domain, and proposing one does nothing until it is verified.
- **A school is created** by Frapp support, by the founder of a council, or by a chapter founder whose school isn't on Frapp yet. Each of these creates a school with `status = 'unverified'`. An unverified school can hold affiliations, but its students can't verify against it and nothing campus-wide opens on it. That covers Winston's scenario of a founder at a school not yet on Frapp. Which of these actors may create a school is open question [Q4](#8-open-questions-for-paul).

### 2.2 School membership

```sql
create table school_members (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references schools(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  status           text not null default 'student'
                   check (status in ('student', 'alum', 'staff')),
  verified_via     text not null check (verified_via in ('email_code', 'sso', 'support')),
  verified_email   text,                  -- the school address the code went to; lower-case
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

- **A row exists only once the person has proved they're at the school.** That means a one-time code sent to an address on a verified domain, or SSO later. A chapter membership doesn't create one. If it did, any chapter founder could enrol a whole roster in a school they picked.
- **Leaving a chapter doesn't touch this row.** `MemberService.remove` and leaving a chapter both delete a `members` row, and nothing here references `members`. That's Winston's D4.
- **A PNM is not a status here.** The concept listed `status: pnm`. It's dropped, because a PNM may have no Frapp account and `school_members.user_id` is required. A person's PNM side is their `pnms` row ([§ 2.5](#25-pnms-and-interest)). A PNM who makes an account and verifies their email becomes `student`, and the two records link through `pnms.user_id`.
- **Graduation** moves `status` to `alum` (by hand, or on class year once there is a field for it). Alumni keep their record, like Handshake and Slack, and unlike Handshake's SSO cut-off.
- **The directory is off by default** (`hidden`). The three levels are the concept's. What other chapters can see of a visible member is a phase 5 decision ([§ 8](#8-open-questions-for-paul)).
- **Account deletion** cascades on `user_id`. `anonymize_user` must delete the row explicitly as well, so the purge is proved by its spec rather than assumed from a foreign key ([§ 3.5](#35-retention-and-deletion)).

### 2.3 Councils

```sql
alter table chapters
  add column kind text not null default 'chapter'
    check (kind in ('chapter', 'council', 'office')),
  add column council_type text
    check (council_type in ('ifc', 'panhellenic', 'nphc', 'mgc', 'other')),
  add constraint chapters_council_type_kind
    check ((kind = 'council') = (council_type is not null));
```

- **`kind = 'office'`** is the school's Greek life office, as a tenant ([§ 5.2](#52-school-scope-and-the-office-tenant)). It's optional and comes later than councils. It's in the check now so the column is written once.
- **The archetype is not the council type.** `chapters.org_archetype` already uses `ifc` to mean *an IFC member fraternity* (`packages/org-archetypes/src/index.ts`, default `'ifc'` in `20260523120000_chapter_customization.sql`). A council therefore gets a new archetype key, `council`, whose module map enables:
  - chat, announcements, events, documents, members and the audit log;
  - billing, for the council's own plan;
  - a new `council-recruitment` module.

  It turns off points, hours, dues to members, backwork, study zones, tasks and rush. `council_type` says which council it is.
- **`Archetype.council` already names each archetype's council** ("Interfraternity Council" for `ifc`, "Panhellenic Council" for `npc`, and so on). That gives a ready default for which council type a chapter may affiliate with ([§ 2.4](#24-affiliations)).
- **`chapters.university` stays as it is** on a council row. It's `not null`, and a council has a school, so the council's school name fills it. It goes stale once `school_affiliations` exists, and is retired in [§ 7](#7-migrating-existing-chapters).
- **One council of a type per school**, enforced in the API at creation: a second IFC at the same school is refused. Two student groups fighting over which is "the" IFC is a support case, decided by the school or the council's national umbrella. Verification is open question [Q4](#8-open-questions-for-paul).

### 2.4 Affiliations

```sql
create table school_affiliations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  chapter_id  uuid not null references chapters(id) on delete cascade,  -- any kind
  is_primary  boolean not null default true,
  status      text not null default 'active' check (status in ('active', 'ended')),
  linked_by   uuid references users(id) on delete set null,
  linked_at   timestamptz not null default now(),
  ended_at    timestamptz
);
create unique index school_affiliations_one_primary
  on school_affiliations (chapter_id) where is_primary and status = 'active';
create unique index school_affiliations_pair
  on school_affiliations (school_id, chapter_id) where status = 'active';

create table council_chapters (
  id            uuid primary key default gen_random_uuid(),
  council_id    uuid not null references chapters(id) on delete cascade,
  chapter_id    uuid not null references chapters(id) on delete cascade,
  status        text not null default 'requested'
                check (status in ('requested', 'invited', 'active', 'suspended', 'ended')),
  requested_by  uuid references users(id) on delete set null,
  approved_by   uuid references users(id) on delete set null,
  approved_at   timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);
create unique index council_chapters_live_pair
  on council_chapters (council_id, chapter_id) where status <> 'ended';
```

- **Why the school link is an affiliation and not `chapters.school_id`.** There are two reasons. Decision 11 says a chapter links up "through an affiliation, never a parent column". And city-wide chapters exist, so a chapter can draw members from two campuses. Such a chapter has one primary school, which is where its `/s/` link and its council live, and can hold a second active affiliation.
- **A council has exactly one school.** That's its primary affiliation, written when the council is created and never ended while the council exists. A trigger refuses a council row with no active primary affiliation after creation, and refuses a second one.
- **`council_chapters` needs both sides to agree.**
  - A chapter requests (`requested`) and the council approves, or the council invites (`invited`) and the chapter accepts.
  - The chapter's side needs `chapter-config:manage`. The council's side needs `council:chapters_manage`.
  - A trigger checks three things: `council_id` is a `kind = 'council'` row, `chapter_id` is a `kind = 'chapter'` row, and both share an active school affiliation.
  - Either side can end the affiliation (`ended`). Only the council can suspend it, for example over standing.
- **A chapter may sit in more than one council.** A Panhellenic chapter at a campus that also has a multicultural council is one example. There's nothing to forbid, and no unique index on `chapter_id` alone.
- **No school is required to start a chapter.** Winston set aside making a school mandatory. A chapter with no affiliation works exactly as today. Adding one later changes no chapter data and no chapter URL, provided the framework worker keeps chapter URLs flat (`/c/<slug>`), as the concept recommends.

### 2.5 PNMs and interest

The recruitment worker owns the pipeline's stages, fields and screens. This section fixes only the identity, the links and who owns which field.

```sql
create table pnms (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references schools(id) on delete cascade,
  user_id           uuid references users(id) on delete set null,   -- linked once they have an account
  school_email      text not null,         -- lower-case
  email_verified_at timestamptz,           -- the one-time code on the form
  first_name        text not null,
  last_name         text not null,
  preferred_name    text,
  class_year        smallint,
  phone             text,                  -- shared with chapters only where phone_shared
  phone_shared      boolean not null default false,
  merged_into_id    uuid references pnms(id),   -- a merged duplicate points at the survivor
  created_via       text not null check (created_via in ('interest_form', 'council_registration', 'council_import', 'chapter_added')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint pnms_school_email_lower check (school_email = lower(school_email))
);
create unique index pnms_school_email_key on pnms (school_id, school_email) where merged_into_id is null;

create table pnm_council_registrations (
  id          uuid primary key default gen_random_uuid(),
  pnm_id      uuid not null references pnms(id) on delete cascade,
  council_id  uuid not null references chapters(id) on delete cascade,
  term        text not null,             -- "Spring 2027"; the council's recruitment term
  status      text not null default 'registered' check (status in ('registered', 'withdrawn', 'released')),
  created_at  timestamptz not null default now(),
  unique (pnm_id, council_id, term)
);

create table pnm_interests (
  id          uuid primary key default gen_random_uuid(),
  pnm_id      uuid not null references pnms(id) on delete cascade,
  chapter_id  uuid not null references chapters(id) on delete cascade,
  source      text not null check (source in ('interest_form', 'council_registration', 'council_import', 'chapter_added')),
  created_at  timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique (pnm_id, chapter_id)
);

alter table rush_candidates
  add column pnm_id uuid references pnms(id) on delete set null;
create unique index rush_candidates_chapter_pnm_key
  on rush_candidates (chapter_id, pnm_id) where pnm_id is not null;
```

**Identity.**
- **One PNM per school,** keyed on a verified school email, as both the concept and the recruitment worker have it.
- **Student ID is not on this table.** It sits with the academic record ([§ 3.2](#32-storage)), because it's the key a grade sheet arrives on and is itself sensitive.
- **Duplicates.** A council officer merges them by hand. `merged_into_id` points the loser at the survivor, and its interests and registrations move over.

**What a PNM row holds.** Only what every party may see: the PNM's own contact details, given on the form for exactly this purpose. Anything else stays off it:
- each chapter's notes, tags, ratings, stage and votes;
- the council's own notes;
- GPA.

**A council's master list** is that council's registrations for the term, plus PNMs who've shown interest in one of its active chapters. The second part is a join, not a copy.

**Interest flows down, never up.** A PNM's own action writes a `pnm_interests` row: filling in a chapter's form, or naming chapters at council registration. In the same transaction, the API then creates that chapter's `rush_candidates` row with `pnm_id` set, or links an existing one. After that, everything in the chapter's pipeline belongs to the chapter and has no path up. That's decision 11: "prospect notes and votes have no path up at all".

**`rush_candidates` changes.**
- **Duplicate names.** Its `(chapter_id, name_key)` unique index (`20260910020000_rush_candidates.sql`) refuses a second "John Smith". With real PNMs that's wrong, so the index becomes partial, `where pnm_id is null`. Hand-added candidates keep today's rule, and linked ones are told apart by `pnm_id`.
- **Pipeline fields.** The stage set, `bid_status` gaining accepted and declined, notes, tags, the fit rating and follow-ups are the recruitment worker's, all on the chapter side.
- **A chapter can still add someone by hand** (`chapter_added`). It gets a `pnms` row only if the chapter supplies a school email and the chapter's school has a council running recruitment. Otherwise it stays a chapter-only candidate, as today.

**Bids going up** are not in this model. A council that needs to know bids, for bid matching or for reporting, gets them as a deliberate push, never as a read of `rush_candidates`. That would be a `pnm_bid_reports` row the chapter's bid action writes when the council's rules ask for it. It's open question [Q7](#8-open-questions-for-paul).

## 3. Eligibility and GPA

### 3.1 The call for Paul

Holding raw GPA is a security and legal decision, so it's Paul's (AGENTS.md § ADR discipline). The design is laid out so that the decision is one row of this table, and the rest of the design doesn't move.

| Option | What Frapp stores | What it costs | What it buys |
|---|---|---|---|
| **A. Verdict only** | `pnm_eligibility` (eligible, pending, not eligible). The import computes the verdict and discards the GPA | Officers can't see why someone failed or fix an import mistake without re-importing, and there's no standing or grade report later | Frapp never holds an education record's value. The FERPA notice needs a smaller change ([§ 6](#6-risks)) |
| **B. GPA, encrypted, purged when recruitment closes** (recommended; Winston's "store it, with extra care") | A, plus `pnm_academic_records` (encrypted), purged at term close + 30 days or on revocation | The full storage design below, a FERPA-notice rewrite, and a release naming Frapp | Officers can review and correct records, and the store is short-lived |
| **C. GPA kept across terms** | B with no term purge, kept while the person is a member | Everything in B, plus long-lived records and a larger breach surface | Chapter standing and grade reporting, the concept's later phase |

Every option keeps the same `pnm_eligibility` table and the same chapter view, so moving from A to B later is additive.

### 3.2 Storage

```sql
create schema restricted;            -- not in the API's exposed schemas (supabase/config.toml [api] schemas)
revoke all on schema restricted from public, anon, authenticated;

create table restricted.pnm_academic_records (
  id               uuid primary key default gen_random_uuid(),
  pnm_id           uuid not null references public.pnms(id) on delete cascade,
  council_id       uuid not null references public.chapters(id) on delete cascade,
  term             text not null,
  student_id_hash  text,             -- HMAC of the student ID, for matching an import; never reversible
  ciphertext       bytea not null,   -- AES-256-GCM of {student_id, gpa_cumulative, gpa_term, credits, enrolled}
  key_id           text not null,    -- which key encrypted it, for rotation
  source           text not null check (source in ('office_import', 'council_import', 'self_report')),
  release_id       uuid not null references restricted.ferpa_releases(id),
  imported_by      uuid references public.users(id) on delete set null,
  imported_at      timestamptz not null default now(),
  purge_after      timestamptz not null,
  unique (pnm_id, council_id, term)
);
alter table restricted.pnm_academic_records enable row level security;  -- and no policies

create table public.pnm_eligibility (
  pnm_id       uuid not null references pnms(id) on delete cascade,
  council_id   uuid not null references chapters(id) on delete cascade,
  term         text not null,
  status       text not null default 'pending' check (status in ('pending', 'eligible', 'not_eligible')),
  rule_version integer not null,     -- which of the council's rules decided it
  decided_at   timestamptz,
  overridden_by uuid references users(id) on delete set null,   -- a council override, logged
  primary key (pnm_id, council_id, term)
);
```

**Layers, from the outside in:**

1. **Not reachable by any client.** The `restricted` schema isn't exposed through PostgREST, and `anon` and `authenticated` have no grant on it. RLS is on with no policies as well, so a future grant can't open it by accident. Realtime never publishes it.
2. **Encrypted in the application, not just on disk.** Supabase already encrypts the disk. That protects against a stolen drive, not against a leaked service-role key, a database dump, a backup restored somewhere else, or a support login.
   - The API encrypts the whole record with AES-256-GCM before the write, so the database never holds plaintext.
   - The key lives in Infisical as `ACADEMIC_RECORDS_KEY` (a new name, `dev` and per-environment values like every app secret), and `key_id` allows rotation.
   - A GPA isn't filtered or sorted in SQL, so nothing is lost by encrypting it. A rule like "GPA ≥ 2.5" is evaluated in the API at import time, and the verdict is written to `pnm_eligibility` in plaintext.
   - `pgsodium`'s transparent column encryption was the other option. It's not recommended: Supabase has said it is winding pgsodium down. That's derived, not checked against Supabase's current docs.
3. **One code path reads it.** An `AcademicRecordsService` with its own repository is the only importer of the table. A dependency-cruiser rule forbids any other module from importing that repository, which `check:dep-cruiser` enforces as a required gate.
4. **Every read and write is logged** ([§ 3.4](#34-access-log)), in the same transaction as the read. If the log write fails, the read fails.

**The student ID** is the key a school's sheet arrives on (Student ID, HS GPA, College GPA, per the ICS research in #4192).
- **Stored twice:** as an HMAC (`student_id_hash`, with its own key), so an import can match without decrypting every row, and inside the ciphertext, so an officer can see it.
- **Never on `pnms`.** A PNM row reaches chapters, so the student ID can't sit there.

**Who supplies GPA.** It should be the school office, or the council under the school's arrangement (`office_import`, `council_import`). `self_report` is in the check so the decision is recorded rather than implied. Whether to allow it at all is open question [Q6](#8-open-questions-for-paul). Self-reported GPA isn't FERPA data, but consumer privacy law still applies.

### 3.3 Who sees what

| Data | Chapter recruiter | Other chapters | Council officer | Council eligibility role | School office |
|---|---|---|---|---|---|
| `pnms` shared fields (name, school email, class year) | If the PNM is interested in their chapter | No (see [Q5](#8-open-questions-for-paul)) | Yes | Yes | Yes |
| Phone | If `phone_shared` and interested | No | Yes | Yes | No |
| Which chapters a PNM is interested in | Own chapter only | No | Yes | Yes | Yes |
| `pnm_eligibility.status` | Yes, for their PNMs | No | Yes | Yes | Yes |
| Raw GPA, credits, student ID | **Never** | **Never** | No | Yes (`council:eligibility_view`) | Yes (`school:records_view`) |
| Chapter pipeline (stage, notes, tags, rating, votes) | Own chapter | No | **No** | **No** | **No** |

- **Chapters see a verdict only,** computed by the server. That's stricter than the releases the hub found (Boulder, Michigan, MSU and CMU give the chapter the GPA itself). Strict is the right default for a vendor.
- **"Other chapters" is No until [Q5](#8-open-questions-for-paul) is decided.** Winston deferred it. The setting would be a per-council option, and the default is the closed one.

### 3.4 Access log

```sql
create table restricted.academic_record_access_log (
  id          bigint generated always as identity primary key,
  record_id   uuid,                  -- null for an import that matched nothing
  pnm_id      uuid,
  council_id  uuid not null,
  actor_user_id uuid,
  actor_tenant_id uuid not null,     -- the council or office tenant the request ran in
  action      text not null check (action in ('import', 'view', 'override', 'purge', 'revoke_purge', 'export_denied')),
  request_id  text,                  -- ties to Sentry and API logs
  at          timestamptz not null default now()
);
-- append-only: no-update and no-delete policies, as chapter_audit_log has (20260523130000_audit_log.sql)
```

- **This is not `chapter_audit_log`.** That log mirrors member-visible rows into the `#chapter-audit` chat channel (`ChatBridgeWorkerService`). A GPA access must never reach chat, so this log is separate and nothing mirrors it.
- **It is append-only and holds no GPA value.** Its rows outlive the record they describe, so whether a record was seen can still be answered after it's purged.
- **The view.** The council's President role and the school office see the log on a council settings page, and every eligibility officer knows their reads are on it. That's the deterrent.
- **No GPA export.** A council can't export GPA (`export_denied` is logged). Exporting verdicts is fine.

### 3.5 Retention and deletion

| Event | What happens |
|---|---|
| Recruitment term closes | A scheduled sweep deletes `pnm_academic_records` rows past `purge_after` (term close + 30 days by default, a council setting with a ceiling). The verdict stays. A `purge` log row is written. This is the same scheduled-job pattern as `ReportRetentionService` (`apps/api/src/application/services/report-retention.service.ts`) |
| PNM revokes their release | Revocation is immediate and prospective. The record is deleted at once, the verdict resets to `pending`, and a `revoke_purge` log row is written. The council's eligibility officers are notified. Deleting rather than keeping it is the hub's "safest default". Whether the law requires it is a lawyer question ([§ 6](#6-risks)) |
| A Frapp user deletes their account | `anonymize_user` and `AccountDeletionService` (`spec/behavior/data-retention.md`) delete the person's `school_members` row and academic records, and detach `pnms.user_id`. The `pnms` row itself goes when its own deletion is asked for |
| A PNM with no account asks for deletion | Support, or the council's `council:pnm_manage` holder, deletes the `pnms` row. That cascades to registrations, interests, eligibility and the academic record. Each chapter's `rush_candidates.pnm_id` goes null, and the chapter keeps its own candidate row (its own data, decision 11) unless the PNM's request covers it. That last point is a lawyer question |
| A council is deleted | Everything keyed to its `council_id` cascades, academic records included |
| The school ends Frapp's access, under a DPA | All academic records for that school's councils are deleted, and a log row is written per record |

**FERPA release** (34 CFR 99.30: signed and dated, naming the records, the purpose and the recipients; electronic consent is acceptable if it authenticates the signer):

```sql
create table restricted.ferpa_releases (
  id              uuid primary key default gen_random_uuid(),
  pnm_id          uuid not null references public.pnms(id) on delete cascade,
  school_id       uuid not null references public.schools(id),
  council_id      uuid not null references public.chapters(id),
  release_version text not null,     -- which approved text was shown; the text lives in code, versioned like LEGAL_POLICY_VERSION
  records         text[] not null,   -- e.g. {gpa_cumulative, gpa_term, credits, enrollment}
  purpose         text not null,     -- "recruitment and membership eligibility"
  recipients      text[] not null,   -- e.g. {"Example State IFC", "Example State Office of FSL", "Frapp, as the council's service provider", "chapters you register interest with: eligibility status only"}
  signer_name     text not null,     -- typed full name
  authenticated_via text not null,   -- 'school_email_code' (the verified email the form already requires)
  signed_at       timestamptz not null,
  revoked_at      timestamptz,
  revoked_via     text
);
```

- **The release text is Paul's.** It's legal copy, so it's on the raise-first list. It's versioned in code, so a change is reviewed.
- **The release names Frapp as the service provider.** The hub found that none of the real school forms name a software vendor. Naming Frapp is the hub's fix for the redisclosure rule (99.33).
- **Chapters are recipients of the verdict only,** and the release says so.
- **Keeping the release after revocation.** It's kept, with `revoked_at` set, as the record of what was consented to and when. Only the GPA is deleted.

## 4. Isolation

### 4.1 RLS

| Table | RLS | Policies | Realtime |
|---|---|---|---|
| `schools`, `school_email_domains`, `school_members` | On | None (API only) | No |
| `school_affiliations`, `council_chapters` | On | None | No |
| `pnms`, `pnm_council_registrations`, `pnm_interests`, `pnm_eligibility` | On | None | No |
| `rush_candidates` (new column) | On (today) | None (today) | No |
| `restricted.*` | On | None, plus no schema grant; the access log adds no-update and no-delete | Never |

- **The pattern is the house default** (`00000000000000_initial_schema.sql`: "RLS enabled with no permissive policies = default deny"). Nothing in this layer needs a direct client read.
- **Council chat and events need no new RLS.** A council is a `chapters` row, so `realtime_can_read_chapter_scope(council_id)` already checks membership in the council.
- **Campus-wide channels (phase 5) are where RLS work starts.** A channel scoped to a school would need a `realtime_can_read_school_scope` helper over `school_members`. That's out of scope here, and recorded so it isn't assumed.

### 4.2 API guards

The concept's claim holds for every chapter route: `ChapterGuard` resolves the active tenant, and a council officer isn't a member of any chapter. The new routes need three rules on top.

1. **`TenantKindGuard`.** A decorator, `@TenantKind('council')`, `@TenantKind('office')` or `@TenantKind('chapter')`, runs after `ChapterGuard` and refuses a tenant of the wrong kind with `403 tenant.kind.invalid`.
   - **Every route with a `council:*` or `school:*` key carries it.** Without it, a chapter President's `*` satisfies `council:eligibility_view`. A chapter role can also hold any string ([`rbac.md`](../behavior/rbac.md#permission-model)), so a chapter could grant itself `council:pnm_view`.
   - **Chapter-only module routes carry `@TenantKind('chapter')`** wherever the council archetype's module map doesn't already turn them off.
   - **A contract test** fails if a route requires a council-scoped key without the matching kind decorator.
2. **Reserved namespaces.** Role and custom-role create and update refuse a `council:` or `school:` string in a chapter tenant, and a `school:` string in a council tenant (`400 roles.permission.reserved`). This is belt and braces with rule 1. It also stops a chapter's role editor from showing keys that do nothing there.
3. **Cross-tenant reads only through endpoints built for them, each scoped by a join, never by a client-supplied id alone.**
   - **The chapter reading its PNMs' shared fields and verdict.** The route runs in the chapter tenant. It reads `pnms` and `pnm_eligibility` only through a `pnm_interests` row for the active chapter, or through `rush_candidates.pnm_id` in the active chapter. A PNM id with no such row returns **404**, not 403, because PNM ids are guessable from a shared list and a 403 would confirm the id exists ([`multi-tenancy.md`](../behavior/multi-tenancy.md) § 403 vs 404).
   - **The council reading its master list.** The route runs in the council tenant with `council:pnm_view`. It reads registrations for its own `council_id` and interests for chapters with an active `council_chapters` row. It never reads `rush_candidates`.
   - **The council reaching a chapter's officers,** through announcements. This is a council write that delivers into each affiliated chapter's notifications. It isn't a read of the chapter, and the recipient list is resolved server-side from chapter roles the chapter has marked as council contacts. It's phase 2. The UI worker owns how it looks.
   - **School pages** (`/s/<school>/…`) resolve a school, not a tenant. A `SchoolGuard` checks the caller has a live `school_members` row for that school, or is a member of a tenant affiliated with it, for read-only school info. School pages don't use `ChapterGuard`. The framework worker decides how the school segment reaches the API.

### 4.3 Tests that must exist

These extend the two layers [`multi-tenancy.md` § How the invariant is tested](../behavior/multi-tenancy.md) already requires.

**Route level** (`apps/api/test/cross-tenant-isolation.e2e-spec.ts`):
1. A council officer, a member of the council tenant only, is refused every existing chapter route with that council's affiliated chapter as context: `403 chapter.context.invalid`.
2. A chapter President (`*`) is refused every `council:*` route with `403 tenant.kind.invalid`, both in their own chapter and with a council id in the header.
3. A chapter role holding the custom string `council:eligibility_view` is refused the GPA route. That covers the reserved-namespace refusal at write, and the kind guard at read.
4. Chapter A can't read a PNM who's interested only in chapter B: 404. Chapter A can't read chapter B's `rush_candidates` row for a PNM both are interested in: 404.
5. Council X can't read council Y's master list, eligibility or academic records, including at the same school (IFC against Panhellenic).
6. A council can't read `rush_candidates`, its notes or its votes for any chapter, by any route. This is asserted by enumerating the council's routes.
7. A council eligibility officer reads a GPA, and an access-log row exists with their user and tenant. If the log write is made to fail, the read fails.
8. A chapter recruiter's PNM response never contains a GPA, a credit count or a student ID field, even for a PNM with an academic record. This is asserted on the serialized body.
9. A revoked release: the academic record is gone, the verdict is `pending`, and a `revoke_purge` row exists.
10. A `council_chapters` link is refused unless both tenants share an active school affiliation, the council row is `kind = 'council'` and the chapter row is `kind = 'chapter'`.

**Repository level** (`createTenantHarness`, ledgered in `tenant-scope-coverage.spec.ts`):
- Each new repository gets colliding twins:
  - two councils at one school for registrations and eligibility;
  - two schools for `school_members` and `pnms`;
  - two chapters for `pnm_interests`.
- Each spec proves the tenant or school filter is applied.
- The academic-records repository is characterised as reachable only from `AcademicRecordsService`, as the ledger already allows for repositories scoped by their caller.
- Each tenant-paging sweep gains a twin council row and proves it's filtered by kind, or records why not.

**Migration level** (`npm run check:pglite-migrations`): a tier that seeds today's chapters, runs the school migration, and asserts three things:
- no `chapters`, `members` or `roles` row changed;
- every chapter has `kind = 'chapter'`;
- every created affiliation matches the rule in [§ 7](#7-migrating-existing-chapters).

## 5. Permission scopes and council roles

### 5.1 Council scope

`PermissionScope` (`packages/validation/src/permission-registry.ts`) is `"chapter"` today, kept "so a level above the chapter can later add its own keys to this list without a second catalog". It becomes:

```ts
export type PermissionScope = "chapter" | "council" | "school";
```

New registry entries (`councilPermission(...)`, beside `chapterPermission`), mirrored in `SystemPermissions` (`apps/api/src/domain/constants/permissions.ts`), where `permissions.registry.spec.ts` already fails if the two drift:

| Key | Module | Grants |
|---|---|---|
| `council:chapters_manage` | council | Invite, approve, suspend and end member chapters |
| `council:pnm_view` | council-recruitment | See the master list's shared fields, interests and verdicts |
| `council:pnm_manage` | council-recruitment | Import a PNM roster, merge duplicates, delete a PNM on request |
| `council:recruitment_manage` | council-recruitment | Set terms, form settings, the bid rule (block or warn on not-eligible) and what chapters can see |
| `council:eligibility_view` | council-recruitment | See raw GPA, credits and student ID. Every read is logged |
| `council:eligibility_manage` | council-recruitment | Import grades, set the GPA rule, override a verdict (logged) |
| `council:announce` | council | Send announcements to member chapters' council contacts |
| `council:calendar_manage` | council | Manage the council calendar member chapters see |

- **`PERMISSION_MODULES` gains `council` and `council-recruitment`.**
- **The catalog endpoint filters by tenant kind.** `GET /v1/roles/permissions-catalog` returns chapter-scope keys to a chapter and council-scope keys plus the shared chapter keys a council uses (chat, events, documents, roles) to a council. So each role editor shows only what works there.
- **`PermissionsGuard` is unchanged.** It reads `roles.permissions` in the active tenant, as today. The kind check is the separate guard in [§ 4.2](#42-api-guards).

### 5.2 School scope and the office tenant

- **School-level roles are roles in a `kind = 'office'` tenant,** one per school: the Greek life office. Office staff get the same role editor, tiers and audit log. A school-level role isn't a new table.
- **The keys:**
  - `school:manage`: school name, slug and domains;
  - `school:affiliations_manage`: approve or end a tenant's school affiliation and settle duplicate councils;
  - `school:records_view` and `school:records_import`: the office's read and import of academic records, logged like the council's.
- **An office is optional and late.** Until a school's office joins, Frapp support holds the `school:manage` duties, and GPA access is the council eligibility role alone. Nothing in phases 1 to 3 needs an office tenant.
- **Campus moderators are not office staff.** Winston: council officers moderate school-wide spaces. That's a council-scope key (`council:campus_moderate`) added with phase 5, not here.

### 5.3 Creating a council, picking a role, renaming titles

Winston: any IFC member can create the council, the creator picks their own role, and titles are customizable.

1. **Seed data.** Council creation seeds a council role pack:
   - **Starting tiers** (data, as #4071 requires): Executive board, Officers, Chapter delegates.
   - **Roles:**
     - **Council admin**, which carries `system_key = 'PRESIDENT'` and `*`, so presidency transfer, claim and the floor rule work unchanged ([`rbac.md` § Presidency Transfer](../behavior/rbac.md#presidency-transfer));
     - President, VP Recruitment, VP Judicial, Treasurer and Secretary in Executive board;
     - Delegate in Chapter delegates.
   - **Defaults:** VP Recruitment gets `council:eligibility_view`, `council:eligibility_manage`, `council:pnm_manage` and `council:recruitment_manage` as overrides. The Executive board tier gets `council:pnm_view`, `council:announce` and `council:calendar_manage`.
   - **Where the pack lives:** beside `STARTING_ROLE_TIERS` and `DEFAULT_SYSTEM_ROLES` as `COUNCIL_STARTING_ROLE_TIERS` and `COUNCIL_SEEDED_ROLES`, chosen by `kind` in `ChapterService.create`. It's seed data only, and no code branches on a role's name.
2. **Picking a role.** The creation flow shows the seeded titles plus "Something else", which names a new role in the Executive board tier. The creator gets the role they picked and **Council admin**. That splits two things a chapter keeps together: the creator's title (say, VP Recruitment) and who holds the wildcard until the real President takes it. The creator can transfer Council admin through the existing Transfer presidency flow.
3. **Renaming.** Every seeded role and tier is renamed the way a chapter's is (`system_key` makes it a pure relabel). A council can rename Council admin too. Different IFCs' titles fit one structure because only `system_key`, never a name, carries meaning.
4. **Who may create.**
   - Creating a council requires a verified `school_members` row at that school.
   - The school must have no council of that type yet.
   - The council starts **unverified**: it can invite chapters and set itself up, but can't import grades or collect FERPA releases until verified.
   - Who verifies it, and how, is [Q4](#8-open-questions-for-paul).

## 6. Risks

Plainly, for Paul.

**Legal (none of this is verified or legal advice):**
- **Frapp's FERPA notice would become untrue.** [`spec/behavior/legal.md`](../behavior/legal.md) § FERPA Notice says Frapp "does not access student education records", and the published `/ferpa` page says the same. Option B or C breaks that sentence. Option A arguably doesn't, but a verdict is derived from an education record, so A needs counsel too. Changing the notice is legal copy, so it's Paul's.
- **FERPA binds schools, not Frapp directly.** Frapp is reached through the school's contract and the redisclosure rule. A school that finds a redisclosure can bar the recipient for five years (34 CFR 99.67, per the hub). So one bad council export could cost every chapter at that school.
- **The lawful path is unsettled.** One option is the school-official exception: a DPA under which the school controls retention and deletion. The other is written consent under 99.30. This design supports both, but which one a school uses changes who Frapp's customer is for this data. Is the IFC a student organization or a school body? The answer moves this.
- **Chapters seeing a verdict is a disclosure.** "Not eligible" tells a chapter something about a GPA. The release must name chapters as recipients of the verdict ([§ 3.5](#35-retention-and-deletion)), or chapters see nothing at all.
- **State law.** The hub found that CCPA/CPRA lists "education information" with no FERPA exemption, so it may reach a for-profit Frapp. SOPIPA and NY Ed Law 2-d look K-12 only. State breach-notice rules differ, and a GPA alone may not trigger them.
- **Schools will ask for paperwork Frapp doesn't have:** a DPA (purpose limits, no sale, subprocessor approval, deletion on request, audit rights) and a HECVAT security questionnaire. Without them, a school office may refuse to send grades, and the feature falls back to self-report or option A.

**Security:**
- **A key compromise exposes every stored GPA.** Application-layer encryption moves the crown jewel from the database to `ACADEMIC_RECORDS_KEY`. It must be reachable only by the API's runtime, rotated with `key_id`, and never synced to Vercel or to any web or mobile build. Per AGENTS.md it lives in Infisical, and which syncs carry it is a Paul call.
- **An insider with the eligibility role can browse GPAs.** The log is a deterrent, not a wall. Narrowing that needs per-read justification or a view limited to the current import's mismatches, which is a product cost.
- **`*` reaches council keys if a kind check is missed.** One forgotten `@TenantKind` decorator and every chapter President can read GPAs. The contract test in [§ 4.2](#42-api-guards) exists for this. It's the single most important test here.
- **Duplicate-PNM merges can attach one person's record to another.** Merging is a council officer's action and is logged, but a wrong merge shows one student's verdict under another's name. Merges should refuse when both rows carry an academic record.
- **Councils become a new class of tenant that every sweep sees** ([§ 1](#why-a-council-is-a-kind-of-chapter-d1)). A sweep that forgets the kind is a bug of the "harmless until it isn't" kind: dues reminders to a council, or a council counted as a paying chapter.

**Product:**
- **A council officer who is also a chapter member** holds two memberships. Their chapter data and council data stay apart only because the tenant switch drops the client cache ([`multi-tenancy.md`](../behavior/multi-tenancy.md)). The framework worker's URL change must keep that guarantee.
- **The email-domain gate excludes real students.** That covers students on a personal address, transfer students, and schools with several domains. Support verification (`verified_via = 'support'`) is the escape hatch, and it's manual.

## 7. Migrating existing chapters

Nothing a chapter can do changes. Every step is additive, and the migration writes no `chapters`, `members` or `roles` value beyond the new columns' defaults.

1. **Schema.** Add `chapters.kind` (default `'chapter'`, so every existing row is a chapter) and `council_type`, plus the new tables. Nothing is backfilled in this step.
2. **Schools from data we have.**
   - **Today's data.** `chapters.university` is free text and `not null` (`00000000000000_initial_schema.sql`). `chapter_directory` holds 13,327 rows with `university` and `university_short` (`20261107043100_chapter_directory_wikipedia_rows.sql`), and a chapter claimed from the directory has `directory_id`.
   - **A script, not a migration.** A new script (say `scripts/school-backfill.mjs`) makes a proposal. Each chapter whose `directory_id` is set takes its directory row's `university`. Any other chapter's `university` text is matched to a directory university by normalized name and alias (`search_school_names`).
   - **The output** is a review sheet: chapter, its `university` text, the proposed school, and match confidence.
   - **Not run blind.** Free text like "ESU", "Example State" and "Example State University" (an illustration) must land on one school, and only a person can confirm the long tail.
3. **Apply the reviewed sheet** as a data fix (`supabase/data-fixes/`) per environment.
   - It creates one `schools` row per confirmed university (`status = 'unverified'`, `directory_university` set) and one primary `school_affiliations` row per confirmed chapter.
   - Unmatched chapters get no affiliation and work as today.
   - **Phi Gamma Delta** is placed this way, in the same sheet as every other chapter. The production run is Paul's.
4. **Email domains** have no source in our data. Frapp support adds and verifies each school's domains when that school's council or first chapter asks. Until then the school is `unverified` and nobody verifies against it.
5. **Members aren't enrolled automatically.** After their chapter is placed, a member sees an invitation to verify their school email, which is Winston's "existing member whose chapter gets placed in a school" scenario. The UI worker owns the prompt. Until they verify, nothing changes for them.
6. **Later, after every client reads the affiliation:** `chapters.university` becomes derived from the primary affiliation where one exists. It's dropped only once nothing reads it. That's a separate, later migration that names its readers, and it's not part of this plan.

The migration passes `npm run check:migration-safety`: new tables, a nullable column, and a column with a constant default. The pglite tier in [§ 4.3](#43-tests-that-must-exist) proves no existing row changed.

## 8. Open questions for Paul

Raise-first items (AGENTS.md § ADR discipline) are marked ⚑.

1. **Q1 ⚑ Store GPA?** Option A, B (recommended) or C in [§ 3.1](#31-the-call-for-paul). If B or C, also: may `ACADEMIC_RECORDS_KEY` be added to Infisical, synced to the API's Render service only?
2. **Q2 ⚑ The FERPA notice and the release text.** Both are legal copy. Will you have counsel review them, using the lawyer questions below, before any grade is stored?
3. **Q3 ⚑ Council billing.** Winston's answer: someone on the IFC pays. A council row can hold its own Stripe subscription today. What plan is it on, and at what price?
4. **Q4 Who creates a school, and who verifies a council?** Proposed: any verified student creates an unverified council. Frapp support, or later the school office, verifies it before grade import opens. Which proof counts: the school's FSL office confirming, or a national umbrella (NIC for IFC)?
5. **Q5 What do other chapters see on the master list?** Winston deferred it. Proposed: nothing, until a council turns on "all chapters see all registered PNMs' shared fields". That's a per-council setting, off by default.
6. **Q6 Self-reported GPA:** allow it as a fallback where the school won't send grades, or refuse it?
7. **Q7 Bids going up:** does a council get chapters' bids, through an explicit push the chapter's bid writes? Or does that wait for Panhellenic matching? Your decision 11 allows a push, never a read.
8. **Q8 The office tenant:** is a Greek life office as a third tenant kind the right home for school staff, or should school staff wait until a school asks?

**Lawyer questions**, from the hub's FERPA research, for Q2:
1. Under which path is Frapp operating: school official (DPA), the council's agent, or a recipient named in a 99.30 consent?
2. Is an IFC a student organization or a school body, for FERPA purposes?
3. Does CCPA/CPRA apply to Frapp's handling of education information?
4. After revocation, must stored GPAs be deleted, or only not used again?
5. What breach-notice window should a DPA commit to, and which states' laws apply?
6. May Frapp accept self-reported GPA, and under what notice?
7. What retention period is defensible: term close + 30 days, or something else?
