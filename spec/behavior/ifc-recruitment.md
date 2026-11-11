# IFC recruitment: master list, interest forms, chapter pipeline, eligibility

> **Status: Proposed, pending Paul. Nothing here is built.** Part of [#4192](https://github.com/pdcarlson/Frapp/issues/4192). Asked by: Winston (`whewitt-frapp`), 2026-11-11. This file describes intended behavior for a design Paul has not approved yet. Until he does, [`rush.md`](rush.md) and the code own what recruitment does today, and nothing here overrides them. When a piece ships, its rules move into `rush.md` (chapter side) or a council spec, and this file shrinks.

This is the **behavior** part of the #4192 design. Three sibling designs own the rest, and this file only names what it needs from them:

- **URLs and tenant context** (`/c/<slug>/…`, `/s/<school>/…`, the public form URL): the URL/context design. The concept comment proposes `/f/<form>` for public forms, and this file uses that only as a placeholder.
- **Screens and layouts:** the UI design.
- **Tables, columns, RLS and the permission registry's council scope:** the data-model design. Table names below (`pnms`, `pnm_interests`, `pnm_academic_records`, `rush_candidates.pnm_id`) are the ones the [concept comment](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804509311) proposed, used here as placeholders.

Sources this builds on:
- Winston's input on #4192: the master list, per-chapter forms, and [his answers](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804810927).
- The [ChapterBuilder / CampusDirector research](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804236717). **Everything it says about vendors is unverified:** the sandbox could not open their pages.
- `rush.md` and the rush code on `main`:
  - `rush_candidates` and `rush_candidate_votes` (`supabase/migrations/20260910020000_rush_candidates.sql`);
  - `apps/api/src/interface/controllers/rush.controller.ts`;
  - `RushService`.
- Issues #4070, #4084, #3953 and #3926.

## Contents

1. [Words used here](#words-used-here)
2. [Who does what](#who-does-what)
3. [The IFC master list](#the-ifc-master-list)
4. [Chapter interest forms](#chapter-interest-forms)
5. [The chapter Rush module](#the-chapter-rush-module)
6. [Eligibility](#eligibility)
7. [Council rules and bid day](#council-rules-and-bid-day)
8. [The PNM's own view](#the-pnms-own-view)
9. [Retention and deletion](#retention-and-deletion)
10. [Phasing](#phasing)
11. [Decisions for Paul](#decisions-for-paul)

## Words used here

- **PNM** (potential new member): a student being recruited. One PNM is **one person at one school**, however many chapters they talk to.
- **Master list:** the council's list of every PNM at the school.
- **Interest:** a link between a PNM and one chapter. It records how it started: that chapter's form, an event check-in, the IFC registration, or an import.
- **Candidate:** today's `rush_candidates` row, the chapter's own record of a prospect. A candidate may link to a PNM (`pnm_id`) or may not. A prospect a member added by name, who hasn't consented to the campus list, has no link.
- **Season:** one recruitment cycle as the council defines it, such as Fall 2027. Rules, dates, bids and retention all hang off a season.
- **Vocabulary.** Chapter-facing copy still goes through the chapter's vocabulary helper (rush / recruitment / intake), as [`rush.md` § Vocabulary](rush.md#vocabulary) requires. Council-facing and PNM-facing copy says "recruitment". A PNM never sees a chapter's private word for it.

## Who does what

| Actor | Where they act | What they can reach |
| --- | --- | --- |
| PNM | The public form (no app), then their own PNM view once their school email is verified | Their own record, interests, eligibility, bids and releases |
| Chapter member | Their chapter's Rush module, gated by the `rush:*` keys | Their chapter's candidates, plus the master-list fields the council shares |
| Council officer | The council tenant's Recruitment area, gated by the new council keys below | The master list, minus chapter-private data. GPA only with `council:eligibility_manage` |
| School office (Greek life) | A read-and-import role on the council. How it gets access belongs to the URL and data-model designs | Imports grades, reads eligibility and reports |

**Council permission keys (proposed).** These are scope `council` in the permission registry, so they appear only in a council's role editor. The data-model design owns the registry shape; this file owns what each key allows.

| Key | Allows |
| --- | --- |
| `council:recruitment_view` | Read the master list, interests, bid outcomes and season reports. No GPA. |
| `council:recruitment_manage` | IFC registration form, imports from the school roster, merges, season dates and rules, bid-day release |
| `council:eligibility_manage` | Import grades, read GPA and credits, set the eligibility rule, override a verdict |
| `council:recruitment_reports` | Export reports for the Greek life office |

## The IFC master list

### How a PNM gets onto it

Every route leads to the same record. A PNM is never created twice.

1. **A chapter's interest form** ([below](#chapter-interest-forms)). This creates or finds the PNM, adds an interest for that chapter, and creates the chapter's candidate.
2. **IFC registration.** The council has a form of its own, the same shape as a chapter form but with no chapter. Schools that run formal IFC registration point students here. It creates or finds the PNM and adds no chapter interest. The council can add questions: "Which chapters are you interested in?" lists the council's chapters and adds an interest for each one ticked, sourced `ifc_registration`.
3. **An import from the school.** A CSV the school or council uploads, such as an incoming-class list or the school's own registration export. Each row is created or matched as a PNM in an **imported, unverified** state. **An imported PNM appears on the master list but never on a chapter's list** until they verify their email and either show interest or opt in to being shared ([§ What chapters see](#what-chapters-see-on-the-master-list-options)). The school's list isn't the student's consent to be recruited.
4. **QR codes** are just links to a form (a chapter's or the IFC's), carrying a source label such as `tabling-quad` or `dorm-flyer`. The label is recorded on the interest. There is no separate QR intake path.
5. **A chapter member adding someone by name** (`/rush add`, or Add in the pipeline) creates a **chapter-only candidate with no PNM link.** A chapter can't put a person on a campus-wide list. The candidate links to the PNM later, the moment that person submits any form or registers. On that submission, the chapter is offered to link the existing candidate by name match; a member confirms it, and it never links on its own. See [§ Duplicates](#identity-and-duplicates).

### Identity and duplicates

- **The key is a verified school email.** A form asks for an email on one of the school's domains and sends a one-time code. The submission is held as pending until the code is entered, and expires after 24 hours. Matching lowercases the address and folds the school's alias domains together (for example `@school.edu` and `@mail.school.edu`, from the school record). It does not strip `+tags` or dots, since not every school's mail system ignores them.
- **The second key is the student ID,** from an import or from the PNM if the council asks for it. An imported row with a student ID matches a PNM who already has that ID. Two different verified emails with one student ID go to the merge queue.
- **Fuzzy matches are never merged automatically.** The same name plus the same phone, or the same name plus class year, raises a suggestion in the council's merge queue (`council:recruitment_manage`), shown side by side.
- **A merge**:
  - keeps one PNM;
  - unions the interests;
  - keeps each chapter's candidate pointing at the survivor;
  - keeps the earlier `created_at`.
  - It's logged with who merged and what each side held. MVP has no unmerge, so the preview has to be clear.
- **Inside one chapter,** a second form submission from the same PNM updates their answers and doesn't add a candidate. If a chapter has two candidates that turn out to be one person (one added by name, one from a form), its own merge needs `rush:manage`.

### Fields

**Owned by the council, the same for every chapter:**
- legal first and last name;
- preferred name;
- verified school email;
- student ID (optional; from an import or asked by the council);
- class year or entry term;
- phone (optional);
- pronouns (optional);
- major (optional);
- how they heard about recruitment;
- registration source and date.

**Up to 10 of the council's own questions,** with the same question types as a chapter form.

**Derived:**
- each interest (the chapter, its source and date);
- the eligibility verdict;
- the FERPA release status;
- the recruitment outcome (none, bid outstanding, accepted at a chapter, or withdrawn).

**Never on the master list:** race, religion, health, sexual orientation, immigration status, or a photo the PNM didn't upload. The form builder refuses a question whose label matches a short list of those topics and explains why. That is a guard against mistakes, not a classifier.

### What the IFC sees

A holder of `council:recruitment_view` sees:
- every PNM;
- every core and council field;
- every interest;
- the eligibility verdict;
- **bid events:** extended (by which chapter, when), accepted, declined, expired, rescinded.

The council needs bids for bid-day rules and for the school's reports.

The council **never** sees:
- a chapter's notes, tags, ratings, votes or stage;
- a chapter form's custom answers;
- who in the chapter owns or contacted the PNM.

GPA and credits are visible only with `council:eligibility_manage` ([§ Eligibility](#eligibility)).

### What chapters see on the master list (options)

Winston deferred this ([answer 5](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804810927)). Three options follow, each one a council setting, so the rule can differ by school.

| | A. Interested only | B. Opt-in directory | C. Shared list |
| --- | --- | --- | --- |
| A chapter sees | Only PNMs with an interest in **that** chapter | A: PNMs interested in this chapter, plus a directory of every registered PNM who ticked "Let every IFC chapter see that I'm interested in recruitment" | Every verified PNM |
| Fields shown for other PNMs | n/a | Preferred name, class year, eligibility verdict. Contact details only after the PNM accepts the chapter's invitation to connect | The fields the council picks |
| Matches | CampusDirector's one-way push of the fields the council enables (unverified research) | Discord Student Hubs, the opt-in directory in the concept's privacy table | A plain shared spreadsheet, which is what many IFCs pass around today |
| Risk | Chapters can't find PNMs who registered but never named them | More moving parts: an invitation to connect is a new flow | PNM data spreads to every chapter without the PNM choosing it |

**Recommendation: A for MVP, B as the next step, never C as the default.**
- A needs no new flow.
- A keeps "interest" as the PNM's own act.
- A matches how the research says CampusDirector shares.

**Whichever option is chosen,** a chapter never sees:
- which other chapters a PNM is interested in;
- another chapter's private data;
- another chapter's bids.

There is one exception. Once a PNM accepts a bid, other chapters with an interest see **"Accepted elsewhere"**, with no chapter name, so they stop recruiting that person. Their open bids close as described in [§ Bids](#bids).

## Chapter interest forms

### Every chapter has one

- **Created automatically.** A chapter's form exists as soon as the Rush module is on. It's **closed** until a holder of `rush:manage` opens it.
- **Chapters without a school.** They get a form too. It feeds only their own pipeline, and the PNM it creates belongs to no school's master list.
- **Linking to a council later.** When the chapter later joins a council, PNMs who come in through the form after that also land on the master list. Earlier submissions don't move: their consent text didn't name the council.
- **One live form per chapter.** A chapter can't run several forms. It runs several QR source labels instead (below).

### The public landing page

- **Open to anyone.** No account and no app. The URL belongs to the URL design; the concept uses `/f/<form>`. A QR code points there.
- **What it shows:**
  - the chapter's name and crest, in its accent color (Signet);
  - a short blurb the chapter writes (up to 500 characters);
  - the chapter's upcoming **public** recruitment events ([§ Events](#events-and-attendance));
  - the form;
  - the consent text;
  - links to the Privacy Policy and Terms.
  - It never shows members, chat or any other internal data.
- **When the form is closed,** the page says recruitment isn't open and links to the council's registration, if there is one.
- **Abuse controls:**
  - a rate limit on submissions and code sends, per IP and per email;
  - a bot challenge before the code is sent.
  - A submission is invisible to the chapter until its code is verified, so a flood of fakes never reaches the pipeline.
- **After submitting,** the PNM sees a confirmation with:
  - the chapter's events;
  - a "Manage my recruitment info" link to [their own view](#the-pnms-own-view);
  - an optional "Get the app".
- **A confirmation email** carries the same management link.

### Fields

- **Fixed, owned by the council, always first:**
  - name;
  - preferred name;
  - school email (verified);
  - class year;
  - phone (optional).

  They're the master-list fields. If the PNM already exists, they're filled in, and an edit updates the PNM.
- **The chapter's own questions:** up to 10. They're private to the chapter: the council and other chapters never see the answers.
  - **Types:** short text, long text, single choice, multiple choice, yes/no.
  - **Each is optional or required.**
  - The same sensitive-topic guard as the master list applies.
- **"Who referred you?"** An optional built-in question. The PNM picks a member of this chapter from a search, or types a name. It feeds the candidate's owner suggestion and, later, the recruitment bounty (#3953).
- **Built later from the chat form cards (#3926):** the question builder should share that card's question types, so one builder serves both.

### What a submission does

All of it happens in one transaction after the code is verified:

1. **Finds or creates the PNM** by the [identity rules](#identity-and-duplicates).
2. **Adds an interest** for this chapter, with the source (`chapter_form`) and the QR label. A repeat submission updates the existing one.
3. **Creates the chapter's candidate** in the first stage with `pnm_id` set, or updates the one already linked.
   - If an unlinked candidate in this chapter has the same name, the chapter is asked to link them. Nothing is linked automatically.
   - The unique name rule (`rush_candidates_chapter_name_key`) can't block a form submission. Two different PNMs called "Jake Smith" are two candidates, so the data-model design has to relax that index for linked candidates.
4. **Tells the chapter.**
   - **Push and inbox:** to the members with `rush:manage`, and to the chapter's "recruitment contacts" (a setting, default the President).
   - **Optional card:** the chapter can name a channel. If it does, the existing rush candidate card is posted there, marked "from interest form". The card follows the card rules in [`rush.md`](rush.md), and shows only fields a `rush:view` holder may see.
5. **The master list** shows the new interest straight away, when the chapter belongs to a council.

### Consent and privacy text

The text sits directly above the submit button, never behind a link. **This is draft copy. Legal and privacy copy is Paul's** (AGENTS.md § ADR discipline), so it needs his approval before shipping.

> By submitting, you share this information with **{Chapter}** at {School} so they can contact you about joining. {If linked to a council:} Your name, school email, class year and phone also go to **{Council}**, which keeps one recruitment list for {School}, and the council can see which chapters you've signed up with. Other chapters don't see that you signed up here. {If option B or C is on, say exactly what other chapters see.} Frapp stores this for them. You can withdraw from this chapter, or delete your recruitment information entirely, at any time from the link we email you. We don't ask for your grades here. If the council checks eligibility, it will ask your permission separately.

- **Required box:** "I agree, and I'm 18 or older." The Terms require users to be 18 or older ([`legal.md`](legal.md)). Some first-year PNMs are 17, which is [decision 4 for Paul](#decisions-for-paul).
- **Separate, optional box, only under option B:** "Let every IFC chapter at {School} see that I'm interested in recruitment."
- **The submission stores:**
  - the consent text version;
  - the boxes ticked;
  - the time;
  - the source label.

## The chapter Rush module

Today recruitment is chat only: the slash commands and the candidate card ([`rush.md`](rush.md)). This adds a **pipeline** of candidates (a board and a list), a candidate detail page and a dashboard. Chat keeps working, and the card links to the candidate's page. How it looks is the UI design's job.

### Stages

**ChapterBuilder's scale.** The research says it uses one letter scale, D to A+, that mixes how interested a PNM is with how far along they are; A+ means a signed bid. Frapp keeps three things apart, because a chapter acts on each one differently:

- **Stage:** where the relationship is. The chapter moves it.
- **Fit rating:** what members think. Each member rates, and the result is an average ([§ Ratings](#notes-tags-ratings)).
- **Bid status:** the formal offer. Bid actions move it, and nothing else does.

**Default stages.** A chapter can rename, add, reorder or hide them, as `rush.md` § Funnel already requires (stage keys come from chapter config):

| Stage | Means | Moves here |
| --- | --- | --- |
| **New** | Just came in from a form, an import or an add | Automatically, on creation |
| **Contacted** | Someone in the chapter has reached out | Automatically, the first time a contact is logged; or by hand |
| **Met** | Has met members in person | Automatically, when the PNM is marked at a chapter event; or by hand |
| **Engaged** | Keeps showing up; the chapter is seriously considering them | By hand |
| **Bid ready** | The chapter wants to extend a bid | By hand |
| **Closed** | Out of the pipeline. Needs a reason: not interested, not eligible, accepted elsewhere, chapter passed, or no response | By hand. Also automatically on "Accepted elsewhere" and on withdrawal |

**Bid status** runs separately: `none` → `extended` → `accepted`, `declined`, `expired` or `rescinded`. A candidate in any stage except Closed can be given a bid. Extending one doesn't move the stage. The board shows the bid status as a badge, and the dashboard counts it separately.

**What changes in the code.** Today `stage` is free text, defaulting to `'new'`, and `bid_status` allows only `none` and `extended`. Both get widened.

### Notes, tags, ratings

- **Notes.**
  - Free text, private to the chapter, with the author and time shown.
  - Holders of `rush:notes` can write them, and only they can read them. Today the key is described as "write notes". This makes it "read and write notes", so a chapter can keep notes to its recruitment committee by giving the key only to that committee.
  - An author can edit or delete their own note. `rush:manage` can delete anyone's.
  - Notes never go on the chat card or in a push.
- **Tags.**
  - The chapter defines its own, such as "legacy", "athlete" or "met at tabling".
  - Tagging a candidate needs `rush:notes`. Managing the list of tags needs `rush:manage`.
  - Tags are private to the chapter.
- **Ratings.**
  - A member with `rush:vote` gives a candidate 1 to 5 and can change it.
  - Like votes, individual ratings are never shown with a name, only the average and the number of raters.
  - Seeing the average needs `rush:view_results`, the same gate #4084 adds for vote counts.

### Contact tracking and follow-ups

- **Log a contact.** Pick the kind (text, call, in person, social DM, email, event) and the date. A note is optional. The member logging it is recorded.
  - Needs `rush:add`. This widens that key from "add a prospect" to "add and work prospects", which also covers moving stages. The label in the role editor changes to match.
- **Owner.** Each candidate can have one member as the main point of contact.
  - Assigning someone else needs `rush:manage`. Any `rush:add` holder can claim an unowned candidate.
  - A form's "Who referred you?" answer pre-fills the owner suggestion.
- **Follow-ups.** A follow-up has a due date and a member it's for (the owner by default).
  - That member gets a push and an inbox item on the morning it's due, in their time zone.
  - Logging any contact clears it.
- **Stale alert.** A candidate in New, Contacted, Met or Engaged with no logged contact for N days (a chapter setting, default 7) shows on the dashboard as "Needs follow-up", and its owner is told once.
- **Phone and email.** Holders of `rush:view` see them, but only when they came from the PNM: from this chapter's form, or under option B after the PNM accepted the connection. A candidate the chapter added by name has only what the member typed in.

### Events and attendance

- **A recruitment event is an ordinary chapter event** ([`events.md`](events.md)) with an "Open to PNMs" switch. Only an officer with `events:update` can turn it on.
- **When it's on:**
  - The event appears on the chapter's public form page. The page shows the name, time and location only. Its attendance-by-role rules don't apply to PNMs, since a PNM isn't a member.
  - **PNM attendance is its own record, not a row in `event_attendance`.** Check-in there awards points through the `check_in_event` RPC, and a PNM isn't a member and earns no points.
- **MVP: marking from the roster.** A member with `rush:add` marks a candidate present from the event's PNM roster. That also:
  - logs a contact of kind "event";
  - moves a New or Contacted candidate to Met.
- **Later: a guest QR at the door.** The PNM scans a QR shown at the event. It's the same rotating code as [member check-in](events.md#check-in), in a guest mode. The PNM enters their school email and verifies it.
  - If they're already a PNM, they're marked present. That adds an interest for this chapter, sourced `event`; the check-in page tells them so before they submit.
  - If they aren't, it runs the chapter form's fixed fields.
- **Council events.** These are the council's own events, such as an IFC kickoff, and the council gets them as a tenant. Their PNM attendance shows on the master list. It never creates an interest in any chapter.

### Voting

- **The existing vote stays as it is.** It's anonymous, one per member, and one click: a show of support. `rush:vote` casts it and `rush:view_results` sees the count (once #4084 wires that).
- **Later: a formal bid vote.** A holder of `rush:manage` opens a timed ballot on one or more candidates in Bid ready.
  - **Choices:** Yes, No or Abstain.
  - **Who:** members with `rush:vote`.
  - **Passing** follows a threshold the chapter sets: a simple majority, two-thirds, or "no more than N No votes". Nationals' rules differ, so Frapp sets no default beyond a simple majority, and the chapter owns its threshold.
  - **Anonymity:** individual ballots are never shown, whatever any setting says. That is today's rule in `rush.md`.
  - **Results:** only to `rush:view_results`.
  - **A passing vote doesn't extend a bid by itself.** A `rush:bid` holder still extends it.
  - It should reuse the polls engine (`polls.md`), not build a second one. The UI and data-model designs decide how.

### Bids

| Action | Who | Rules |
| --- | --- | --- |
| **Extend** | `rush:bid` | Blocked while the council's bid window is closed. If the verdict is Not eligible, it's blocked or warned, as the council chooses. If it's Pending, it's warned. The verdict at the time of the bid is stored with it. It gets an expiry (the council default, which the chapter can shorten). Under bid-day release it's held until release ([§ Bid day](#bid-day)) |
| **PNM accepts or declines** | The PNM, in [their own view](#the-pnms-own-view) | Only while the bid is open. A PNM can accept one bid per season |
| **Record an acceptance or decline** | `rush:bid` | For a paper bid card or a verbal answer. Shown as "Recorded by {member}" and reported to the council the same way |
| **Rescind** | `rush:manage` | Needs a reason. Reported to the council |
| **Expire** | The system | When the expiry passes with no answer |

- **When a PNM accepts:**
  - Their other open bids close as `declined`, reason "accepted elsewhere". (A council setting can turn that off where the rules allow holding several.)
  - Other chapters with an interest see "Accepted elsewhere".
  - The master list shows "Accepted at {Chapter}".
  - The PNM gets this chapter's **invite to join as a New Member** through today's invite flow. The legal acceptance rules there still hold.
- **PNM data never becomes member data.** Joining creates the membership the normal way. The candidate stays as the chapter's recruitment history, with its pipeline fields subject to [retention](#retention-and-deletion).
- **What exists today.** `bid_status` today has only `none` and `extended`, and `POST /v1/rush/candidates/:id/bid` only extends. The new actions are new routes, and the existing card's Extend bid keeps working.

### Dashboard

The chapter's recruitment home, the funnel `rush.md` § Funnel describes but was never built:
- **Funnel:** counts by stage, in the chapter's stage order.
- **Bids:** extended, outstanding, accepted, declined, expired.
- **Eligibility:** counts of candidates that are eligible, pending or not eligible.
- **Needs follow-up:** stale candidates, and follow-ups due.
- **Mine:** the candidates I own.
- **Sources:** which form, QR label, event or referrer brought candidates in.
- **The season calendar:** the next council date ([§ Calendar](#recruitment-calendar)).

Anyone with `rush:view` sees all of it. Vote counts and rating averages appear only for `rush:view_results`.

### Permission map

What each `rush:*` key from [#4070](https://github.com/pdcarlson/Frapp/issues/4070) gates in this design. Every route keeps today's class-level gates: the `rush` module on, and `members:view`.

| Key | Today ([`rush.md`](rush.md#permissions)) | In this design |
| --- | --- | --- |
| `rush:view` | Look up a prospect, see bid status | The pipeline, candidate pages, the dashboard, PNM-supplied contact details, the eligibility verdict, the event PNM roster, form answers |
| `rush:add` | Add a prospect | Add; move stages; log contacts; claim an unowned candidate; mark PNM attendance; set follow-ups. **Label changes to "Add and work prospects".** |
| `rush:notes` | Nothing yet | Read and write notes; tag candidates. **Label changes to "Read and write notes".** |
| `rush:vote` | Vote | Vote; rate 1–5; cast a formal bid-vote ballot |
| `rush:view_results` | Nothing yet (#4084) | Vote counts, rating averages, bid-vote results |
| `rush:bid` | Extend a bid | Extend; record an acceptance or decline |
| `rush:manage` | Nothing yet | Open and close and edit the interest form and its QR labels; stages, tags and the stale-days setting; assign owners; rescind; merge candidates; delete; export the pipeline to CSV; open a formal bid vote |

**Notes on the map:**
- **Default grant.** The seeded Member role holds every key but `rush:manage` ([`rush.md` § Permissions](rush.md#permissions)). So by default every member could read notes once `rush:notes` means read too.
  - A chapter that wants notes kept to a committee takes the key off Member.
  - Paul's open "Recruitment defaults" decision (#4068) is the place to change that default. [Decision 6](#decisions-for-paul).
- **Clients read the keys too.** Web and mobile hide what a role can't do, using `can` from `@repo/validation`. That closes #4084's client half for every action here.

## Eligibility

Whether a PNM may receive a bid under the school's and council's rules. **This depends on Paul's GPA-storage decision** ([decision 1](#decisions-for-paul)). Winston's answer is to store GPAs and take extra care. The verdict-only fallback is at the end of this section.

### The rule

A holder of `council:eligibility_manage` sets it once per season. Any part can be left out:
- minimum cumulative college GPA;
- minimum high-school GPA, for students with no college GPA yet;
- minimum credits completed;
- enrollment status (for example, full-time);
- conduct standing ("in good standing"). This comes from the school as a yes or no, never as case details.

### The FERPA release

- **Who signs, and how.** The PNM signs it in their own view, once their school email is verified.
- **The text names:**
  - the school, as the source;
  - the council and Frapp, as recipients;
  - exactly what is released: cumulative GPA, high-school GPA, credits, enrollment, conduct standing;
  - the purpose: recruitment eligibility for this season;
  - who sees what: GPA by council eligibility officers and the school office; only the verdict by chapters;
  - how long it lasts (through the season) and how to revoke it.
- **The research's precedent (unverified):** Michigan and Colorado use a signed, revocable release.
- **What is stored:**
  - the text version and a hash of it;
  - signed at;
  - the season;
  - revoked at.
- **Releases signed at the school.** Some schools collect the release on their own system. The council can then mark the import as "the school attests that a release is on file" (a column in the CSV). That records where consent lives instead of asking the PNM to sign twice. Whether Frapp may rely on that attestation is part of [decision 1](#decisions-for-paul).
- **Revoking** is one action in the PNM's own view, and it takes effect at once:
  - Their grade data is **deleted**, not hidden.
  - The verdict returns to Pending.
  - Chapters see Pending.
  - The council is told.
  - Outstanding bids stay. Whether a council rule voids them is the council's choice.
- **The release is not on the interest form.** It's asked only when the council runs eligibility, and only of verified PNMs.

### Getting the data in

1. **The upload.** A holder of `council:eligibility_manage` (the council's eligibility officer, or the school office's role) uploads a CSV. It is shaped like ICS's grade import, as the research describes it: `student_id`, optionally `email`, `college_gpa`, `hs_gpa`, `credits`, `enrollment`, `conduct_ok`, `as_of`.
2. **Matching:** by student ID, then by verified school email.
3. **Data minimization:**
   - **A row matching no PNM is not stored.**
   - **A row for a PNM with no current release is not stored** (unless the school attests a release).
   - The upload reports both as counts, with no names, so the school can see they were dropped.
   - Frapp never holds grades for students who aren't recruiting or haven't consented.
4. **Before anything is written,** the officer sees a summary: matched, created verdicts, changed verdicts, dropped. Then they confirm.
5. **Re-imports.** Each import replaces the last values for the PNMs it covers.

### The verdict

- **Computed by the API** from the rule and the latest data. Three values:
  - **Eligible.**
  - **Pending:** no release, no data yet, or the release was revoked.
  - **Not eligible.**
- **Who sees what:**
  - **Chapters:** the verdict only, with no reason. "Not eligible: GPA" would tell a chapter which side of the line the GPA fell, which is itself grade information.
  - **The PNM:** their own verdict, their own data and the reason. A student has a right to their own record.
  - **The council and the school office:** the reason and the data.
- **Override.** A `council:eligibility_manage` holder can override a verdict (an appeal, or a grade change the import missed). A reason is required, and the override is logged. The next import doesn't silently undo it: the officer is shown the conflict.
- **Recheck timing:**
  - **On every import.**
  - **On rule changes.**
  - **Scheduled reminders:** the council sets the dates it expects new grades (typically after final grades post, and a few days before bid day), and the eligibility officer is reminded to import.
  - **Changes after a bid:**
    - Every bid stores the verdict at the time it was extended.
    - If the verdict changes after a bid (Eligible → Not eligible), the chapter and the council are told.
    - Whether the bid is voided is a council rule (default: told only).

### Care rules for grade data

These apply whatever the data-model design picks:
- **Who reads it:** only the API, through the eligibility service. RLS denies all direct reads.
- **Where it never goes:** logs, Sentry, analytics events, chat payloads, push text, emails, or any export except the eligibility officer's own.
- **Read log:** every read of a PNM's GPA (opening the record, or an export) is logged with who and when.
  - The school's FERPA duty to record disclosures sits with the school.
  - Frapp's log lets the council answer "who saw my grades" and lets the PNM see it in their own view.
  - That this is what FERPA needs is derived, not verified with counsel.
- **Encryption:** grade values are encrypted at rest beyond the database's disk encryption, with the key outside the database. The mechanism is the data-model design's.
- **Deletion:** grade values are deleted 30 days after the season closes (a council setting, at most 90). The verdict and the release record are kept with the PNM until [retention](#retention-and-deletion) removes them.

### If Paul says no to storing GPA

**The verdict-only fallback:**
- The import computes each verdict in memory, stores only the verdict, the `as_of` date and which rule clauses passed, and discards the grades.
- The PNM release still applies, because the verdict is itself derived from the record.
- Everything chapters see is unchanged.
- **What's lost:**
  - the council can't see a GPA in Frapp;
  - an override can't show the number it overrides;
  - a rule change needs a re-import.

## Council rules and bid day

### Recruitment calendar

- **Season dates.** A council with `council:recruitment_manage` defines a season with dates:
  - registration opens;
  - the event window;
  - an optional quiet period;
  - the bid window (opens, closes);
  - bid day;
  - the season closes.
- **Where they appear:**
  - the council's calendar, through the council tenant's events, as all-day markers;
  - every member chapter's Rush dashboard;
  - PNMs' own view.
- **Council events** (kickoff, info nights) are ordinary council events with "Open to PNMs" on.

### Rules

**Rules Frapp enforces,** each a council setting:

| Rule | What Frapp does |
| --- | --- |
| Bid window | Blocks Extend outside the window |
| Eligibility before bids | Blocks or warns on Extend for Not eligible; warns for Pending |
| One acceptance per PNM | On, by default. Accepting closes other bids |
| Bid expiry | Sets each bid's default expiry |
| Quiet period | Pauses Frapp's chapter-to-PNM messages and follow-up reminders, and shows the quiet period on the dashboard. It can't stop a text sent outside Frapp, and says so |
| Bid-day release | Holds bids until release ([below](#bid-day)) |

**Rules Frapp can't enforce** (dry recruitment, no contact at certain places, and so on):
- The council writes them in a rules document, pinned on the council's recruitment page.
- **Each chapter's recruitment lead acknowledges them once a season.** The acknowledgement is recorded with who and when, and the council sees which chapters haven't.
- **Violations.** A chapter, a PNM or a council officer can report a violation to the council from the rules page. It goes to the council's judicial role. Judicial cases themselves are another part of #4192.

### Bid matching and bid day

- **IFC: no matching.** IFC recruitment is usually open bidding: a chapter extends a bid and the PNM accepts one. Frapp's IFC flow does no matching.
- **Panhellenic needs matching,** which is a later phase ([§ Phasing](#phasing)).

#### Bid day

**Two modes, a council setting:**
- **Rolling** (the default): a bid reaches the PNM when it's extended.
- **Release:**
  - Bids extended in the window are held as "submitted". The PNM doesn't see them, and nor do other chapters.
  - At the release time, the council releases them all at once. Every PNM is notified at the same moment.
  - An acceptance deadline then applies.
  - The council sees a count of submitted bids per chapter before release, and can release early or move the time.

### Reporting to the Greek life office

A holder of `council:recruitment_reports` exports for the season, as CSV or PDF:

| Report | Contents |
| --- | --- |
| Registration summary | PNM counts by source and class year |
| Eligibility summary | Eligibility counts. Counts only; no grades leave this way |
| Bids by chapter | Per chapter: bids extended, accepted, declined, expired, rescinded |
| New member rosters | Per chapter: name, school email, student ID and acceptance date for each accepted PNM. This is what offices typically collect for new-member and anti-hazing reporting |
| Rule acknowledgements and violation reports | Which chapters acknowledged the rules, and any reports filed |

The school office's read-only role sees the same reports in the app.

## The PNM's own view

**Signing in.** The PNM reaches it from the emailed link, or by signing in with their verified school email. It needs a Frapp account, but no chapter. The URL and data-model designs place it (a `school_members` row with status `pnm`, in the concept).

**What it shows:**
- their details, which they can edit, and their interests;
- events they've been invited to;
- **bids**, with Accept and Decline;
- their eligibility verdict and reason;
- the FERPA release: sign or revoke;
- who has read their grades.

**What they can do:**
- **Withdraw from one chapter.** This removes that interest. The chapter's candidate moves to Closed ("withdrew") and loses the PNM-supplied contact details.
- **Withdraw from recruitment entirely.** This is the same for every chapter, and the council stops sharing them.
- **Delete my recruitment information.** Everything below happens at once:
  - The PNM record, interests, grade data and form answers are deleted.
  - Each chapter's candidate is closed and unlinked, and keeps only the name the chapter itself typed (if any).
  - The council keeps only counts.
  - This is separate from deleting a Frapp account ([`data-retention.md`](data-retention.md)), which also triggers it.

## Retention and deletion

**When a PNM never joins,** their record is deleted at the season close plus N days. N is a council setting, default 180, so a PNM who rushes again next semester keeps their history. That deletes:
- interests;
- form answers;
- the release record;
- each chapter's link and PNM-supplied fields.

**When a PNM joins,** their PNM record becomes history, and the same clock applies. Their membership is a normal member record.

**Chapter-private pipeline data:**
- **Deleted 30 days after the season closes,** for every candidate: notes, ratings, contact logs, form answers, follow-ups.
- **Kept:** stage, bid outcome and dates, for the chapter's own year-over-year numbers.
- **Why delete notes:** notes written about a PNM who became your brother shouldn't follow them into membership. This default is [decision 7](#decisions-for-paul).
- **Votes:** the existing `rush_candidate_votes` rows follow the same 30-day rule. The count is kept on the candidate.

**When a chapter is cancelled,** its candidates go with it ([`data-retention.md` § Chapter Cancellation](data-retention.md#chapter-cancellation)). The PNM's council record and other interests stay.

**When a council is deleted,** its master list, its grade data and its PNM records for that school go too. Chapter candidates stay and are unlinked.

## Phasing

**MVP for our school's IFC this cycle.** It builds on the URL and data-model phases 1 and 2 in the concept:

1. **The chapter pipeline:**
   - default stages;
   - notes, tags and ratings;
   - contact log, owner, follow-ups and the stale alert;
   - bid extend, accept, decline, record and expire;
   - the dashboard;
   - every `rush:*` key wired on the API **and** the clients (#4084).
   - Chat keeps working.
2. **Chapter interest forms:** the public page, school-email verification, fixed and custom questions, QR source labels, and the consent text Paul approves.
3. **The master list:**
   - PNMs from chapter forms, IFC registration and a roster import;
   - de-duplication and the merge queue;
   - **option A** visibility;
   - "Accepted elsewhere".
4. **Eligibility:** the rule, the release with revoke, the grade CSV import, the verdict, the override, the read log and deletion. Or the verdict-only fallback, if Paul decides that.
5. **Season, from the council side:**
   - season dates;
   - the bid window;
   - eligibility before bids;
   - one acceptance;
   - **rolling** bids;
   - the rules document with chapter acknowledgement;
   - the bids-by-chapter and new-member-roster exports.
6. **PNM own view:** bids, release, withdraw and delete.

**Soon after:**
- PNM event attendance, marked from the roster. Then the guest QR check-in.
- Option B (the opt-in directory and the invitation to connect).
- Bid-day release mode.
- The formal bid vote.
- The quiet-period message pause.
- Violation reports.
- The chat form card's shared question builder (#3926).

**Later:**
- Mass text and a chapter phone number. ChapterBuilder has these, per the research; they need an SMS provider, which is a cost and compliance decision (TCPA, carrier registration).
- The recruitment bounty (#3953).
- Campus SSO in place of the email code.
- Panhellenic.

### Panhellenic differences

Panhellenic formal recruitment is a different process. It needs its own design pass before it's built, not settings on the IFC flow.

- **Rounds and invitations.** PNMs visit every chapter in the first round, then chapters invite and PNMs accept invitations to later rounds. These are typically open house, philanthropy, sisterhood and preference. Each round needs schedules, per-PNM invitation lists, and capacity per party.
- **Mutual selection.** After preference round, chapters rank PNMs and PNMs rank chapters. A matching algorithm assigns bids. NPC's Release Figure Methodology sets how many each chapter invites per round, and quota and "total" set the size of the new member class. Frapp would either build matching or integrate with a provider. Matching errors are high-stakes and public, so this is the riskiest piece of any phase.
- **Recruitment counselors** (Rho Gammas / Pi Chis) disaffiliate from their chapters during recruitment. So a counselor role must see PNM logistics and **nothing** chapter-private, including their own chapter's pipeline.
- **Continuous open bidding** after formal recruitment works like the IFC's rolling bids, so the IFC flow covers it.
- **Registration fees** are common, which is a billing decision for Paul.

## Decisions for Paul

Each of these is on the AGENTS.md "raise first" list, or is an open product decision:

1. **Storing GPA** (Winston: yes, with extra care). Security, legal exposure, and whether a school's attestation that a release is on file is enough. Laws involved: FERPA's redisclosure limits, and state student-privacy laws, many of which focus on K-12 but not all. Counsel should look before real grades are imported.
2. **The FERPA notice and Privacy Policy.**
   - [`legal.md` § FERPA Notice](legal.md#ferpa-notice) says Frapp "does not access student education records". Eligibility makes that untrue, so the notice must change before eligibility ships.
   - The Privacy Policy must cover people without accounts (form submitters) and grade data.
   - Both are legal copy.
3. **The consent text** on the interest form, and the FERPA release text. Both are drafts here.
4. **PNMs under 18.**
   - The Terms require 18 or older (decision 2026-09-23, #2261), and every form asks for it.
   - Some first-year students are 17 at recruitment. Today they would be turned away.
   - Allowing them means a Terms change and parental-consent questions. Recruiting minors may also be against the council's or school's own rules.
5. **Council billing** (Winston: someone on the IFC pays). It's a pricing decision, and the SMS phase adds a cost.
6. **Recruitment defaults** (#4068). Should notes, votes and bids default to officers, or stay member-wide as today? `rush:notes` becoming "read" makes this matter more.
7. **The retention defaults:** 30 days for chapter notes and grades, 180 days for unconverted PNMs.
8. **Which master-list option is the default:** A recommended, B next. Winston deferred this.

---

**Dependencies on the sibling designs:**
- **URL/context:** the public form, PNM view and council recruitment URLs, and how a PNM with no chapter is routed.
- **UI:** the pipeline board, candidate page, dashboard, master list, merge queue, import preview and PNM view.
- **Data model:**
  - `pnms`, `pnm_interests`, the consent and release records, `pnm_academic_records` and its encryption, `rush_candidates.pnm_id`;
  - the relaxed name index;
  - the widened `stage` and `bid_status`;
  - PNM attendance;
  - the council permission scope.
