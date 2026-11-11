# IFC recruitment: master list, interest forms, chapter pipeline, eligibility

> **Status: Proposed. Paul reviewed it on 2026-11-11 and made the calls in [§ Decisions](#decisions-for-paul). Nothing here is built, and no build date is set.**
>
> Part of [#4192](https://github.com/pdcarlson/Frapp/issues/4192). Asked by: Winston (`whewitt-frapp`), 2026-11-11.
>
> **Not scheduled.** Recruitment is behind the beta (Paul, 2026-11-05: rush is not a beta priority; 2026-11-10: baseline first). No build issues are filed from this file until Paul sets a date. Until then:
> - [`rush.md`](rush.md) and the code own what recruitment does today, and nothing here overrides them.
> - Nothing here is drift to file or a rule to build against.
>
> [§ Phasing](#phasing) and [§ Decisions for Paul](#decisions-for-paul) are here so Paul can review one page. Once he sets a date:
> - they move to issues;
> - each approved rule moves into `rush.md` (chapter side) or a council spec;
> - this file shrinks to what is still proposed.

This is the **behavior** part of the #4192 design. Three sibling designs own the rest, and this file names what it needs from each:

- **URLs and tenant context:** [ADR-27](https://github.com/pdcarlson/Frapp/pull/4213) (merged as Proposed, pending Paul). This file uses its decisions:
  - Interest forms are public at `/f/<form-slug>`. The form slug is separate from the chapter slug, so a printed QR code survives a chapter rename, and a chapter can replace its form.
  - A council lives at `/c/<council-slug>` and campus pages at `/s/<school>`.
  - **Needed from it:** the PNM view's URL, and how a PNM with no chapter is routed.
- **Screens and layouts:** the UI design.
  - **Needed from it:** the pipeline board, the candidate page, the dashboard, the master list, the merge queue, the import preview and the PNM view.
- **Tables, columns, RLS and the permission registry's council scope:** the data-model design. Councils are `chapters` rows with `kind = 'council'`, linked to chapters through affiliation tables.
  - It follows **Paul's #4068 decision 11**: a chapter pushes data up, and a parent never reads a chapter live. Finances, chat, and a chapter's prospect notes and votes have no path up.
  - Table names below are placeholders from the [concept comment](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804509311): `pnms`, `pnm_interests`, `pnm_academic_records`, `rush_candidates.pnm_id`.
  - **Needed from it:** each of those tables, plus the consent and release records, grade encryption, the widened stage and bid state, PNM attendance, a stored vote count, and the council permission scope.

**Naming.** On the council side this file says "council", never "IFC", in keys and in data. The archetype key `ifc` already means *a fraternity that is a member of an IFC*.

**Sources:**
- Winston's input on #4192, including [his answers](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804810927).
- The [ChapterBuilder / CampusDirector research](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804236717). **Its vendor claims are unverified:** the sandbox could not open their pages.
- The hub's FERPA research. It comes from search excerpts, and it's not legal advice.
- On `main`:
  - [`rush.md`](rush.md);
  - `supabase/migrations/20260910020000_rush_candidates.sql`;
  - `apps/api/src/interface/controllers/rush.controller.ts`;
  - `RushService`.
- Issues #4070, #4084, #3953 and #3926.

## Contents

1. [Words used here](#words-used-here)
2. [Who does what](#who-does-what)
3. [A recruitment week at real scale](#a-recruitment-week-at-real-scale)
4. [The council master list](#the-council-master-list)
5. [Chapter interest forms](#chapter-interest-forms)
6. [The chapter Rush module](#the-chapter-rush-module)
7. [Eligibility](#eligibility)
8. [Council rules and bid day](#council-rules-and-bid-day)
9. [The PNM's own view](#the-pnms-own-view)
10. [Retention and deletion](#retention-and-deletion)
11. [Phasing](#phasing)
12. [Decisions for Paul](#decisions-for-paul)

## Words used here

- **PNM** (potential new member): a student being recruited. One PNM is **one person at one school**, however many chapters they talk to. They are a `school_members` row with status `pnm` (ADR-27).
- **Master list:** the council's list of every PNM at the school.
- **Interest:** a link between a PNM and one chapter. It records how it started: that chapter's form, an event check-in, the council's registration, or an import.
- **Candidate:** today's `rush_candidates` row, the chapter's own record of a prospect.
  - A candidate may link to a PNM through `pnm_id`.
  - It may not: a prospect a member added by name has no link.
- **Push-up event:** something a chapter or a PNM sends to the council. Under decision 11, that is the only way chapter-side facts reach the council. The council never reads a chapter's pipeline.
- **Season:** one recruitment cycle as the council defines it, such as Fall 2027. Rules, dates, bids and retention all hang off a season.
- **Vocabulary:** chapter-facing copy goes through the chapter's vocabulary helper ([`rush.md` § Vocabulary](rush.md#vocabulary)). Council-facing and PNM-facing copy says "recruitment", so a PNM never sees a chapter's private word for it.

## Who does what

| Actor | Where they act | What they can reach |
| --- | --- | --- |
| PNM | The public form (no account), then their own PNM view once their email is verified | Their own record, interests, eligibility, bids and releases |
| Chapter member | Their chapter's Rush module, gated by the `rush:*` keys | Their chapter's candidates, plus the master-list fields the council shares |
| Council officer | The council's Recruitment area, gated by the council keys below | What PNMs and chapters push up. Never a chapter's pipeline |
| School office (Greek life) | A role on the council holding `council:grades_import` and `council:recruitment_reports` | Imports grades. Reads verdicts and reports |

**Proposed council keys.** Their scope is `council`, so they appear only in a council's role editor. The data-model design owns the registry shape.

| Key | Allows |
| --- | --- |
| `council:recruitment_view` | Read the master list: PNM fields, interest **counts**, eligibility verdicts, acceptances. Contact details, per-chapter detail and bids follow [§ Officers in a chapter](#council-officers-are-also-chapter-members) |
| `council:recruitment_manage` | The council's registration form, roster imports, merges, season dates and rules, bid-day release |
| `council:grades_import` | Upload grade files and see the import summary. Nothing else |
| `council:eligibility_manage` | Set the eligibility rule, override a verdict, read the reason behind a verdict. Read GPA and credits only if a later decision stores them ([§ Eligibility](#eligibility)). Includes `council:grades_import` |
| `council:recruitment_reports` | Export reports for the Greek life office |

**When a council's master list exists.** Under ADR-27, a new council starts **Unverified** and sees nothing. Two things must happen first:
1. Chapters accept its link.
2. The Greek life office (or Frapp staff) clears the badge.

So **a master list exists only for a verified council, and only covers chapters whose link is accepted.** Until then, chapter forms feed only the chapter ([below](#before-the-chapters-council-link-is-accepted)).

## A recruitment week at real scale

Every rule below is checked against this week, not against one PNM and one chapter. **The numbers are assumptions to confirm with our IFC** before building: about 15 IFC chapters, 300 to 500 PNMs in a fall season, and a busy chapter working 60 to 80 prospects with 10 to 20 active recruiters.

| When | Who | What they do | Where | What it needs from this design |
| --- | --- | --- | --- | --- |
| Tabling day | 3 or 4 brothers per chapter at a table | 30 to 50 PNMs scan the chapter's QR code and fill in the form on their own phones in under a minute. Brothers glance at who just signed up | PNM's phone; brothers' phones | Verify-first form that works on a phone over campus Wi-Fi; a new candidate appears in the pipeline within seconds; no laptop at the table |
| The same evening | Recruitment chair | Splits the day's 40 new names among recruiters | Laptop, web | Bulk-assign owners from the list; filter by "New" and by QR label |
| Every day | Each recruiter | Texts their 5 to 10 prospects outside Frapp, then logs "texted" in two taps | Phone | Log a contact from the candidate row in two taps, with no form to fill |
| Event night | 2 brothers at the door | Mark 20 to 40 PNMs present as they arrive | Phone | Search the PNM roster by first name and tap; works with one hand; repeat taps are harmless |
| Chapter meeting | Whole chapter | Talks through the `bid_ready` list and votes | Phones in the room | One-tap vote on each candidate; results only to `rush:view_results` |
| Bid night | President or recruitment chair | Extends 10 to 20 bids | Phone or laptop | Extend from the board; window and eligibility checks explain themselves in plain words when they block |
| The whole season | Council VP of Recruitment | Watches registration, verdicts and bid counts | Laptop, web | Counts and totals only while the season is open ([below](#council-officers-are-also-chapter-members)) |

**Phone first.** Logging a contact, marking attendance, voting, moving a stage and reading a candidate's page must all work on mobile in the MVP. Setting up the form, managing stages and tags, merges, imports and reports may be web-only at first. The UI design owns the screens, but it may not move a phone action above to web-only.

## The council master list

### How a PNM gets onto it

Every route leads to the same record. A PNM is never created twice.

1. **A chapter's interest form** ([below](#chapter-interest-forms)).
   - Once the chapter's council link is accepted, a submission is a push-up event that creates or finds the PNM and adds an interest.
   - The chapter's candidate is created in the same step.
2. **The council's registration form.** The council has its own form, the same shape as a chapter form but with no chapter. Schools that run formal IFC registration point students there.
   - It creates or finds the PNM, and adds no chapter interest.
   - The council can add one question: "Which chapters are you interested in?"
     - Each chapter ticked gets an interest, sourced `council_registration`, pushed **down**: that chapter gets a candidate.
     - That's the PNM's own choice, so it isn't a chapter reading anything.
3. **An import from the school.** A CSV the school or council uploads, such as the incoming class or the school's own registration export.
   - Each row is created or matched as a PNM in an **imported, unverified** state, with the student ID the school supplied.
   - **An imported PNM is never shown to any chapter** until they verify their email and then either show interest or opt in to being shared ([§ What chapters see](#what-chapters-see-on-the-master-list)). Being on a school's list isn't consent to be recruited.
4. **QR codes** are links to a form (a chapter's or the council's) with a source label such as `tabling-quad`. The label is recorded on the interest. There is no separate QR path.
5. **A chapter member adding someone by name** (`/rush add`, or Add in the pipeline).
   - This creates a **chapter-only candidate with no PNM link and no push-up.** A chapter can't put a person on a campus-wide list.
   - When that person later submits any form, the chapter is offered a link to the existing candidate by name. A member with `rush:add` confirms it; it never links on its own.

### Identity and duplicates

- **The main key is a verified email.**
  - **For a chapter at a school,** it must be on one of the school's domains. Matching lowercases the address and folds the school's alias domains together (from the school record). It doesn't strip `+tags` or dots, since not every school's mail ignores them.
  - **For a chapter with no school:** [below](#chapters-with-no-school).
- **Verify first.** A form asks for the email first and sends a one-time code. **Nothing else on the form appears until the code is entered,** and an existing PNM's details are filled in only after that. So a stranger who types someone's email learns nothing.
- **Student ID is a match key only when the school supplied it** (a roster or grade import).
  - The council may also ask PNMs for their ID. A self-reported ID is stored as **unverified**.
  - It is never a match key for grades, and it only feeds merge suggestions.
  - That stops a PNM from claiming another student's ID and receiving their grades ([§ Getting the data in](#getting-the-data-in)).
- **Fuzzy matches are never merged automatically.**
  - These raise a suggestion in the council's merge queue (`council:recruitment_manage`), shown side by side:
    - the same name and class year;
    - two verified emails claiming one school-supplied ID.
  - **A merge:**
    - keeps one PNM;
    - unions the interests;
    - re-points each chapter's candidate to the survivor;
    - keeps the earlier `created_at`.
  - Every merge is logged with who made it and what each side held. MVP has no unmerge.
- **Inside one chapter,** a second form submission from the same PNM updates their answers. It doesn't add a candidate.
  - Two candidates that turn out to be one person (one added by name, one from a form) are merged by a holder of `rush:manage`.

### Fields

| Kind | Fields |
| --- | --- |
| **Core, set by the council** | Legal first and last name; preferred name; verified email; school-supplied student ID; class year or entry term; phone (optional, held by the chapters the PNM gave it to and never shown to the council, so the council's registration form doesn't ask for it); pronouns (optional); major (optional); how they heard about recruitment; source and date |
| **The council's own questions** | Up to 10, using the same question types as a chapter form |
| **Derived** | Interests; eligibility verdict; release status; recruitment outcome (none, bid outstanding, accepted at a chapter, or withdrawn) |

**Never collected:** race, religion, health, sexual orientation, immigration status, or a photo the PNM didn't upload.
- The form builder refuses a question whose label matches a short list of those topics, and says why.
- That guards against mistakes. It doesn't classify questions.

### What the council receives (push-up only)

The council never reads a chapter's pipeline. It holds only what was sent up.

| Comes from | The event | What it carries |
| --- | --- | --- |
| The PNM | Form submission, registration | The core fields except phone, which chapter, the source. Phone stays with the chapters the PNM gave it to |
| The PNM | Acceptance or decline of a bid | Which chapter, when |
| The PNM | Withdrawal, deletion | The withdrawal or deletion |
| The chapter | **Bid extended** | PNM, chapter, time, expiry. The chapter emits it when a member extends |
| The chapter | **Bid declined (recorded), rescinded or expired** | The outcome and time |
| The chapter | **Acceptance recorded and confirmed** | PNM, chapter, time. Sent only once the acceptance is confirmed ([§ Bids](#bids)) |
| The school office | Grade import | Through the eligibility service only |

**Chapter-private data has no event and never reaches the council:**
- notes, tags, ratings, votes and stage;
- contact logs and the owner;
- a chapter form's own questions and answers.

### Council officers are also chapter members

An IFC officer is usually a brother in one of the chapters the council covers. If they could see which chapters a PNM is talking to, or who has bid on whom, their own chapter would see what the [chapter rules](#what-chapters-see-on-the-master-list) deny it. So while a season is open:

- **Interests and bids show as counts per PNM.** For example, "interested in 3 chapters" or "2 bids outstanding".
- **Per-chapter aggregates show as totals.** For example, "Chapter A: 40 interested, 12 bids".
- **Which chapter a PNM chose shows only for acceptances.** An acceptance is public to the chapters anyway, as "Accepted elsewhere".
- **Held bid-day bids show only as counts per chapter** before release.
- **Per-PNM, per-chapter detail** (who is interested where, who bid on whom) opens to the council when the season closes, for reports.
- **Phone numbers are hidden from the council** (Paul, 2026-11-11, [decision 9](#decisions-for-paul)). The master list shows a PNM's verified email only. A council that needs to reach PNMs uses Frapp's own email to them, so no officer holds a list of every PNM's number.
- **Every council read of a PNM record is logged.** The log is visible to the council president and to the school office.

### What chapters see on the master list

Winston deferred this ([answer 5](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804810927)). Here are three options, each a council setting.

| | A. Interested only | B. Opt-in directory | C. Shared list |
| --- | --- | --- | --- |
| A chapter sees | Only PNMs who showed interest in **that** chapter | As A, plus a directory of PNMs who ticked "Let every IFC chapter at {School} see that I'm interested in recruitment" | Every verified PNM |
| What it sees for PNMs who didn't pick it | Nothing | Preferred name, class year, eligibility verdict. Contact details only after the PNM accepts the chapter's invitation to connect | The fields the council picks |
| Comparable | CampusDirector's one-way push of the fields the council enables (unverified research) | The concept's opt-in directory; Discord Student Hubs | A shared spreadsheet passed around |
| Risk | Chapters miss PNMs who registered but named no one | A new flow (the invitation to connect) | PNM data spreads to every chapter without the PNM choosing it |

**Decided (Paul, 2026-11-11): A for MVP, B next, never C by default.** A needs no new flow and keeps interest as the PNM's own act.

**Under every option, a chapter never sees:**
- which other chapters a PNM is interested in;
- another chapter's private data;
- another chapter's bids.

**One exception:** once a PNM accepts a bid, other chapters with an interest see **"Accepted elsewhere"**, with no chapter name. The council sends that down from the PNM's acceptance event, so those chapters stop recruiting that person ([§ Bids](#bids)).

## Chapter interest forms

### Every chapter has one

- **Created closed.** A chapter's form exists as soon as the Rush module is on. It stays closed until a holder of `rush:manage` opens it.
- **One live form per chapter.** A chapter that wants to know where people came from uses several QR source labels, not several forms. It can replace its form, which issues a new form slug (ADR-27).

### Before the chapter's council link is accepted

- A form at a chapter whose council link is pending, or whose council is still Unverified, **feeds only the chapter's pipeline.** Nothing is pushed up.
- **When the link is accepted,** those PNMs join the master list, because the consent text they agreed to already names "the council {Chapter} belongs to on Frapp" ([below](#consent-and-privacy-text)).
- Each PNM is emailed that their details went to the council, with the withdraw link.

### Chapters with no school

- A chapter with no school has no domain list. Its form accepts **any email**, verified by the same one-time code.
- The PNM is matched only within that chapter, so there is no master list and no `school_members` row.
- The PNM reaches [their own view](#the-pnms-own-view) through the link in their confirmation email. That view shows just this chapter.
- **When the chapter later joins a school,** candidates from a school domain are linked on the PNM's next form submission or sign-in, not before.

### The public page

**Access:**
- The page lives at `/f/<form-slug>` (ADR-27). It needs no account and no app, and `ChapterGuard` doesn't apply. A QR code points to it.

**What it shows.** It reads only the form's public fields:
- the chapter's name and crest, in its accent color (Signet);
- a short blurb the chapter writes (up to 500 characters);
- the chapter's upcoming events that are open to PNMs ([§ Events](#events-and-attendance));
- the questions;
- the consent text;
- links to the Privacy Policy and Terms.

It never shows members, chat or other internal data.

**When the form is closed,** the page says recruitment isn't open, and links to the council's registration form if there is one.

**Abuse controls:**
- A rate limit per IP and per address on code sends and submissions (ADR-27).
- A bot challenge before a code is sent.
- Nothing reaches the chapter until a code is verified.

**After submitting:**
- A confirmation page shows the chapter's events, a "Manage my recruitment info" link, and an optional "Get the app".
- A confirmation email carries the same link.

### Fields

- **Fixed, set by the council, always first:**
  - name and preferred name;
  - email, verified before the rest of the form appears;
  - class year;
  - phone (optional).

  They're the master-list fields. For a PNM who already exists, they're filled in **after** the code is verified, and an edit updates the PNM.
- **The chapter's own questions:** up to 10.
  - **Types:** short text, long text, single choice, multiple choice, yes/no.
  - Each is optional or required.
  - The same sensitive-topic guard as the master list applies.
  - **Private to the chapter, with no push-up.**
  - The builder should share its question types with the chat form card (#3926), so one builder serves both.
- **"Who referred you?"** An optional built-in question.
  - **Free text.** The page never searches members, since that would list the chapter's roster to anyone.
  - The API matches the text to a member's name after submission. The chapter sees the suggested match and confirms it.
  - It pre-fills the owner suggestion and, later, feeds the recruitment bounty (#3953).

### What a submission does

All in one transaction, written server-side (ADR-27):

1. **Finds or creates the PNM.**
   - At a school, it uses the [identity rules](#identity-and-duplicates) and makes a `school_members` row with status `pnm`.
   - With no school, it finds or creates the PNM within the chapter.
2. **Adds an interest,** with the source (`chapter_form`) and QR label. A repeat submission updates it.
3. **Creates or updates the chapter's candidate,** in the first stage, with `pnm_id` set.
   - If an unlinked candidate in the chapter has the same name, the chapter is asked to confirm a link (`rush:add`).
4. **Pushes the interest up**, if the chapter's council link is accepted ([above](#before-the-chapters-council-link-is-accepted)).
5. **Tells the chapter:**
   - **A push and an inbox item.** These go to holders of `rush:manage` and to the chapter's **recruitment contacts**, a Group ([#4068 decision 6](https://github.com/pdcarlson/Frapp/issues/4068), #4076) that `rush:manage` picks on the Recruitment settings page (default: a Group holding the President). A Group holds no permissions, so a member of it who lacks `rush:view` is skipped, and the settings page says who that is. Each person's own notification settings still apply.
   - **An optional card.** If a holder of `rush:manage` names a channel, the existing rush candidate card is posted there, marked "from interest form". Two rules govern it:
     - **Only to a channel where everyone who can see it holds `rush:view`.** Channel access is a see list by tier, role and group ([#4068 decision 2](https://github.com/pdcarlson/Frapp/issues/4068), #3722), not a permission key, so the check runs on that list. It runs when the channel is picked, and again at every post, because the see list or someone's roles may have changed since. If the check fails at post time, the card isn't posted: the push and inbox item still go out, and holders of `rush:manage` are told once that the channel is no longer private enough.
     - **Name and stage only.** It carries no contact details and no answers.

     If the PNM deletes their information ([below](#the-pnms-own-view)), their name on the card is rewritten to "Withdrawn prospect". That's the same in-place rewrite the account-deletion name scrub does to cards ([`data-retention.md`](data-retention.md#individual-account-deletion)).

### Consent and privacy text

The text sits above the submit button, never behind a link. **It's a draft.** Legal and privacy copy is Paul's ([AGENTS.md § ADR discipline](../../AGENTS.md#adr-discipline)).

> By submitting, you share this information with **{Chapter}**{ at {School}} so they can contact you about joining. {At a school:} Your name, email and class year (not your phone number) also go to the council {Chapter} belongs to on Frapp (today: **{Council}** / none yet), which keeps one recruitment list for {School}. The council sees how many chapters you've signed up with, and which one you join. Other chapters don't see that you signed up here. {Under option B or C, say exactly what other chapters see.} Frapp stores this for them. You can withdraw from this chapter, or delete your recruitment information entirely, at any time from the link we email you. We don't ask for your grades here. If the council checks eligibility, you'll be asked to sign a separate release in Frapp, unless you've already signed one with {School}. Either way, we'll tell you when your eligibility is checked, and you can revoke at any time.

**The boxes:**
- **Required:** "I agree, and I'm 18 or older." The Terms require 18 ([`legal.md`](legal.md)), and some first-year PNMs are 17. That's [decision 4](#decisions-for-paul).
- **Optional, under option B only:** "Let every IFC chapter at {School} see that I'm interested in recruitment."

**What is stored with each submission:**
- the consent text version;
- which boxes were ticked;
- the time;
- the source label.

## The chapter Rush module

Today recruitment runs through chat only: the slash commands and the candidate card ([`rush.md`](rush.md)). This adds:
- a **pipeline** (a board and a list);
- a candidate page;
- a dashboard.

Chat keeps working, and the card links to the candidate's page.

### Stages

**ChapterBuilder's approach.** The research says it uses one letter scale, D to A+, that mixes interest with progress; A+ means a signed bid. Frapp keeps three things apart, because a chapter acts on each differently:

- **Stage:** where the relationship is. The chapter moves it.
- **Fit rating:** what members think. Each member rates, and the result is an average.
- **Bid state:** the formal offer. Only bid actions move it.

**Stage categories.** [`rush.md` § Funnel](rush.md#funnel) says stage keys come from chapter config. This extends that rule:
- Each chapter stage belongs to one of six fixed **categories**.
- A chapter can rename, add, reorder and hide stages within a category.
- Automatic moves and the stale alert work by category, never by name:
  - an automatic move goes to the first visible stage in its category;
  - if every stage in that category is hidden, the move is skipped.
- **New** and **Closed** must each keep at least one visible stage.

| Category | Default stage | Means | Moves here |
| --- | --- | --- | --- |
| `new` | New | Just arrived from a form, an import or an add | Automatically, on creation |
| `contacted` | Contacted | Someone has reached out | Automatically, on the first logged contact; or by hand |
| `met` | Met | Has met members in person | Automatically, when marked present at a chapter event; or by hand |
| `engaged` | Engaged | Keeps showing up; being seriously considered | By hand |
| `bid_ready` | Bid ready | The chapter wants to bid | By hand |
| `closed` | Closed | Out of the pipeline | By hand, or automatically (see below) |

**A Closed stage needs a reason:**

| Reason | How it's set |
| --- | --- |
| Not interested | By hand |
| Not eligible | By hand |
| Chapter passed | By hand |
| No response | By hand |
| Accepted elsewhere | Automatically |
| Withdrew | Automatically |
| Deleted their information | Automatically |

**Bid state** is separate from stage:
- Its values are `none`, `extended`, `accepted`, `declined`, `expired` and `rescinded` ([§ Bids](#bids)).
- Extending a bid doesn't move the stage. The board shows bid state as a badge.

### Notes, tags, ratings

**Notes**
- **Reading needs a new key, `rush:read_notes`.**
  - [#4070's backfill](rush.md#permissions) gave `rush:notes` to every role that held `members:view`, including New Member, Alumni and custom roles. So "take `rush:notes` off Member" can't keep notes to a committee in existing chapters.
  - A new key starts on nobody's backfilled role. Tiers are each chapter's own ([#4068 decisions 5 and 10](https://github.com/pdcarlson/Frapp/issues/4068)), so there is no fixed "officer tier" to seed. Instead:
    - **New chapters:** it's on in the top two starting tiers (Exec board, Officers and chairs), as decision 9 does for other officer defaults.
    - **Existing chapters:** nobody holds it until an officer turns it on, because decision 9 keeps every new grant on an existing chapter opt-in. When the Rush pipeline ships, the Recruitment settings page shows "Nobody can read recruitment notes yet" with a button that turns it on for the top two tiers. Paul's own chapter needs this step too.
  - No one can read notes today, because notes aren't built. So this doesn't change [decision 12](rush.md#permissions)'s "today's behaviour".
- **Writing stays on `rush:notes`.**
- **Nobody reads notes about themselves.** A member never sees notes on a candidate linked to their own account or PNM record, whatever keys they hold. That covers a PNM who accepts a bid and joins as a New Member.
- **Editing and deleting:** an author can edit or delete their own note; `rush:manage` can delete any note.
- **Notes never appear on the chat card or in a push.**

**Tags**
- The chapter defines its own, such as "legacy", "athlete" or "met at tabling".
- Seeing tags needs `rush:view`. Tagging needs `rush:notes`. Managing the list needs `rush:manage`.
- Tags are private to the chapter, with no push-up.

**Ratings**
- A member with `rush:vote` rates a candidate 1 to 5, and can change it.
- Ratings are never shown by name: only the average and the number of raters.
- Seeing the average needs `rush:view_results`.

### Contact tracking and follow-ups

- **Log a contact.** Pick the kind (text, call, in person, social DM, email, event) and the date; a note is optional. Who logged it is recorded.
  - This needs `rush:add`, which this design widens to "add and work prospects", so it also covers moving stages.
- **Owner.** One member can be a candidate's main point of contact.
  - Any holder of `rush:add` can claim an unowned candidate.
  - Assigning someone else needs `rush:manage`.
- **Follow-ups.** A follow-up has a due date and a member it's for (the owner by default).
  - That member gets a push and an inbox item on the morning it's due, in their time zone.
  - Logging any contact clears it.
- **The stale alert.** A candidate in any category other than `closed` with no logged contact for N days (a chapter setting, default 7) shows on the dashboard as "Needs follow-up". Its owner is told once.
- **Phone and email.** Holders of `rush:view` see them only when they came from the PNM: through this chapter's form, or, under option B, after the PNM accepts the connection.

### Events and attendance

- **A recruitment event** is an ordinary chapter event ([`events.md`](events.md)) with an "Open to PNMs" switch, which needs `events:update`.
  - **Event types** (#3730, built in #4198) gain a "Recruitment" type whose default turns "Open to PNMs" on, so a recruitment chair picks the type and doesn't have to find the switch. Like any value an event copies from its type, changing the type later doesn't rewrite past events.
  - It is listed on the chapter's form page with its name, time and location only.
  - **PNM attendance is its own record**, not a row in `event_attendance`. Member check-in awards points through the `check_in_event` RPC, and a PNM is not a member.
- **MVP: marking from the roster.** A member with `rush:add` marks a candidate present on the event's PNM roster. That also:
  - logs a contact of kind "event";
  - moves the candidate to the `met` category if they were in `new` or `contacted`.
- **Soon after: a guest QR at the door.** The PNM scans a code shown at the event. It's the same rotating code as [member check-in](events.md#check-in), in a guest mode.
  - The PNM verifies their email first.
  - A known PNM is marked present, which adds an interest in this chapter (sourced `event`). The page tells them that before they confirm.
  - Anyone else gets the chapter form's fixed fields.
- **Council events,** such as a kickoff, are the council's own events. Attendance at them is on the master list and creates no chapter interest.

### Voting

- **The existing vote stays.** It's anonymous, one per member and one click: support ([`rush.md` § Voting and Bids](rush.md#voting-and-bids)). Seeing the count needs `rush:view_results` once #4084 wires it.
- **Voting closes when the season closes.** At deletion ([§ Retention](#retention-and-deletion)), the count is first copied onto the candidate, in a column the data-model design adds. The ballots are then deleted, so the count survives, and the closed season can't be voted on again.
- **Soon after: a formal bid vote.**
  - **Who opens it:** a holder of `rush:manage`, as a timed ballot on candidates in `bid_ready`.
  - **Choices:** Yes, No or Abstain, cast by members with `rush:vote`.
  - **Threshold:** the chapter sets one: simple majority, two-thirds, or "no more than N No". Nationals differ, so the only default is a simple majority.
  - **Anonymity:** individual ballots are never shown.
  - **Results:** only to `rush:view_results`.
  - **A passing vote doesn't extend a bid.** A holder of `rush:bid` still does.
  - **Engine:** it should reuse polls ([`polls.md`](polls.md)), not build a second engine.

### Bids

| Action | Who | Rules |
| --- | --- | --- |
| **Extend** | `rush:bid` | Allowed only from `none` or `expired`. Any other state returns 409, so an old card can't undo an acceptance ([below](#compatibility-with-shipped-clients)). Blocked outside the council's bid window. For **Not eligible**, blocked or warned, as the council chooses. For **Pending**, warned. Stores the verdict at the time and gets an expiry (the council default, which the chapter can shorten). Pushed up as *bid extended*. Under bid-day release, held until release ([§ Bid day](#bid-day)) |
| **Accept or decline** | The PNM, in [their own view](#the-pnms-own-view) | While the bid is open. A PNM can accept one bid per season unless the council turns that rule off ([§ Rules](#rules)) |
| **Record a decline** | `rush:bid` | For a paper bid card or a verbal answer. Shown as "Recorded by {member}". Pushed up at once, since a decline changes nothing at other chapters |
| **Record an acceptance** | `rush:bid` | For a paper bid card or a verbal answer. Shown as "Recorded by {member}, waiting to be confirmed". **It stays inside the chapter until it is confirmed** (below) |
| **Confirm a recorded acceptance** | The PNM in their own view (one tap, from an email Frapp sends them at once), or a holder of `rush:manage` | Only then is it pushed up and do the [acceptance effects](#bids) run. A recorded acceptance nobody confirms by the bid's expiry stays `extended` and expires as usual |
| **Rescind** | `rush:manage` | Needs a reason. Pushed up |
| **Expire** | The system | When the expiry passes with no answer. Pushed up |

**Why a recorded acceptance waits.** Under [#4068 decision 12](rush.md#permissions), every member holds `rush:bid` by default. An acceptance closes the PNM's bids at other chapters and shows them "Accepted elsewhere", so one member's mistaken tap would reach every other chapter. Confirmation keeps those effects behind the PNM or an officer (Paul, 2026-11-11).

**When a PNM accepts** (or a recorded acceptance is confirmed):
- Under the one-acceptance rule, their other open bids close as `declined`, reason "accepted elsewhere".
- Other chapters with an interest see "Accepted elsewhere".
- The PNM gets this chapter's **invite to join as a new member**, through today's invite flow and its legal acceptance.
  - **The invite carries the chapter's new-member role,** the role in the starting tier set's New members tier ([#4068 decision 10](https://github.com/pdcarlson/Frapp/issues/4068)), not the chapter's default invite role (`default_invite_role_id`, which in some chapters is a full-member role such as Brothers).
  - **Picking that role** is a setting on the Recruitment settings page. It defaults to the first role in the New members tier, and the page asks the chapter to pick one when that tier has none or has been renamed away.
- Joining creates a normal membership. The candidate stays as recruitment history, subject to [retention](#retention-and-deletion).

**After a release is revoked,** a bid's stored verdict reads "Pending (release revoked)" to the chapter. The original is kept only in the eligibility audit, which only `council:eligibility_manage` can read ([§ The FERPA release](#the-ferpa-release)).

#### Compatibility with shipped clients

Today:
- `bid_status` allows `none` and `extended`.
- The response DTOs declare that enum.
- `RushService.bid` overwrites any state that isn't `extended`.
- Shipped mobile cards (`packages/hooks/src/rush-card.ts`) treat anything other than `extended` as open.

So the design:
- **keeps `bid_status`'s two values** on the existing routes and card, mapping `accepted` to `extended` and every other new state to `none`;
- **adds a new field** for the full bid state;
- **makes Extend refuse** anything but `none` and `expired`.

A shipped card then shows a sensible state, and its Extend button can't change an accepted or declined bid. The contract change must pass `npm run check:api-breaking:shipped`.

### Name lookup

Today `GET /v1/rush/candidates?name=` and `/rush vote|bid <name>` rely on names being unique in a chapter (`rush_candidates_chapter_name_key`, and `findByNameKey`'s single-row read). Form submissions can bring in two different "Jake Smith"s, so:

- **The unique name rule applies only among unlinked candidates.** A manual add still gets today's 409 when an unlinked candidate already has the name.
- **When a name matches several candidates,** the lookup returns 409, "Several prospects match", with their ids. The slash command then shows a picker. It never returns a 500 or picks one silently.

### Dashboard

The funnel that [`rush.md` § Funnel](rush.md#funnel) describes but was never built. It shows:
- counts by stage, in the chapter's order;
- bids: extended, outstanding, accepted, declined, expired;
- eligibility counts;
- needs follow-up, and follow-ups due;
- my candidates;
- sources: form, QR label, event, referrer;
- the next council date.

All of it needs `rush:view`, except vote counts and rating averages, which need `rush:view_results`.

### Where the chapter's settings live

Every chapter-side setting in this design goes on the **Recruitment module page** in Chapter settings, the one-page-per-module layout from #4073 (switch, rules that save, who can). Nothing here adds a second recruitment settings screen. The page holds:

- the interest form: open or closed, blurb, questions, QR labels, replace form;
- stages and their categories, tags, and the stale-days setting;
- the recruitment contacts Group and the card channel;
- the new-member role an accepted PNM's invite carries;
- turning on `rush:read_notes` for existing chapters ([§ Notes](#notes-tags-ratings));
- its "Who can" list, which shows the `rush:*` keys in plain words like every other module page.

Holders of `rush:manage` can edit them; the page is read-only to everyone else who can open Chapter settings.

### Permission map

This is what each key gates in this design. Today's meaning of each key is in [`rush.md` § Permissions](rush.md#permissions). Every **chapter-side** route keeps today's class gates (the `rush` module on, plus `members:view`). PNM routes and the public form use the PNM's verified session or the one-time code instead (ADR-27).

| Key | In this design |
| --- | --- |
| `rush:view` | The pipeline, the candidate page, the dashboard, tags, contact details the PNM supplied, the eligibility verdict, the event PNM roster, form answers |
| `rush:add` | Add a candidate; move stages; log contacts; claim an unowned candidate; mark PNM attendance; set follow-ups; confirm a candidate↔PNM link or a referrer match. **New label: "Add and work prospects"** |
| `rush:notes` | Write notes; tag candidates |
| `rush:read_notes` (**new**) | Read notes. On for the top two starting tiers in new chapters; opt-in for existing ones ([above](#notes-tags-ratings)) |
| `rush:vote` | Vote; rate; cast a formal bid-vote ballot |
| `rush:view_results` | Vote counts, rating averages, bid-vote results |
| `rush:bid` | Extend a bid; record a decline; record an acceptance (which waits for confirmation) |
| `rush:manage` | Open, close, edit or replace the form; QR labels; the recruitment contacts Group; the card channel; the new-member role; stages, tags and the stale-days setting; assign owners; confirm a recorded acceptance; rescind; merge candidates; delete; CSV export; open a formal bid vote |

**On the clients:** web and mobile hide what a role can't do, using `can` from `@repo/validation`. That closes #4084's client half for every action here.

## Eligibility

Eligibility is whether a PNM may receive a bid under the school's and council's rules.
- **The MVP stores verdicts, not grades** (Paul, 2026-11-11, [decision 1](#decisions-for-paul)). See [§ The MVP: verdict only](#the-mvp-verdict-only).
- Winston's answer was to store GPAs, with extra care. That stays the later option, and nothing stores a grade until a lawyer has answered decision 1's questions.
- The sections on stored grades below (care rules, the read log, encryption, raw-grade deletion, showing GPA to `council:eligibility_manage`) apply only if that later decision is yes. Everything else here applies to the MVP.

### The rule

A holder of `council:eligibility_manage` sets the rule once per season. Any part can be left out:
- minimum cumulative college GPA;
- minimum high-school GPA, for students with no college GPA yet;
- minimum credits;
- enrollment status (for example, full-time);
- conduct standing, which arrives from the school as a yes or no, never case details.

### The FERPA release

**Signing**
- The PNM signs in their own view.
- The signature is their verified email session, their typed full name and the date. The hub's research says electronic signing is accepted when the signer is authenticated.

**The release text names:**
- the school, as the source;
- the recipients: the council, the school's fraternity and sorority life office, and **Frapp, as the council's service provider**;
- exactly what is released: cumulative GPA, high-school GPA, credits, enrollment and conduct standing;
- the purpose: recruitment and membership eligibility for this season;
- who sees what: GPA by the council's eligibility officers and the school office; only the verdict by chapters;
- how long it lasts (through the season) and how to revoke it.

The research's examples (CU Boulder, Michigan, MSU, CMU, unverified) name the office and the chapter, but no vendor. Ours names Frapp explicitly.

**What is stored:**
- the text version and its hash;
- the typed name;
- the signed and revoked times;
- the season.

**A release signed at the school**
- Some schools collect the release on their own system.
- The import can then carry a "release on file at the school" column, and the school's attestation stands in for a Frapp signature.
- The PNM is still **told** when grades arrive under it, with a Revoke button.
- Whether Frapp may rely on the attestation is part of [decision 1](#decisions-for-paul).

**Revoking** is one action in the PNM's own view. It applies from then on and takes effect at once:
- Their grade data is **deleted**. An audit entry records that grades existed and were purged.
- The verdict returns to Pending, and needs a new release to change.
- Chapters see Pending, including on bids already extended ([§ Bids](#bids)).
- The council is told.
- Outstanding bids stay. Voiding them is a council rule.
- **A revocation in Frapp outranks the school's attestation.** A later import that attests a release for a PNM who revoked in Frapp is dropped for that PNM, until the PNM signs again.

**The release is not on the interest form.** It's asked only when the council runs eligibility, and only of verified PNMs.

### Getting the data in

1. **The upload.** A holder of `council:grades_import` uploads a CSV, shaped like ICS's grade import as the research describes it:
   - `student_id`, and optionally `email`;
   - `college_gpa`, `hs_gpa`, `credits`, `enrollment`, `conduct_ok`;
   - `as_of`;
   - optionally `release_on_file`.
2. **Matching.**
   - By a **school-supplied** student ID, then by verified email.
   - When a row has both and they point at different PNMs, the row is dropped and reported.
   - A self-reported ID never matches ([§ Identity](#identity-and-duplicates)).
3. **Minimization.**
   - **A row that matches no PNM is not stored.**
   - **A row for a PNM with no current release is not stored.** A school attestation counts as a release, but only if the PNM hasn't revoked one in Frapp.
   - The upload reports these as counts, never names.
4. **The summary.** Before anything is written, the uploader sees how many rows matched, how many verdicts are new or changed, and how many were dropped. They then confirm.
5. **Re-imports** replace the last values for the PNMs they cover.

**Self-reported GPA** is off by default.
- A council may allow it.
- It shows as "self-reported, unverified".
- It never produces Eligible unless the council chooses that.

### The verdict

**Computed by the API.** It has three values:
- Eligible;
- Pending: no release, no data, or the release was revoked;
- Not eligible.

| Who | Sees |
| --- | --- |
| Chapters | The verdict only, never the reason. "Not eligible: GPA" would tell them which side of the line the GPA fell |
| The PNM | Their own verdict, data and reason |
| Holders of `council:eligibility_manage` | The reason and the data |
| Everyone else on the council | The verdict |

**Overrides.** A holder of `council:eligibility_manage` can override a verdict, for an appeal or a grade change the import missed. A reason is required and the override is logged. The next import doesn't silently undo it: the officer is shown the conflict.

**Rechecks:**
- **When:** on every import and every rule change.
- **Reminders:** the council sets the dates it expects new grades (after final grades post, and before bid day), and the eligibility officer is reminded.
- **After a bid:** if the verdict changes after a bid was extended, the chapter and the council are told. Voiding the bid is a council rule; by default, they're only told.

### Care rules for grade data

**Who can read it:** only the API's eligibility service. RLS denies all direct reads.

**Where it never goes:**
- logs, Sentry or analytics;
- chat payloads, push text or emails;
- any export except the eligibility officer's own.

**Logging reads.** Every read of a PNM's grades is logged with who and when, and the PNM sees that log in their own view.
- The duty to record disclosures sits with the school.
- Frapp's log lets the council and the PNM answer "who saw this".
- That this meets FERPA is derived, not checked with counsel.

**Encryption.** Grade values are encrypted at rest beyond disk encryption, with the key outside the database. The mechanism is the data-model design's.

**Deletion.** Raw grades are deleted when the season closes, at most 30 days after (a council setting). The verdict and the release record stay until [retention](#retention-and-deletion) removes them.

### The MVP: verdict only

**How it works:**
- The import computes each verdict in memory.
- It stores only the verdict, its `as_of` date and which clauses passed, and discards the grades.
- The release still applies, because the verdict is derived from the record.
- Chapters see no difference.

**Even in memory,** the grade file follows the [care rules](#care-rules-for-grade-data): it never reaches logs, Sentry or analytics, and the uploaded file is deleted as soon as the import is confirmed or cancelled.

**What's lost, accepted for the MVP:**
- the council can't see a GPA in Frapp;
- an override can't show the number it overrides;
- a rule change needs a re-import.

## Council rules and bid day

### Recruitment calendar

A holder of `council:recruitment_manage` defines each season's dates:
- registration opens;
- the event window;
- an optional quiet period;
- the bid window, opening and closing;
- bid day;
- the season closes.

**Where they appear:**
- as all-day markers on the council's calendar (its events, which it has as a tenant);
- on each member chapter's dashboard, pushed down;
- in PNMs' own view.

Council kickoffs and info nights are council events with "Open to PNMs" on.

### Rules

**What Frapp enforces.** Each is a council setting:

| Rule | What Frapp does |
| --- | --- |
| Bid window | Blocks Extend outside the window |
| Eligibility before bids | Blocks or warns on Extend for Not eligible; warns for Pending |
| One acceptance per PNM | On by default. A PNM can accept one bid, and accepting closes their other bids. Off lets a PNM hold several acceptances, where the council's rules allow it |
| Bid expiry | Sets each bid's default expiry |
| Quiet period | Pauses Frapp's chapter-to-PNM messages and follow-up reminders, and shows the quiet period on the dashboard. It can't stop a text sent outside Frapp, and says so |
| Bid-day release | Holds bids until release ([below](#bid-day)) |

**What Frapp can't enforce** (dry recruitment, no contact in certain places):
- **The rules document.** The council writes these rules in a document pinned to its recruitment page.
- **Acknowledgement.** Each chapter's recruitment lead acknowledges it once a season. Who and when are recorded, and the council sees which chapters haven't.
- **Violation reports.** A chapter, a PNM or a council officer can report a violation from the rules page. The report goes to the council's judicial role. Judicial cases are another part of #4192.

### Bid matching and bid day

**No matching for IFC.** IFC recruitment is usually open bidding: a chapter extends a bid and the PNM accepts. Frapp's IFC flow does no matching. Panhellenic needs matching, which comes in a later phase ([§ Phasing](#phasing)).

#### Bid day

The council chooses one of two modes:
- **Rolling** (the default): a bid reaches the PNM as soon as it's extended.
- **Release:**
  - Bids extended in the window are held as "submitted". The PNM doesn't see them, and nor do other chapters.
  - Before release, the council sees only a count per chapter.
  - At the release time the council releases them all, and every PNM is notified at once. An acceptance deadline then applies.
  - The council can release early or move the time.

### Reporting to the Greek life office

A holder of `council:recruitment_reports` exports these for each season, as CSV or PDF:

| Report | What it holds |
| --- | --- |
| Registration summary | PNM counts by source and class year |
| Eligibility summary | Counts only; no grades leave this way |
| Bids by chapter | Per chapter: extended, accepted, declined, expired, rescinded |
| New member rosters | Per chapter: name, email, school-supplied student ID and acceptance date for each accepted PNM. We expect offices to want these for new-member and hazing-prevention reporting. That's an assumption, not checked with a school |
| Acknowledgements and reports | Which chapters acknowledged the rules, and the violation reports |

Per-PNM, per-chapter detail is available only once the season closes ([above](#council-officers-are-also-chapter-members)). The school office's role sees the same reports in the app.

## The PNM's own view

**Getting in.** The PNM opens the link in their emails, or signs in with their verified email. They need a Frapp account but no chapter: a `school_members` row with status `pnm` (ADR-27). For a chapter with no school, it's the emailed link only.

**What it shows:**
- their details (editable) and interests;
- the events they're invited to;
- **bids**, with Accept and Decline;
- their eligibility verdict and reason;
- their release: sign or revoke;
- who has read their grades, if grades are ever stored ([§ Eligibility](#eligibility)).

**What they can do:**
- **Withdraw from one chapter.** The interest is removed. The chapter's candidate moves to Closed with reason "Withdrew" and loses the contact details the PNM supplied.
- **Withdraw from recruitment.** The same, for every chapter. The council stops sharing them.
- **Delete my recruitment information.** All at once:
  - The PNM record, interests, grades, form answers and release records are deleted.
  - Each chapter's candidate moves to Closed with reason "Deleted their information" and is unlinked. It keeps only a name a member typed, if any.
  - Interest-form cards are rewritten to "Withdrawn prospect".
  - The council keeps only counts.
  - Deleting a Frapp account ([`data-retention.md`](data-retention.md#individual-account-deletion)) triggers this too.

## Retention and deletion

**A PNM who never joins.** Their record is deleted at season close plus N days. N is a council setting, default 180, so someone who rushes again next term keeps their history. That deletes:
- interests;
- form answers;
- release records;
- each chapter's link and the fields the PNM supplied.

**A PNM who joins** follows the same clock for their PNM record. Their membership is a normal member record.

**Chapter-private pipeline data**
- **Deleted 30 days after season close:** notes, ratings, contact logs, form answers and follow-ups.
- **Votes:** the count is first copied to the candidate ([§ Voting](#voting)), then the ballots are deleted.
- **Kept:** stage, bid outcome and dates, for the chapter's own year-over-year numbers.

Notes about a PNM who became a brother shouldn't follow them into membership. The default is [decision 7](#decisions-for-paul).

**A cancelled chapter** keeps its data read-only ([`data-retention.md` § Chapter Cancellation](data-retention.md#chapter-cancellation)). These recruitment clocks still run, because they protect the PNM, not the chapter.

**A deleted chapter** loses its candidates by cascade. The PNM's council record and their other interests stay.

**A deleted council** takes its master list, grade data and PNM records for that school. Chapter candidates stay, unlinked.

## Phasing

### MVP: our school's IFC, the first season after Paul sets a date

This builds on the URL and data-model phases 1 and 2 of the concept.

1. **The chapter pipeline.**
   - Stage categories with default stages; notes, tags and ratings.
   - Contacts, owner, follow-ups and the stale alert.
   - Bid extend, accept, decline, record and expire, with the shipped-client compatibility above. A recorded acceptance waits for confirmation.
   - The Recruitment module settings page, including the `rush:read_notes` opt-in for existing chapters and the new-member role.
   - The [phone-first actions](#a-recruitment-week-at-real-scale) on mobile.
   - Name-lookup disambiguation; the dashboard.
   - Every `rush:*` key wired on the API **and** the clients (#4084), plus `rush:read_notes`.
2. **PNM attendance, marked from the roster,** because the automatic move to Met needs it.
3. **Chapter interest forms.**
   - The public page at `/f/<form-slug>`, with verify-first.
   - Fixed and chapter questions, QR labels and the free-text referrer.
   - The rules for chapters before the council link and with no school.
   - The consent text Paul approves.
4. **The master list.**
   - Chapter forms, council registration and roster import.
   - Identity, de-duplication and the merge queue.
   - The push-up events and **option A**.
   - The council-officer limits and "Accepted elsewhere".
5. **Eligibility.**
   - The rule, the release with revoke, and grade import with minimization.
   - The verdict and overrides.
   - **Verdict only** ([above](#the-mvp-verdict-only)). Storing grades waits for counsel.
6. **The season, from the council side.**
   - Dates, the bid window, eligibility before bids, and one acceptance.
   - **Rolling** bids.
   - The rules document with chapter acknowledgement.
   - The bids-by-chapter and new-member-roster exports.
7. **The PNM's own view:** bids, release, withdraw and delete.

### Soon after

- The guest QR check-in at events.
- Option B (the opt-in directory and the invitation to connect).
- Bid-day release.
- The formal bid vote.
- The quiet-period message pause.
- Violation reports.
- The shared question builder with the chat form card (#3926).

### Later

- **Mass texts and a chapter phone number** (ChapterBuilder has these, per the research). They need an SMS provider, which is a cost and compliance decision (TCPA, carrier registration).
- **The recruitment bounty** (#3953).
- **Campus SSO** in place of the email code.
- **Panhellenic.**

### Panhellenic differences

Panhellenic formal recruitment needs its own design pass, not settings on the IFC flow:

- **Rounds and invitations.** In the first round PNMs visit every chapter. After that, chapters invite and PNMs accept, round by round (typically open house, philanthropy, sisterhood, preference). This needs schedules, per-PNM invitation lists and party capacity.
- **Mutual selection.** After preference, chapters rank PNMs and PNMs rank chapters, and a matching algorithm assigns bids.
  - NPC's Release Figure Methodology sets how many each chapter invites per round.
  - Quota and total set the size of the new member class.
  - Frapp would build matching or integrate with a provider. Errors are high-stakes and public, so this is the riskiest piece in any phase.
- **Recruitment counselors (Rho Gammas / Pi Chis) disaffiliate.** Their role sees PNM logistics and **nothing** chapter-private, including their own chapter's. The [council-officer limits](#council-officers-are-also-chapter-members) are the starting point.
- **Continuous open bidding** after formal recruitment is like IFC rolling bids, so the IFC flow covers it.
- **Registration fees** are common. That's a billing decision.

## Decisions for Paul

Each of these is on the [AGENTS.md raise-first list](../../AGENTS.md#adr-discipline) or is an open product decision. **Paul reviewed them on 2026-11-11** and took the recommendation on each. Where a call still needs a lawyer or his sign-off on exact wording, it says so.

1. **Storing GPA. Decided: verdict only for the MVP.**
   - The import computes the verdict and discards the grades ([§ The MVP: verdict only](#the-mvp-verdict-only)). Chapters see no difference.
   - Winston's preference, storing GPA with extra care, is the later option. It waits for a lawyer's answers to these questions, which also apply to the verdict-only MVP:
     - Is Frapp a school official, the council's agent, or a named recipient under the release?
     - Is the IFC a student organization or a school body for FERPA purposes?
     - May Frapp rely on a school's attestation that a release is on file?
     - Is the e-signature (a verified email code plus a typed name and date) enough?
   - **What's at stake if grades are stored:** the security risk and the legal exposure, including FERPA's limits on redisclosure and state student-privacy laws (many cover K-12, not all).
2. **The FERPA notice and the Privacy Policy. Paul approves the wording before any form goes live.**
   - [`legal.md` § FERPA Notice](legal.md#ferpa-notice) says Frapp "does not access student education records". Even a verdict computed from the school's records makes that untrue.
   - The Privacy Policy must cover people without accounts (form submitters) and eligibility data.
3. **The consent text and the release text,** both drafted here. **Paul approves the wording before any form goes live.**
4. **PNMs under 18. Decided: keep 18 and older for now** (the Terms, decision 2026-09-23, #2261). Some first-year PNMs are 17, so they're turned away.
   - Whether to allow them goes on the lawyer's list with decision 1: it means a Terms change and parental-consent questions.
   - The council's or school's own rules may also bar recruiting minors.
5. **Council billing. Decided: free for our IFC's pilot, priced later.** Winston says someone on the IFC pays; the price is set after the pilot. The SMS phase would add a cost.
6. **Revisiting [#4068 decision 12](rush.md#permissions). Decided: no further tightening.**
   - Every member keeps today's vote and bid by default; chapters tighten it themselves.
   - The one change is that a recorded acceptance waits for the PNM or a holder of `rush:manage` to confirm it ([§ Bids](#bids)), because its effects reach other chapters.
   - `rush:read_notes` follows decision 9's defaults ([§ Notes](#notes-tags-ratings)).
7. **The retention defaults. Decided as proposed:** 30 days after season close for chapter notes and other private pipeline data, and 180 days for PNMs who don't join. Raw grades don't arise in the MVP.
8. **The default master-list option. Decided: A** (interested only) for MVP, B next, never C by default.
9. **Council officers and contact details. Decided: phone numbers are hidden from the council** ([§ Officers in a chapter](#council-officers-are-also-chapter-members)). The council reaches PNMs through Frapp's own email. Read logging stays.

**Still open:** when to build. Recruitment is behind the beta, and no build issues are filed until Paul sets a date ([status](#ifc-recruitment-master-list-interest-forms-chapter-pipeline-eligibility)). The real-scale numbers in [§ A recruitment week](#a-recruitment-week-at-real-scale) are to be confirmed with our IFC before then.
