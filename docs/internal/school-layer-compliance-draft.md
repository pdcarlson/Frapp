# School layer: compliance drafts (FERPA release, policy redlines, minors, DPA, GPA controls)

> **DRAFT. Not legal advice. Pending Paul and counsel. Nothing here ships.**
>
> Part of [#4192](https://github.com/pdcarlson/Frapp/issues/4192). Asked by: Winston (`whewitt-frapp`), 2026-11-11.
>
> - Legal and App Store copy is Paul's call ([AGENTS.md § ADR discipline](../../AGENTS.md#adr-discipline)). This file **proposes** text for Paul and a lawyer to review. It does not change [`spec/behavior/legal.md`](../../spec/behavior/legal.md), the Terms, the Privacy Policy, the FERPA notice or any shipped copy.
> - It was written by an agent from web sources and the repo. No lawyer has read it. **No web source could be opened from the sandbox, so every citation is unverified** ([§ Sources](#sources)): it rests on search excerpts. Statements about what the law requires are the drafter's reading of those sources, not a legal opinion.
> - It depends on three designs that are themselves proposed, not approved: the recruitment behavior ([#4218](https://github.com/pdcarlson/Frapp/pull/4218), `spec/behavior/ifc-recruitment.md`), the data model ([#4222](https://github.com/pdcarlson/Frapp/pull/4222), `spec/architecture/school-layer.md`) and tenant URLs ([ADR-27, #4213](https://github.com/pdcarlson/Frapp/pull/4213)). Section numbers below like "school-layer § 3.2" refer to those files as proposed.
>
> **When this file stops being needed.** Once Paul and counsel decide, each piece moves to its owner and this file is deleted: the release text into code, versioned beside `LEGAL_POLICY_VERSION`; the policy text into `apps/landing/app/{privacy,ferpa,terms}/page.tsx` and `legal.md`; the DPA into whatever contract repository Paul uses; the controls into `school-layer.md`.

## Contents

- [What is being decided](#what-is-being-decided)
- [1. Grade release form (34 CFR 99.30)](#1-grade-release-form-34-cfr-9930)
- [2. Redlines for `legal.md`, the FERPA notice, the Privacy Policy and the Terms](#2-redlines-for-legalmd-the-ferpa-notice-the-privacy-policy-and-the-terms)
- [3. PNMs under 18](#3-pnms-under-18)
- [4. School-facing DPA outline and HECVAT readiness](#4-school-facing-dpa-outline-and-hecvat-readiness)
- [5. Security controls for GPA](#5-security-controls-for-gpa)
- [6. Questions for a lawyer](#6-questions-for-a-lawyer)
- [Sources](#sources)

## What is being decided

The IFC recruitment design needs a council to check whether a potential new member (PNM) meets the school's grade rule before a chapter extends a bid. Grades are **education records** under FERPA. FERPA binds the school, not Frapp, but Frapp is reached through it twice: by the consent the student signs, and by the redisclosure limits that follow the data ([school-layer § 6](https://github.com/pdcarlson/Frapp/pull/4222)).

Paul has three options for storage (school-layer § 3.1). This file is written for **option B**, the design's recommendation: GPA stored encrypted and purged after the recruitment term. Where option A (verdict only) or C (kept across terms) changes a draft, it says so.

| Option | Stores | What changes in this file |
|---|---|---|
| A. Verdict only | Eligible / Pending / Not eligible, plus the release | The release and the redlines still apply: a verdict is derived from an education record. The encryption controls in § 5 mostly fall away |
| **B. GPA, encrypted, purged after recruitment closes or on revocation** | A, plus the grade values | As written |
| C. GPA kept across terms | B without the term purge | Duration in § 1 becomes "while you are a member"; retention redlines and the DPA deletion schedule lengthen; the lawyer question on retention gets harder |

**The released records, once, for every section below.** The release (§ 1), every policy redline (§ 2) and DPA Schedule A (§ 4) name exactly this list, and the import refuses a column the signed release doesn't name:

- cumulative GPA;
- GPA for the most recent completed term;
- credit hours (earned, and enrolled in this term);
- enrollment status;
- the student ID, used only for matching;
- **optional, per council:** high-school GPA, for a student with no college GPA yet.

**Where the two designs disagree.** This file had to pick a side on each, and each needs Paul to settle it in the designs themselves before the release or the policy text can be final:

| Topic | #4218 (behavior) | #4222 (data model) | This draft |
|---|---|---|---|
| Records | Adds high-school GPA and **conduct standing** | `{gpa_cumulative, gpa_term, credits, enrollment}` | The list above. Conduct standing is a disciplinary record and more sensitive than a GPA; this draft leaves it out (lawyer question 13) |
| When grades are purged | "When the season closes, at most 30 days after (a council setting)" | Term close + 30 days by default, a council setting **capped at 90** | `{N}` days after **recruitment** closes, at most `{30}`. A 90-day cap would break every promise in §§ 1, 2 and 4 |
| Who reads GPA | `council:eligibility_manage` reads it, with no explicit-grant rule, so a council's `*` would too; the school office is a council role with `council:grades_import` | Explicit-grant `council:eligibility_view` / `_manage`; `*` and `roles:manage` can't reach them; no school-office role until Q8 | #4222's model. The FERPA notice doesn't promise office access |
| Export | "Any export except the eligibility officer's own" | GPA export denied and logged | #4222's: no GPA export |
| PNM sees the access log | "Who has read their grades" is in the PNM's view | § 3.4 shows the log to the council admin and later the school office only; no PNM read path | The release promises it, so #4222 needs a read path (§ 5) |
| What the release record stores | The text version **and its hash**, and the season | `release_version`, no hash, no season | Hash and season. #4222's table needs both columns |
| How the signer authenticated | The PNM signs in their view, "the signature is their verified email session" | `authenticated_via = 'school_email_code'` | A fresh code to the school email at signing, whatever the session's sign-in method (§ 1) |

## 1. Grade release form (34 CFR 99.30)

### What the regulation requires

34 CFR 99.30(b) requires a signed and dated written consent that:

1. specifies the records that may be disclosed;
2. states the purpose of the disclosure;
3. identifies the party or class of parties to whom disclosure may be made.

99.30(d) allows the consent to be electronic if it identifies and authenticates the person as the source of the consent and indicates their approval of the information it contains. ([S1](#sources))

Under 99.3, a student who attends a postsecondary institution is an **eligible student** at any age, so the PNM signs for themselves even at 17. Parents hold no FERPA rights over a college student's records unless the student consents or a dependency exception applies. ([S1](#sources); see § 3)

### How real schools do it

All from search excerpts; the agent couldn't open the pages ([§ Sources](#sources)).

| School | Records | Recipients | Duration | Revocation | Signature |
|---|---|---|---|---|---|
| **CU Boulder** ([S3](#sources)) | Semester and cumulative GPA | Office of Fraternity & Sorority Life, the chapter, the national organization, the chapter advisor | "For the duration of my membership in a recognized fraternity or sorority while I am a student" | The same Registrar form offers "release grades or revoke" | Online form, presumably behind university login (not confirmed) |
| **Michigan** ([S4](#sources)) | Enrollment status, term and cumulative GPA, total credit hours | Chapter recruitment and intake officers, alumni advisors, national organizations | Not found. FSL keeps records 6 years (7 for former members) | Not found | Not found. Signed at eligibility verification, before recruitment, since fall 2019 |
| **Michigan State** ([S12](#sources)) | Semester and cumulative GPA, enrollment status, credit hours | The chapter officials named on the form | Until revoked in writing | In writing; doesn't affect disclosures already made | Wet signature, returned to the FSL office |
| Oglethorpe ([S18](#sources)) | Grades | Chapter president, advisor, recruitment and academic chairs, honor societies, national HQ | Until the student leaves or stops being a member | In writing | Not found |

Every one names the chapter and the national organization, and lets them see grades. None names a software vendor. The hub's research on #4192 reported one registration consent that names PhiredUp, TechniPhi and CampusDirector ([S7](#sources)); the second search couldn't find it.

**What ours does differently, on purpose:**

- **It names Frapp.** None of the school forms found names a software vendor, though at least one registration consent elsewhere does ([S7](#sources)). Naming Frapp as "the council's service provider" is the design's answer to the redisclosure rule (99.33): data the council receives under the release can go to Frapp only if the release lets it.
- **Chapters get a verdict, not a GPA.** The school forms let chapters see the grades themselves. Ours names chapters as recipients of the eligibility status only (school-layer § 3.3).
- **It expires with the season** instead of running for the whole time someone is a student, because the design purges grades after recruitment closes.

### Draft release text

Placeholders are in `{braces}`. The text is shown in full on its own screen in the PNM's view, never behind a link, and its version, a hash of the text and the season are stored with each signature (#4218 § The FERPA release; #4222's `restricted.ferpa_releases` has the version but not yet the hash or season: see the table above).

> **{School} grade release for {Council} recruitment, {Season}**
>
> **Who I am.** I, {typed full name}, a student at {School} with the school email {verified email}, give this consent under the Family Educational Rights and Privacy Act (FERPA), 34 CFR 99.30.
>
> **What may be released.** I allow {School} to release the following from my education records:
> - my cumulative grade point average (GPA);
> - my GPA for the most recent completed term;
> - my credit hours: earned, and enrolled in for the current term;
> - my enrollment status (for example, full-time, part-time, not enrolled);
> - {optional, only if the council turned it on} my high-school GPA, if I have no college GPA yet;
> - my student ID number, used only to match these records to me.
>
> **Who may receive them.**
> - **{Council}**, the {Interfraternity Council} at {School}, through the officers it names to check eligibility;
> - **{School}'s {Office of Fraternity and Sorority Life}**;
> - **Frapp** ({legal entity name}), which runs the recruitment software {Council} uses, **only as {Council}'s service provider**, to store these records and check them against the rule below. Frapp may not use them for anything else, and may not sell or share them.
>
> **Who sees a result, not my grades.** Each chapter I sign up with through Frapp sees only whether I am *Eligible*, *Pending* or *Not eligible*. Chapters never see my GPA, credits or student ID, or the reason for a result.
>
> **Why.** To decide whether I meet {Council}'s and {School}'s academic requirements to receive a bid and join a fraternity during {Season} recruitment ({rule summary, e.g. "a cumulative GPA of at least 2.50 and at least 12 credit hours"}).
>
> **How long.** From the date I sign until {Season end date}, unless I revoke it sooner. Frapp deletes my grades from its live systems {N} days after {Season} recruitment closes, and at once if I revoke. Encrypted backup copies are overwritten within {backup window} after that. My eligibility result is kept until {retention period} so chapters and {Council} can see bids were valid. A new season needs a new release.
>
> **Revoking.** I can revoke this consent at any time in Frapp ({path, e.g. "Grade release → Revoke"}) or by writing to {Council contact} or {FSL office contact}. Revoking stops any further release from the date I revoke. It does not undo a release already made. When I revoke in Frapp, Frapp deletes the grades it holds and my result goes back to *Pending*, which may stop chapters from extending me a bid.
>
> **I don't have to sign.** I can refuse. If I refuse, my result stays *Pending*, and {Council}'s rules decide whether I can still receive a bid. Refusing does not affect my enrollment or anything else at {School}.
>
> **Who has seen my grades.** Frapp records every time someone views my grades in Frapp, and I can see that record in Frapp.
>
> **Copy.** I can see and download a copy of this release in Frapp at any time.
>
> **Signature.** By typing my full name and selecting *Sign release*, I sign this consent electronically. Just before signing, I confirmed my {School} email address with a one-time code sent to it.
>
> {typed full name} · {date} · release version {version}

**Design notes for the drafter:**

- **Signature method.** A fresh one-time code to the school email **at the moment of signing**, plus the typed name, date and button, is this draft's 99.30(d) answer: the code authenticates the signer as the holder of the school address, and the typed name plus the button is the approval. It can't lean on the session: Frapp's sign-in offers a password, an emailed magic link, and Apple and Google (`apps/web/components/auth/sign-in-screen.tsx`), so a session may never have touched the school address. #4222's `authenticated_via = 'school_email_code'` must record this signing step, not the sign-in. Whether that is enough is lawyer question 4. When it proposed 99.30(d), the Department called FERPA "technology-neutral" and accepted the federal student-loan e-signature standards ([S2](#sources)). AACRAO's guidance is that a bare checkbox without authentication is not enough ([S9](#sources)). No Department statement on an email code plus a typed name was found.
- **Revocation.** FERPA's text has no revocation clause. Revocation is offered because CU Boulder and MSU do it and because it is the safe default ([S3](#sources), [S12](#sources)); no Department guidance on revoking a consent was found. "Revoking does not undo a release already made" is the standard prospective-only framing; whether Frapp must delete or may only stop using is lawyer question 5.
- **"Frapp may not sell or share"** is a commitment the Privacy Policy and the DPA must also make (§ 2, § 4). It must not be in the release unless it's true in both.
- **The school-held release.** Some schools collect their own release (Michigan does it at eligibility check). The import then carries `release_on_file` and the school's release stands in for this one (#4218 § The FERPA release). The school's text will not name Frapp, so relying on it is lawyer question 3.

### What is stored

As #4218 § The FERPA release lists it, with #4222's table to gain the missing columns: the version and hash of the text shown, the season, the records and recipients as structured fields, the typed name, how the signer authenticated, and the signed and revoked times. A revoked release is kept as the record of what was consented to; only the grades are deleted.

## 2. Redlines for `legal.md`, the FERPA notice, the Privacy Policy and the Terms

Proposed diffs, **not applied**. Removed lines are `-`, added lines are `+`. Text in `{braces}` depends on Paul's choices.

**What applying them would set off.** The Privacy Policy and Terms are accepted, so a material change moves their "Last updated" date and bumps `LEGAL_POLICY_VERSION`, and every member is asked to accept again; the FERPA notice is not accepted, so only its date and pin move. `scripts/ci/__tests__/legal-policy-version.test.mjs` enforces both ([`legal.md` § Acceptance record](../../spec/behavior/legal.md#acceptance-record)). These redlines are material. Shipping them before the feature exists would describe something Frapp doesn't do, so they ship **with** the feature, not before.

### 2.1 `spec/behavior/legal.md` § FERPA Notice

```diff
 ## FERPA Notice

-- A specific callout (frapp.live/ferpa) that Backwork materials are shared voluntarily by members.
-- Frapp is not an educational institution and does not access student education records.
+- A specific callout (frapp.live/ferpa) with two parts.
+- **Backwork.** Backwork materials are shared voluntarily by members.
+- **Recruitment eligibility.** Frapp is not an educational institution. Where a school's council
+  runs eligibility in Frapp, Frapp receives a limited set of education records (cumulative and
+  term GPA, credit hours, enrollment status, the student ID used to match them, and optionally
+  high-school GPA) **only**
+  under a release the student signs, or under the school's written agreement designating Frapp
+  a school official ({whichever counsel picks}). Frapp holds them as the council's service
+  provider, for eligibility only. The release text, its versioning, what chapters see (a verdict,
+  never a grade), retention and revocation are owned by
+  [`ifc-recruitment.md` § Eligibility](ifc-recruitment.md#eligibility) and
+  [`school-layer.md` § 3](../architecture/school-layer.md#3-eligibility-and-gpa).
 - Members are responsible for ensuring they have the right to share uploaded materials.
```

And under § Privacy Policy, replace the "Covers:" list's user-rights clause:

```diff
-... user rights (deletion on request — the shipped page grants no access or correction right, and does not mention cookies or the per-chapter analytics that `chapters.analytics_opt_out` gates).
+... user rights (deletion on request; for recruitment data only, access to one's own record and
+the grade-access log, revocation of a grade release and deletion of recruitment information, per
+[`ifc-recruitment.md` § The PNM's own view](ifc-recruitment.md#the-pnms-own-view) — for all other
+data the shipped page still grants no access or correction right, and does not mention cookies or
+the per-chapter analytics that `chapters.analytics_opt_out` gates).
```

The Privacy Policy bullet also needs "people without accounts": interest-form submitters, and students a school's roster import puts on a council's list before they've done anything (#4218 § How a PNM gets onto it, route 3), are covered by the policy without ever accepting it (§ 2.3).

### 2.2 FERPA notice (`apps/landing/app/ferpa/page.tsx`)

```diff
   {
     heading: "2. Frapp Is Not an Educational Institution",
     paragraphs: [
       "Frapp is a software provider, not a school or university. Frapp does not act as an educational institution under FERPA.",
-      "Chapters and members are responsible for ensuring they have rights to share materials uploaded to Frapp.",
+      "Chapters and members are responsible for ensuring they have rights to share materials uploaded to Frapp.",
+      "Frapp does not receive education records from any school except as described in section 3.",
     ],
   },
+  {
+    heading: "3. Recruitment Eligibility",
+    paragraphs: [
+      "Some councils, such as a school's Interfraternity Council, use Frapp to check whether students meet academic requirements for recruitment. When they do, Frapp receives a limited set of education records: cumulative and term GPA, credit hours, enrollment status, the student ID used to match them, and, where the council uses it, high-school GPA.",
+      "Frapp receives these records only after the student signs a FERPA release that names the council, the school's fraternity and sorority life office, and Frapp as the council's service provider{, or under the school's written agreement with Frapp}. Frapp uses them only to check eligibility for that council, and never sells or shares them.",
+      "Chapters see only whether a student is Eligible, Pending or Not eligible, never a grade. Only the council officers named to check eligibility{, and the school's office once it has its own access,} can see grades. Every view in Frapp is logged, and the student can see that log.",
+      "Frapp deletes grades {N} days after recruitment closes, and at once if the student revokes the release in Frapp. Encrypted backup copies are overwritten within {backup window} after that.",
+      "To inspect or correct your education records, contact your school: FERPA gives that right against the school. To see, revoke or delete what Frapp holds, use Grade release in Frapp, or email team@frapp.live.",
+    ],
+  },
   {
-    heading: "3. Backwork and Uploaded Content",
+    heading: "4. Backwork and Uploaded Content",
```

…renumbering the later sections. `lastUpdated` moves.

### 2.3 Privacy Policy (`apps/landing/app/privacy/page.tsx`)

```diff
   {
     heading: "1. Information We Collect",
     paragraphs: [
       "Frapp collects account and profile information such as name, email, role metadata, and chapter membership details.",
+      "Recruitment. If you fill out a chapter's interest form or register for recruitment, Frapp collects what you enter: your name, school email, class year, an optional phone number, and your answers to the chapter's questions. You don't need a Frapp account for this, and this policy applies to you from the moment you submit.",
+      "If your school or council uploads a list of students for recruitment, such as the incoming class, Frapp holds your name, school email and student ID from it. You're shown to no chapter until you verify your email and choose to take part, and the list is deleted on the schedule in section 4.",
+      "Grades, only with your release. If your school's council checks recruitment eligibility in Frapp and you sign a grade release, Frapp receives your cumulative and term GPA, credit hours, enrollment status and student ID{, and high-school GPA if your council uses it,} from your school or council. Frapp never asks you for grades on a form{, and does not accept self-reported grades}.",
       "Depending on feature usage, ...",
```

```diff
   {
     heading: "2. How We Use Information",
     paragraphs: [
       "We use data to operate chapter workflows, authenticate users, deliver notifications, and maintain platform security.",
+      "We use recruitment information to put you on the chapters' and your council's recruitment lists you signed up for, and grades only to decide whether you meet your council's academic rule. Chapters see whether you are eligible, never your grades. A chapter does not see that you signed up with another chapter.",
-      "We do not sell chapter or member personal information to third-party advertisers.",
+      "We do not sell personal information, or share it for cross-context behavioral advertising, and we never use grades or recruitment information for advertising, profiling or any purpose other than the one you gave it for.",
     ],
   },
```

The existing sentence says "to third-party advertisers", which is narrower than CCPA's "sell or share". The new one spells out CCPA's sense of "share" (cross-context behavioral advertising), because a bare "we don't share" would contradict the same page, which shares recruitment details with councils and chapters by design. The release's "may not sell or share" needs the same wording.

```diff
   {
     heading: "3. Service Providers",
     paragraphs: [
       "Frapp uses trusted infrastructure providers such as ...",
+      "Grades are processed by Frapp's API on Render and stored, encrypted before they are stored, in Supabase{ and in Frapp's offsite backups with Cloudflare}. They are never sent to Sentry, PostHog, Resend, Expo or any other provider.",
```

```diff
   {
     heading: "4. Data Retention",
     paragraphs: [
       ...
+      "Recruitment information for someone who doesn't join a chapter is deleted {180} days after the recruitment season closes. Grades are deleted {N} days after the season closes, or at once if you revoke your release. Encrypted backups keep deleted data for up to {backup window} more before they are overwritten.",
     ],
   },
```

```diff
+  {
+    heading: "5. Your Choices and Rights",
+    paragraphs: [
+      "In Frapp you can see the recruitment information you gave, see who has viewed your grades, withdraw from one chapter or from recruitment, revoke your grade release, and delete all of your recruitment information. You can also email team@frapp.live.",
+      "Your right to inspect and correct your education records under FERPA is against your school, and your school's office handles it. If your school corrects a grade, it reaches Frapp with the council's next import.",
+      "{If counsel says state law applies:} Depending on where you live, you may have further rights to know, correct or delete your information, and to appeal a decision. To use them, email team@frapp.live.",
+    ],
+  },
```

```diff
   {
-    heading: "5. Security and Controls",
+    heading: "6. Security and Controls",
     paragraphs: [
       "Frapp uses role-based access controls, tenant isolation patterns, and secure transport to protect chapter data.",
+      "Grades get additional protection: they are encrypted with keys kept outside the database, only officers the council specifically names can view them, and every view in Frapp is logged.",
```

Section 6 (Contact) renumbers. One existing gap this narrows, already recorded in `legal.md` § Privacy Policy: the page grants no access or correction right. Section 5 above grants one for recruitment data only, so `legal.md` keeps recording the gap for everything else (§ 2.1); whether to extend it to all data is Paul's.

### 2.4 Terms (`apps/landing/app/terms/page.tsx`)

Only if Paul picks § 3's option B or C for minors. Under option B:

```diff
   {
     heading: "2. Eligibility",
     paragraphs: [
-      "You must be at least 18 years old to use Frapp. By accepting these terms, you confirm that you are.",
+      "You must be at least 18 years old to use Frapp, except as a recruitment participant: a student enrolled at a college or university who is at least {17} may fill out interest forms, register for recruitment, sign a grade release and use the recruitment view in Frapp, under the Recruitment Participant Terms. By accepting these terms, you confirm that you are 18, or that you are a recruitment participant who is at least {17}.",
-      "We may close an account that we learn belongs to someone under 18.",
+      "We may close an account that we learn belongs to someone under {17}, or to a recruitment participant under 18 who uses Frapp beyond recruitment.",
     ],
   },
```

**The 18 is stated in more places than the Terms.** Option B also needs, in the same change: a participant version of `LEGAL_ACCEPTANCE_LABEL` (`packages/validation/src/index.ts`, "I'm 18 or older and agree…", shown on every acceptance surface), so a 17-year-old never ticks a false box; `legal.md` § Terms of Service's eligibility bullet ("18 is the one authoritative age"); the checkbox rows in `spec/ui/design-system/writing.md`; the API contract's descriptions that quote the label; and the audience notes in `apps/mobile/store/README.md`.

## 3. PNMs under 18

### The facts

- **The Terms say 18+** (owner decision 2026-09-23, #2261), and every membership-creating route requires acceptance ([`legal.md`](../../spec/behavior/legal.md) § Terms of Service). The interest-form draft's required box is "I agree, and I'm 18 or older" (#4218 § Consent and privacy text). So today a 17-year-old first-year is turned away at the form.
- **Some first-year PNMs are 17.** Students who start college at 17 are a small minority, but fall recruitment of first-years is where they cluster.
- **FERPA treats them as adults for their records.** A college student is an "eligible student" at any age, so the 17-year-old signs the grade release, not a parent ([S1](#sources)). Parental consent would not make the release valid, and is not needed for it.
- **COPPA doesn't reach them.** It applies to children under 13 ([S10](#sources)). A college PNM under 13 is not a realistic case; the age question only needs to keep out anyone under {17}.
- **Contract capacity.** In most states a minor can disaffirm a contract until reaching majority: 18 in most states, 19 in Alabama and Nebraska, 21 in Mississippi ([S11](#sources)). A 17-year-old's acceptance of the Terms may be voidable by them. That is mainly a risk to Frapp's terms, not a bar to serving them.
- **State minors' privacy laws** are the moving part ([S13](#sources), all unverified and some unsettled: Connecticut (2023, effective Oct 2024) and Colorado (SB 24-041) add duties toward known minors under 18 inside their comprehensive privacy acts, which apply only above thresholds (about 100,000 consumers) a small startup is likely under; Maryland's Kids Code (effective Oct 2024) covers services "reasonably likely to be accessed" by under-18s, above size thresholds, and its challenge is proceeding; California's Age-Appropriate Design Code is partly enjoined after a March 2026 Ninth Circuit ruling; Utah, Texas (SCOPE Act, partly enjoined) and Florida (HB 3) target social-media services, and whether a chapter chat app falls inside their definitions is unsettled. California requires opt-in before selling or sharing an under-16's data, which Frapp doesn't do). The common thread is heightened duties for users the service **knows** are under 18: no targeted ads, no sale, data minimization, high-privacy defaults. Frapp already sells nothing and runs no ads, so most of these cost little if the service asks age honestly and sets minors' defaults high.
- **Councils may bar them anyway.** Some IFCs and national fraternities don't recruit under-18 students; whether to recruit them is the council's rule, not Frapp's (#4218 § Decisions for Paul, item 4). (Unverified: no IFC rule on age was checked.) Michigan's practice of signing the release at eligibility verification, before recruitment, means its form reaches first-years of any age ([S4](#sources)).

### Options

| | A. Age gate on `/f/` forms | **B. PNM-only limited participation (recommended)** | C. Parental consent |
|---|---|---|---|
| **What a 17-year-old can do** | Nothing in Frapp. The form says "You must be 18 to sign up through Frapp. Contact {Chapter} directly." | Fill out forms, register, sign the grade release, use the PNM view (interests, verdict, bids, Accept/Decline). Not join chapter chat or become a member until 18 (or until Paul changes the Terms) | Everything an adult can, once a parent consents |
| **Terms change** | None | A short set of Recruitment Participant Terms, the § 2.4 redline, and the other 18+ statements § 2.4 lists | A Terms change and a consent flow |
| **Build** | The existing checkbox, plus a clear refusal | A date-of-birth or "are you 18?" step on the form; a `minor` flag on the PNM; the PNM view already has no chat. Membership creation keeps refusing under 18 | Parent identification, a consent record, revocation by the parent, and what happens at 18 |
| **What it costs** | The council's list is incomplete, and a 17-year-old who ticks the box anyway is now a minor Frapp doesn't know about. Councils keep a spreadsheet beside Frapp for them | A second, narrower set of terms to keep correct. A 17-year-old who gets a bid can accept it in Frapp but joins the chapter in Frapp only at 18 | Real friction for college students. Parents have no FERPA role, so it buys nothing for the release. Verifying a parent is its own hard problem |
| **Privacy posture** | Frapp holds no known minors | Frapp knows who is a minor and applies stricter defaults: phone not shared with the council, no 180-day carry-over (deleted at season close), no marketing email, grades purged at the shortest setting | Same as B, plus parental records |

**Recommendation: B.** It matches what a recruitment participant actually does in Frapp (a form, a verdict, a bid), keeps the 18+ rule for everything social, and turns an unknown minor (option A's failure mode) into a known one with protective defaults. It needs counsel to draft the participant terms and confirm the state-law notes (lawyer question 12). **If counsel can't clear B before the season, ship A for the season** and say so on the form: it's the current Terms, unchanged. C is not recommended: it adds a parent where FERPA has none, for a population that is mostly adults within months.

What B asks for on the form: a date of birth is the honest gate, but it's more data. "Are you 18 or older?" Yes / No, followed by "Are you enrolled at {School}?" for a No, collects less. The draft prefers the yes/no, with the minor flag cleared at the next season or on request.

## 4. School-facing DPA outline and HECVAT readiness

### 4.1 Which agreement, with whom

There are two lawful paths, and they decide who Frapp's customer is for grade data (school-layer § 6; lawyer question 1):

- **Consent path (99.30).** The student's release names Frapp. The school releases to the council and Frapp; no contract between Frapp and the school is strictly needed, but schools may still ask for one before sending grades.
- **School-official path (99.31(a)(1)(i)(B)).** The school designates Frapp a school official through a contract. Three conditions apply: Frapp performs an institutional service the school would otherwise use its own employees for; Frapp is under the school's **direct control** for use and maintenance of the records; and Frapp follows the 99.33(a) limits on use and redisclosure. The school's annual FERPA notice must also have criteria that cover a contractor of this kind ([S1](#sources), [S5](#sources)).

**Only the school can designate a school official.** An IFC is usually a student organization, so Frapp can't be the IFC's school official; under this path the agreement is with the school, and AACRAO's guidance is that "direct control" should be spelled out in that contract ([S5](#sources)). That's the drafter's inference, not a sourced rule (lawyer question 2). The outline below is written for the school-official path, since it's the stricter one. Under the consent path, most of it still applies as a security and use commitment, without the "direct control" clauses.

### 4.2 DPA outline

1. **Parties and roles.** {School}, acting through its {FSL office}, and Frapp. The council is a user of the service, not a party (or a party, if counsel says the IFC is a school body; lawyer question 2).
2. **Designation.** {School} designates Frapp a school official with a legitimate educational interest, for the service in clause 4, under the criteria in {School}'s annual FERPA notice. {School} confirms its notice covers contractors.
3. **Direct control.** Frapp uses and maintains the records only as {School} directs in this agreement. {School} decides which officers may see grades (or approves the council's choice), the rule applied, the retention period and when records are deleted. Frapp's configuration for {School} (eligibility officers, retention, rule) is visible to {School} on request. **Not yet buildable:** in #4222 only the council admin grants eligibility officers (§ 4.2 rule 2), with no school approval step and no school tenant (Q8). Frapp can't sign this clause until one exists (§ 5).
4. **Purpose limitation.** Determining recruitment and membership eligibility for {Council} under {School}'s rules. No other use: not for analytics, product improvement, model training, advertising, profiling or sale. Aggregate, de-identified counts only for {School}'s own reports.
5. **Data elements (Schedule A).** Student ID, cumulative GPA, term GPA, credit hours, enrollment status, the `as_of` date; {optional: high-school GPA}. Not conduct records unless both sides add them.
6. **Redisclosure.** Grades go only to the council officers {School} approves and to {School}. Chapters receive a verdict only, and only where {the student's release names them / School directs}. No other disclosure without {School}'s written consent, except as law requires, with notice to {School} where lawful.
7. **Subprocessors (Schedule B).** The providers that touch grade data: Supabase (database and its daily backups, `us-east-2`), Render (API runtime), Infisical (encryption keys), and, for the nightly offsite backup, GitHub Actions (runs the dump) and Cloudflare R2 (stores it). Today's offsite dump skips a `restricted` schema (§ 5), so whether R2 holds grade ciphertext depends on that fix; it holds the PNM records and verdicts in `public` either way. Schedule B links the Privacy Policy's provider list rather than copying it, because a copy drifted before (#2305). Providers that never receive grade data, listed for completeness: Vercel, Sentry, PostHog, Resend, Expo, Stripe. Frapp gives {30} days' notice of a new subprocessor for grade data, and {School} may object and terminate. Each subprocessor is under written terms at least as protective.
8. **Security (Schedule C).** The controls in § 5 of this file, stated as commitments: encryption in transit and at rest, application-layer encryption of grades with keys outside the database, least privilege, access logging, MFA for staff with production access, US data residency {once the Render, Vercel and R2 regions are confirmed: only Supabase's is recorded}, no grade data in non-production environments {which needs the separate production backup bucket: today a staging token reaches production dumps}.
9. **Breach notification.** Frapp notifies {School} without undue delay and no later than **{72} hours** after confirming a breach affecting {School}'s records, with what is known: what records, whose, when, how, and what's being done; updates as facts are found. Frapp cooperates with {School}'s notices to students and pays {reasonable costs of notification} where the breach was Frapp's fault. (University vendor terms range from "immediately" to 72 hours, with 48–72 most common, and differ on when the clock starts ([S8](#sources)). State breach laws run 30–60 days ([S15](#sources)), and a GPA with a name probably triggers none of them, but contracts define "incident" more broadly. Lawyer question 9.)
10. **Student requests.** Requests to inspect or amend education records go to {School}; Frapp forwards any it receives within {5} business days. Revocations and deletion requests made in Frapp are honored at once and reported to {School} {in the access log / monthly}.
11. **Retention and deletion.** Grades are deleted {N} days (at most {30}) after recruitment closes, on revocation, or within {30} days of {School}'s written request or of termination. Encrypted backups age out within {backup window} after deletion and are not restored except for disaster recovery (if restored, deletions are re-applied). Frapp certifies deletion in writing on request.
12. **Audit and assessment.** Frapp answers {School}'s security questionnaire (HECVAT) once a year and on material change, gives {School} its access log for {School}'s records on request, and allows {School} or its auditor a reasonable assessment once a year on {30} days' notice.
13. **Recordkeeping.** Frapp keeps an append-only record of each access to grades (who, when, what action) and gives it to {School} on request. Under 99.32(d) a disclosure made with the student's written consent needs no entry in the school's record, so this is a commitment beyond the regulation, not a substitute for it ([S1](#sources)).
14. **Insurance and liability.** {Cyber liability coverage of $X}; indemnity for Frapp's breach of this agreement. (Frapp has no cyber policy recorded anywhere in the repo: see the HECVAT table.)
15. **Term and termination.** Ends with the service or on {School}'s notice; clause 11's deletion runs on termination; the five-year bar on a recipient that improperly rediscloses (99.67(e), formerly 99.33(e)) is acknowledged ([S17](#sources)).
16. **Governing law, order of precedence, contacts.** This agreement wins over Frapp's Terms and Privacy Policy for {School}'s records. A named security contact on each side.

### 4.3 HECVAT readiness

The HECVAT is EDUCAUSE's standard security questionnaire for vendors to higher education (HECVAT 4, released early 2025, merges the old Full, Lite and On-Prem versions into one workbook with a "Start Here" scoping tab and tabs for Organization, Product, Infrastructure, IT Accessibility, Case-Specific, AI and Privacy, about 320 questions; the current point release is 4.1.5 or 4.1.6, unresolved; EDUCAUSE asks vendors to update it yearly, [S6](#sources)). A school's IT security office will likely ask for it before grades are sent. Below is what it asks about, grouped by the older (3.x) areas because they map onto Frapp's docs more directly, with **today's honest status**, read from the repo on 2026-11-11.

Status key: **Yes** (exists, with evidence), **Partial**, **No**, **Designed** (in a proposed doc, not built), **Unknown** (not recorded in the repo; Paul knows).

| Area | What it asks | Status | Evidence or gap |
|---|---|---|---|
| Company | Legal entity, ownership, headcount, years in business, references, cyber insurance | Unknown | Not in the repo |
| Documentation | Written information-security policy; SOC 2 Type II or ISO 27001 report; third-party pen test | **No** | No policy document, no audit report, no pen test found in `docs/` or `spec/` |
| Privacy | Privacy policy covering the data; FERPA handling; no sale | Partial | Privacy Policy exists but doesn't cover education records or people without accounts (§ 2); FERPA notice says Frapp doesn't access them |
| Data location | Where data is stored and processed | Partial | Supabase `frapp-prod` `us-east-2` ([`db-rollback-playbook.md` § Backup reality](../ops/db-rollback-playbook.md#backup-reality)). Render's region isn't recorded (`render.yaml` sets none), nor Vercel's, nor the R2 backup bucket's (`auto`). Unknown until Paul checks |
| Encryption in transit | TLS everywhere | Partial | Every provider endpoint is HTTPS; nothing documents or tests it |
| Encryption at rest | Disk; field-level for sensitive data | Partial / Designed | Supabase disk encryption (provider default); field-level for grades is school-layer § 3.2, not built |
| Key management | Where keys live, rotation, who has access | Designed | Keyring with `key_id` in Infisical at its own path (school-layer § 3.2); the sync split is unverified, and no KMS/HSM |
| Authentication | SSO/SAML, MFA for users and admins, password policy | **No** for MFA and SSO | Users sign in with a password, an emailed magic link, or Apple or Google (`apps/web/components/auth/sign-in-screen.tsx`); no SAML or campus SSO; no MFA anywhere in the API. Provider dashboards' MFA is Unknown |
| Authorization | Role-based access, least privilege, tenant isolation | Yes | [`authorization-model.md`](../security/authorization-model.md), RLS, `cross-tenant-isolation.e2e-spec.ts`; explicit-grant keys for grades are Designed (school-layer § 5.1) |
| Logging and monitoring | Security event logs, retention, review, alerting | Partial | Sentry, Render logs, [`alert-routing.md`](../ops/alert-routing.md); grade access log Designed (school-layer § 3.4); log retention periods not stated; no SIEM |
| Application security | SDLC, code review, SAST/DAST, dependency scanning, secret scanning | Partial | PR-only `main` with required CI checks; **no required approving review** (`scripts/configure-branch-protection.mjs` sets `required_pull_request_reviews: null` on purpose: the human gate is the production deploy approval), though Paul merges every PR; Dependabot weekly and the blocking `check:npm-audit` gate; gitleaks ([`secret-scanning.md`](../ci-cd/secret-scanning.md)). No SAST (CodeQL or similar) or DAST found |
| Vulnerability management | Patch cadence, scanning, remediation SLAs | Partial | Dependabot and the audit gate; no stated remediation SLA |
| Pen testing | Annual third-party test, summary available | **No** | None found |
| Incident response | Written plan, breach notification procedure, contacts, tested | Partial | [`incident-response.md`](../ops/incident-response.md) covers outages, not data breaches; no breach-notification procedure or window |
| Backup and DR | Frequency, retention, encryption, tested restores, RTO/RPO | Partial | Supabase daily backups (7 days) and a nightly offsite dump (30 days); PITR off; the restore has not been rehearsed (#1861); offsite bucket shares a token with staging, an accepted temporary weakness (`.github/workflows/db-backup.yml`); the offsite dump covers only the `public`, `auth` and `supabase_migrations` schemas (`scripts/db-backup.sh`); no stated RTO/RPO |
| Business continuity | Plan for the company and staff | **No** | Not documented |
| Change management | Reviewed changes, separation of environments | Partial | PR-only `main`, staging on merge, production by dispatched SHA with an approval ([AGENTS.md § Branch model](../../AGENTS.md#branch-model)); review is practice, not enforced (above) |
| Third parties | Subprocessor list, their assurances, contracts | Partial | Listed in the Privacy Policy § 3, which leaves out GitHub Actions and Cloudflare R2 (backups); their SOC 2 reports exist on the providers' side; Frapp's DPAs with them Unknown |
| Data deletion | On request and at contract end, including backups | Partial | Account deletion is built ([`data-retention.md`](../../spec/behavior/data-retention.md)); grade purge Designed; backups age out (7 / 30 days) but there's no certificate-of-deletion process |
| Non-production data | No real data in dev/test | Partial | Local and sandbox stacks use seeds; staging's data policy for grades isn't written (§ 5) |
| Personnel | Background checks, security training, confidentiality agreements, offboarding | Unknown | Not in the repo |
| Accessibility | VPAT/ACR, WCAG conformance | Partial | Contrast gates in the design system ([`foundations.md`](../../spec/ui/design-system/foundations.md)); no VPAT, no conformance claim |
| Analytics and tracking | What's collected, PII in analytics | Yes | HMAC-pseudonymized analytics and PII redaction ([`observability.md`](../../spec/behavior/observability.md)) |

**What to do before a school asks**, in rough order of what blocks a "yes": a written security policy and incident-response (breach) plan; MFA for every human with production access and for eligibility officers (§ 5); the grade controls in § 5 built and tested; a restore rehearsal (#1861) and stated RTO/RPO; a separate production backup bucket; a pen test; cyber insurance. SOC 2 is a longer road; many schools accept a HECVAT plus a pen-test summary from a small vendor (unverified; a common expectation, not a rule).

## 5. Security controls for GPA

Each control, where the data-model design (school-layer, [#4222](https://github.com/pdcarlson/Frapp/pull/4222)) covers it, and what's missing. "Gap" means nothing in the proposed designs covers it yet.

| Control | What it requires | Where school-layer covers it | Gap |
|---|---|---|---|
| **Column (application-layer) encryption** | Grade values encrypted before they reach the database, so a dump, backup, leaked service-role key or support login sees ciphertext | § 3.2 layer 3: AES-256-GCM in the API, `ciphertext` + `key_id`, never filtered in SQL | None in design. Build must prove plaintext never appears in a query log, error or Sentry breadcrumb |
| **Key management** | Keys outside the database, least access, rotation | § 3.2: `ACADEMIC_RECORDS_ENCRYPTION_KEYS` keyring, `ACADEMIC_RECORDS_HMAC_KEY`, own Infisical path `/academic-records`, one sync to the API's Render service | **Unverified** that the existing `/` syncs don't pull recursively. No rotation schedule. Every human with Infisical `prod` access can read the key; no KMS/HSM or envelope encryption. Who holds Infisical `prod` access isn't listed |
| **Student ID matching** | Match imports without decrypting | § 3.2: HMAC `student_id_hash` | HMAC key rotation means re-hashing; fine. None |
| **No client path** | Grade tables unreachable from PostgREST, Realtime, `anon`, `authenticated` | § 3.2 layer 1: `restricted` schema, no grants, RLS on with no policies | None |
| **Single code path** | Only one service and repository touch grades | § 3.2 layer 4: `AcademicRecordsService`, dependency-cruiser rule | None |
| **Security-definer functions recheck scope** | A caller bug can't widen a read | § 3.2 layer 2; § 6 Security risks | None in design; it's the new attack surface § 6 names |
| **Least privilege (in the app)** | Only named eligibility officers see grades; admins and `*` don't | § 3.3 table; § 5.1 explicit-grant `council:eligibility_view` / `_manage`; § 4.3 test 3 | **Conflict.** #4218 gives GPA to `council:eligibility_manage` with no explicit-grant rule, so built from #4218 a council `*` reads it. Settle on #4222's model. And the DPA's school approval of officers (§ 4.2 clause 3) has no design |
| **Least privilege (Frapp staff)** | Operators reaching production can't browse grades unlogged | Not covered | **Gap.** The service role, the Supabase dashboard SQL editor and a `psql` session bypass the access log (the trigger logs nothing on a direct `select`). Ciphertext limits the harm only if the operator lacks the key. Needs: who may hold both; a break-glass rule; and a statement in the DPA |
| **MFA** | Strong authentication for anyone who can see grades | Not covered | **Gap.** Frapp has no MFA (§ 4.3). An eligibility officer signs in with a password, a magic link or Apple/Google. Proposed: require a fresh school-email code (the mechanism the interest form introduces) or TOTP before showing grades, and MFA on Supabase, Render, Infisical and GitHub for staff |
| **Access logging** | Every read, import, override, purge and grant logged, append-only, tamper-resistant | § 3.4: `restricted.academic_record_access_log`, append-only trigger, written in the same transaction as the read; § 4.3 test 9 | Log retention unstated (rows "outlive the record"; forever?). No alerting on unusual reads (e.g. one officer viewing hundreds of records). The log can't see a direct database read (above), so public copy says "every view **in Frapp**". Not in the offsite dump (below) |
| **PNM can see the log** | Transparency, and the release promises it | #4218 § Care rules and § The PNM's own view only | **Gap.** #4222 § 3.4 gives the log to the council admin and the school office; no function reads it for the PNM. Needs a read path, and a decision on whether the PNM sees officers' names or only roles |
| **Never in logs, telemetry or messages** | No grade in API logs, Sentry, PostHog, chat, push, email | #4218 § Care rules for grade data | **Gap in tests.** § 4.3 test 10 covers chapter responses only. Needs a test that the import and read paths' errors carry no value, and a Sentry `beforeSend` rule for the eligibility routes |
| **Export** | No bulk extraction | § 3.4: GPA export denied and logged | **Conflict.** #4218 § Care rules allows "the eligibility officer's own" export. Settle on #4222's denial; an officer export is the redisclosure lawyer question 8 is about |
| **Data minimization at import** | Store only rows with a matching PNM and a live release | #4218 § Getting the data in, step 3 | The uploaded CSV itself: where it sits while being parsed, and that it's never written to Storage or logs, isn't stated. **Gap** |
| **Retention** | Purge `{N}` days after recruitment closes (at most `{30}`), on revocation, on account deletion, on DPA termination | § 3.5 table (term close + 30, **cap 90**); § 4.3 purge test | **Conflict** on the cap (see the table at the top). **Backups:** purged ciphertext stays in Supabase's daily backups for 7 days, and in the offsite dump for `BACKUP_RETENTION_DAYS` (default 30) if the dump is extended to `restricted` (next row). The release, policy and DPA say `{backup window}` for this. Restores must re-apply purges (not designed). Access log retention unstated |
| **Offsite backup coverage** | Releases and the access log survive a disaster restore | Not covered | **Gap.** `scripts/db-backup.sh` dumps data only for `public`, `auth` and `supabase_migrations`. A restore from the offsite dump (project lost, or damage older than 7 days) would lose `restricted.ferpa_releases` and the access log, while `public.pnm_eligibility` verdicts survive pointing at releases that no longer exist. Either add `restricted` to the dump (then R2 is a grade-data subprocessor) or define what a restore does to verdicts |
| **Revocation** | Immediate delete, verdict to Pending | § 3.5; § 4.3 test 12 | None in design; lawyer question 5 may relax it |
| **Non-production environments** | No real grades in staging, local or previews | Not covered | **Gap.** State that grade import is disabled on staging or accepts only synthetic data; staging shares the backup bucket today |
| **Verdict as disclosure** | Chapters see a verdict only where the release names them | § 3.3; § 4.3 test 11 | None |
| **Wrong-person risk** | A bad merge or mismatched ID never shows one student's data as another's | § 6 (merge refusal); #4218 matching rule (drop rows whose ID and email disagree) | None |
| **Council verification** | No grade import until the council is verified | § 5.3 step 4; § 4.3 test 8 | Who verifies is ⚑ Q4 |
| **Breach detection and response** | Know when grades leak and tell the school in time | Not covered | **Gap.** No breach procedure exists (§ 4.3); the DPA window (§ 4.2 clause 9) has nothing behind it yet |
| **Key compromise response** | Rotate and re-encrypt | § 3.2 keyring supports rotation | Re-encryption job and runbook not designed |

## 6. Questions for a lawyer

Consolidated from #4192, #4218 (decisions 1–4, 7, 9) and #4222 (§ 8's seven questions), plus the ones this draft raised. Numbered for reference; the first six gate any real grade import. "#4222 lawyer question N" means the numbered lawyer list at the end of school-layer § 8, not Paul's Q1–Q9 above it.

**Which legal path**
1. **School official, agent or named recipient?** Is Frapp a school official under a DPA (99.31(a)(1)(i)(B)), the council's agent, or a party named in the student's 99.30 consent? Which party does Frapp contract with for grade data: the school, the council, or both? (#4222 lawyer question 1)
2. **IFC status.** Is an IFC a student organization or part of the school for FERPA purposes? If it's a student organization, can it receive education records at all except by the student's consent, and can it designate a service provider? (#4222 lawyer question 2)
3. **School-held releases.** May Frapp rely on a school's attestation that a release is on file when the school's form doesn't name Frapp? (#4218)
4. **E-signature.** Is a session authenticated by a one-time code to the school email, plus a typed name, date and button, enough under 99.30(d)? Does ESIGN/UETA add anything? (#4218)

**Consent and disclosure**
5. **Revocation.** After revocation, must Frapp delete stored grades, or only stop using them? Does revocation reach the verdict already shown to chapters, and backups? (#4222 lawyer question 4)
6. **The verdict.** Is "Eligible / Not eligible" itself personally identifiable information from an education record, so that chapters need to be named in the release (the design assumes yes)?
7. **Recordkeeping.** 99.32 puts the record of disclosures on the school, and 99.32(d) appears to exempt disclosures made with written consent. Under the school-official path, what must Frapp's access log give the school?
8. **Redisclosure risk.** If a council officer exports or screenshots grades, who bears the 99.67 consequence, and what should the DPA and the officer terms say?

**State and consumer law**
9. **Breach notice.** What window should the DPA commit to, and which states' laws apply (the school's state, the student's, Frapp's)? Does a GPA with a name and student ID trigger any state's breach law? (#4222 lawyer question 5)
10. **CCPA/CPRA and other state privacy laws.** CCPA covers a business with over $26.625M revenue, 100,000+ consumers, or half its revenue from selling or sharing data ([S14](#sources)); a small startup likely meets none. Does Frapp meet any threshold now or soon? Does the FERPA carve-out in CCPA's "education information" category help Frapp, given the data comes via the student's consent? Do any other state comprehensive privacy laws reach a vendor this size? (#4222 lawyer question 3)
11. **Self-reported GPA.** May a council accept it where the school won't send grades, and what notice and accuracy disclaimers does it need? Is it an education record (the design says no)? (#4222 lawyer question 6; Paul's Q6)

**Retention, minors and copy**
12. **Minors.** Can a 17-year-old accept Recruitment Participant Terms, and are they enforceable? Do any state minors' privacy laws apply to a known 17-year-old college user, and what defaults do they require? Is parental consent ever needed? (#4218 decision 4; § 3)
13. **Conduct standing.** Should the release cover a yes/no conduct status at all? Is a disciplinary record treated differently?
14. **Retention periods.** Are grades at recruitment close + up to 30 days (or #4222's council cap of 90), non-joining PNMs at season close + 180 days, chapter notes at 30 days, and an access log kept indefinitely defensible? (#4222 lawyer question 7; #4218 decision 7, which says grades go at season close)
15. **Backups.** Is it acceptable that purged ciphertext persists in backups for 7 to 30 days, if stated in the release?
16. **People without accounts.** Is the Privacy Policy binding on, and adequate notice to, an interest-form submitter who never accepts it? Is the form's consent text (#4218 § Consent and privacy text) enough?
17. **Council officers and PNM contact data.** Does an officer with every PNM's phone number, who is also a member of a competing chapter, need terms of their own (a neutrality and confidentiality pledge)? (#4218 decision 9)
18. **The policy text.** Do the redlines in § 2 make true and sufficient statements, and does option A (verdict only) still need them?
19. **Liability.** What indemnity, liability cap and insurance should Frapp offer a school, and what should it ask of a council?

## Sources

Searched 2026-11-11.

**Every web source below is unverified.** The research agent couldn't fetch any page: `ecfr.gov` and `law.cornell.edu` are outside this sandbox's network allowlist, and it stopped after those. Each claim is from a search excerpt or from the agent's knowledge of the text matched against partial excerpts. Before Paul or counsel relies on one, someone should open the page.

| # | Source | Used for |
|---|---|---|
| S1 | 34 CFR Part 99: [§ 99.3](https://studentprivacy.ed.gov/content/eligible-student), [§ 99.30](https://www.ecfr.gov/current/title-34/subtitle-A/part-99/subpart-D/section-99.30), [§ 99.31](https://www.ecfr.gov/current/title-34/subtitle-A/part-99/subpart-D/section-99.31), [§ 99.32](https://studentprivacy.ed.gov/faq/must-educational-agencies-and-institutions-record-any-disclosure-personally-identifiable), [§ 99.33](https://www.ecfr.gov/current/title-34/subtitle-A/part-99/subpart-D/section-99.33) | Consent elements, electronic signature, eligible student, school-official conditions, recordkeeping, redisclosure |
| S2 | 2004 final rule, [69 FR 21670](https://edocket.access.gpo.gov/2004/04-9054.htm); 2003 proposed rule, [68 FR (July 28, 2003)](https://www.govinfo.gov/content/pkg/FR-2003-07-28/pdf/03-19082.pdf) | 99.30(d) added; ED called FERPA "technology-neutral" and accepted the federal student-loan e-signature standards |
| S3 | CU Boulder: [Registrar, Greek life members](https://www.colorado.edu/registrar/greeklife/members); [grade release process](https://www.colorado.edu/greeks/grade-release-process) | Release model, revocation |
| S4 | University of Michigan FSL: [retention](https://fsl.umich.edu/retention); [academic release](https://fsl.umich.edu/node/429) | Release model |
| S5 | SPPO, [Who is a school official](https://studentprivacy.ed.gov/faq/who-school-official-under-ferpa); AACRAO, [outsourcing and third-party contractors](https://www.aacrao.org/news/ask-the-ferpa-professor-the-ferpa-professor-answers-questions-regarding-outsourcing-and-third-party-contractors/) | School-official path; "direct control" belongs in the contract |
| S6 | EDUCAUSE, [HECVAT FAQ](https://www.educause.edu/higher-education-community-vendor-assessment-toolkit/hecvat-faqs-for-higher-education); [HECVAT 4](https://er.educause.edu/articles/2025/2/hecvat-4-better-than-ever) | Version and structure |
| S7 | [#4192, ChapterBuilder research comment](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6804236717) | A consent naming vendors (itself unverified) |
| S8 | University vendor terms: [Kentucky](https://purchasing.uky.edu/sites/default/files/2023-02/uk-2316-23attachB.pdf) and [Yale](https://cybersecurity.yale.edu/mss/14/1/1) (72 h), [Michigan Tech](https://mtu.edu/it/policies-compliance/saas-tcs-mtu-updated-011025.pdf) (48 h), [Grand Valley State](https://www.gvsu.edu/purchasing/bid/documents/B48C0C78-0ED6-6075-CADC425B8766D7FD/Appendix_2_Third_Party_Vendor_Security-Confidentiality_of_Customer_Data_-Final_220-01_-_2019.pdf) (24 h); UVA and Virginia Tech say "immediately" | Breach window range |
| S9 | AACRAO, [Is a check box an acceptable electronic signature?](https://www.aacrao.org/news/ask-the-ferpa-professor-is-a-check-box-on-an-online-form-an-acceptable-electronic-signature-for-ferpa-release/) | A bare checkbox without authentication isn't enough |
| S10 | [16 CFR 312.2](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312/section-312.2) | COPPA's child is under 13 |
| S11 | Cornell LII, [age of majority](https://www.law.cornell.edu/wex/age_of_majority); [minor](https://www.law.cornell.edu/wex/minor) | Majority ages; voidable contracts |
| S12 | MSU FSL, [Verified Aspirants Grade Release Form 26-27](https://fsl.msu.edu/resources/Verified-Aspirants-Grade-Release-Form-26-27.pdf) | Release model |
| S13 | FPF on [Connecticut](https://fpf.org/blog/connecticut-shows-you-can-have-it-all/) and [Colorado](https://fpf.org/blog/little-users-big-protections-colorado-and-virginia-pass-laws-focused-on-kids-privacy/); Troutman on the [Maryland Kids Code](https://www.troutmanprivacy.com/2025/11/district-court-denies-motion-to-dismiss-challenge-to-marylands-kids-code/); Cooley on the [California AADC ruling](https://www.cooley.com/news/insight/2026/2026-03-30-netchoice-v-bonta-ninth-circuit-narrows-injunction-against-californias-ageappropriate-design-code-act); WSGR on [Texas HB 18](https://www.wsgr.com/en/insights/texas-joins-other-states-in-enacting-social-media-law-for-minors.html) | Minors' privacy laws |
| S14 | Cal. Civ. Code [1798.140](https://california.public.law/codes/civil_code_section_1798.140); thresholds via [Jackson Lewis](https://www.jacksonlewis.com/insights/navigating-california-consumer-privacy-act-30-essential-faqs-covered-businesses-including-clarifying-regulations-effective-1126) | "Education information" and its FERPA carve-out; $26.625M / 100,000 / 50% thresholds |
| S15 | Privacy Rights Clearinghouse, [breach notification 50-state survey](https://privacyrights.org/resources-tools/reports/data-breach-notification-laws-50-state-survey-2026-edition) | Colorado 30 days, Texas 60 days, New York 30 days |
| S16 | PTAC, [Protecting Student Privacy While Using Online Educational Services](https://studentprivacy.ed.gov/resources/protecting-student-privacy-while-using-online-educational-services-requirements-and-best); [Data Breach Response Checklist](https://studentprivacy.ed.gov/resources/data-breach-response-checklist) | Contract and breach practice |
| S17 | SPPO FAQ on the [five-year rule](https://studentprivacy.ed.gov/faq/would-child-welfare-agency-cwa-or-tribal-organization-be-subject-ferpas-five-year-rule-if-it) | 99.67(e); older text had it at 99.33(e). Which applies now is unresolved |
| S18 | Oglethorpe, [grade release](https://greeklife.oglethorpe.edu/?p=705) | Release model |

From the repo (read on `main` at the time of writing): [`spec/behavior/legal.md`](../../spec/behavior/legal.md); `apps/landing/app/{terms,privacy,ferpa}/page.tsx`; [`docs/ops/db-rollback-playbook.md`](../ops/db-rollback-playbook.md); [`docs/ops/deployment/supabase.md`](../ops/deployment/supabase.md); [`docs/ops/incident-response.md`](../ops/incident-response.md); [`docs/security/`](../security/README.md); `.github/workflows/db-backup.yml`; `.github/dependabot.yml`. From open PRs: #4218, #4222, #4213. From #4192's comments: the hub's ChapterBuilder and FERPA research (itself unverified).
