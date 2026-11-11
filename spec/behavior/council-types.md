# Council types: IFC, Panhellenic, NPHC, MGC and organizations outside the councils

> **Status: Proposed, pending Paul. Nothing here is built.**
>
> Part of [#4192](https://github.com/pdcarlson/Frapp/issues/4192). Asked by: Winston (`whewitt-frapp`), 2026-11-11.
>
> This is a design Paul has not approved. Until he does, nothing here overrides [`rush.md`](rush.md), [`rbac.md`](rbac.md) or the code, and nothing here is drift to file or a rule to build against. Once he decides, each approved rule moves into the spec that owns it, and this file shrinks to what is still proposed.

The school-layer design so far is written for the IFC, which ships first. This file checks that it works for every council type a school has, and says where it doesn't. It builds on three sibling designs and changes none of them on its own; [§ Changes the sibling designs need](#changes-the-sibling-designs-need) lists what each should take.

- **URLs and tenant context:** [ADR-27](../architecture/adr/adr-27.md) (merged as a proposal in #4213).
- **Recruitment behavior:** `ifc-recruitment.md`, in PR [#4218](https://github.com/pdcarlson/Frapp/pull/4218). The IFC flow, its push-up events, eligibility and the PNM's own view.
- **Data model and permissions:** `spec/architecture/school-layer.md`, in PR [#4222](https://github.com/pdcarlson/Frapp/pull/4222). Councils are `chapters` rows with `kind = 'council'` and a `council_type` of `ifc`, `panhellenic`, `nphc`, `mgc` or `other`.

**Settled before this file** (Winston, on #4192):
- A council is run like a chapter, with custom role titles.
- Chapters push data up, and a council never reads a chapter's data live ([#4068](https://github.com/pdcarlson/Frapp/issues/4068) decision 11).
- The IFC ships first, Panhellenic next, then the other councils.

**How to read the claims.**
- **Research** comes from web-search summaries of school and vendor pages. The sandbox could not open most of them, so **every research claim is unverified** until someone reads the linked source. Rules vary by campus; the school's own rules always govern.
- **Today's code** was read at `main` `63d22c0` (2026-11-11), and each claim names the file.
- **"Derived"** marks a conclusion reasoned from the research, not stated by a source.

## Contents

1. [The four councils at a glance](#the-four-councils-at-a-glance)
2. [Council profiles: what the type decides](#council-profiles-what-the-type-decides)
3. [IFC](#ifc)
4. [Panhellenic](#panhellenic)
5. [NPHC](#nphc)
6. [MGC](#mgc)
7. [Organizations outside the councils](#organizations-outside-the-councils)
8. [Default role titles](#default-role-titles)
9. [What each council's space shows](#what-each-councils-space-shows)
10. [Phasing](#phasing)
11. [Changes the sibling designs need](#changes-the-sibling-designs-need)
12. [Decisions for Paul](#decisions-for-paul)
13. [Sources](#sources)

## The four councils at a glance

| | IFC | Panhellenic (NPC) | NPHC (Divine Nine) | MGC |
| --- | --- | --- | --- | --- |
| **How students join** | Open bidding: a chapter extends a bid, the PNM accepts | Formal recruitment in rounds, ending in **mutual selection** and computer bid matching; then Continuous Open Bidding (COB) | **Membership intake**, run by each chapter on its own schedule, approved by the school's FSL office. No council-wide recruitment | Each organization runs its own intake or recruitment. Most campuses report no council-wide recruitment |
| **The council's part in joining** | Registration, eligibility, the season calendar, bid rules | Runs the whole process: registration, rounds, schedules, release figures, matching, bid day | None in selection. Coordinates information events; the FSL office, not the council, approves intake | Usually none in selection. Hosts information events |
| **Recruitment in Frapp** | #4218's flow | A separate flow ([§ Panhellenic](#panhellenic)) | **None, by design** ([§ NPHC](#nphc)) | None at the council; chapter-private only ([§ MGC](#mgc)) |
| **What the council's space is mostly for** | Recruitment, rules, judicial | Recruitment, standards, philanthropy | Events (step and yard shows, Meet the Greeks), service, council meetings | Programming, events, council meetings |
| **Typical size** | Large | Large | Small. One school reported 37 NPHC members against 1,402 IFC | Small. The same school reported 107 |

Sizes are one school's report, from a 2016 student newspaper ([Daily Northwestern](https://dailynorthwestern.com/2016/11/22/campus/students-of-color-describe-challenges-in-multicultural-greek-councils)), and only show the scale gap.

**What follows from the table** (derived): the IFC design generalizes to every council for the *council-as-tenant* part (roles, chat, events, documents, announcements, chapter links). It does **not** generalize for recruitment. Panhellenic needs a different flow, and NPHC and MGC need recruitment switched off at the council, not merely hidden.

## Council profiles: what the type decides

A council's `council_type` selects a **council profile**: code data, like the chapter archetypes in `packages/org-archetypes/src/index.ts`, never a branch on a name.

| The profile sets | Example | Can the council change it? |
| --- | --- | --- |
| Seeded tiers and role titles | [§ Default role titles](#default-role-titles) | Yes. Every title renames, as #4222 § 5.3 says |
| Module map (what the nav shows) | NPHC has no Recruitment | Yes, within the recruitment model below |
| **Recruitment model** | `open_bidding`, `formal`, `none` | Only to the models its type allows |
| Which chapter archetypes are offered a link | IFC → `ifc`, `colony` | No. A council can still accept any chapter that asks |
| Mobile tab set and campus-home card | [§ What each council's space shows](#what-each-councils-space-shows) | No |

### Recruitment models

The model is the one setting that decides whether a council handles PNMs at all. It's a council setting whose default and allowed values come from the type:

| Model | What it turns on | Types that may use it |
| --- | --- | --- |
| `open_bidding` | #4218 as written: the master list, interest forms that push up, eligibility, bid rules, the PNM's own view | IFC (default). Panhellenic, for COB only. `other` |
| `formal` | `open_bidding`, plus rounds, schedules, release figures, mutual selection, matching results and binding agreements ([§ Panhellenic](#panhellenic)) | Panhellenic (default) |
| `none` | No master list, no PNM records at the council, no council registration form, no Recruitment area. Chapters' own forms feed only the chapter | NPHC (only value). MGC (default). `other` (default). IFC and Panhellenic, if they choose |

**`none` is enforced on the API, not just in the nav.** A council whose model is `none` is refused on every `council-recruitment` route, and no push-up event creates a `pnms` row for it. #4222 § 2.3 already notes that a module map can't lock anything, because `isModuleEnabled` reads a missing key as on; the model check sits beside ADR-27's `@TenantKinds` check for the same reason.

**What's configurable and what's a separate flow.**
- **Configurable** (settings on one flow): the bid window, eligibility before bids, one acceptance per PNM, bid-day release, quiet period, the eligibility rule, retention, role titles, which modules show. These all exist in #4218.
- **A separate flow** (its own screens, tables and rules): Panhellenic formal recruitment. Rounds, invitation lists capped per round, two-sided ranking and matching don't reduce to settings on open bidding ([§ Panhellenic](#panhellenic)).
- **Absent by design:** NPHC intake. There is no NPHC flow to configure ([§ NPHC](#nphc)).

## IFC

#4218 is the IFC design, and this file changes nothing in it beyond [§ Changes](#changes-the-sibling-designs-need). The IFC profile:
- recruitment model `open_bidding`;
- modules: chat, members, events, documents, announcements, roles, audit log, billing, Recruitment, and (later) judicial;
- offered links: chapters whose archetype is `ifc`, and `colony` chapters that choose IFC.

## Panhellenic

### How formal recruitment works (research, unverified)

**Rounds and mutual selection.**
- PNMs register with the College Panhellenic and attend rounds. Early rounds are invitational, so a PNM may attend a party at a chapter she wouldn't pick ([UA Panhellenic](https://uapanhellenic.com/recruitment-questions)).
- After each round, PNMs rank the chapters they want to return to, and chapters submit the PNMs they invite back. This is **mutual selection**.
- CampusDirector's round setup has four types: Open House, Invitational, Priority and Bid Matching ([CampusDirector KB](https://support.mycampusdirector2.com/portal/en/kb/articles/campusdirector-configuring-rounds)).
- In the final (preference) round, a chapter ranks the full list of PNMs who attended that day, not a simple invitation list ([Daily Pennsylvanian](https://www.thedp.com/article/2013/02/sorority-medical-residency-recruitment-similar)).

**Release Figure Methodology (RFM).**
- RFM is NPC's model for how many invitations each chapter may send in each round ([Dartmouth FAQ](https://students.dartmouth.edu/greek-life/sites/students_greek_life.prod/files/greek_life/wysiwyg/rfm_and_recruitment_process_faq.pdf)).
- Each chapter gets a per-round cap (a "carry figure"), plus **flex lists**: PNMs it would invite beyond the cap, and PNMs it would release early if asked.
- A trained NPC volunteer, the **RFM specialist**, sets the figures with the council's advisor. One campus's formula is quota × parties in the round ÷ the previous return rate, from the last three years' data. Campuses differ.
- NPC piloted RFM on 10 campuses in 2003; one national says more than 495 campuses now use it ([Alpha Gamma Delta](https://alphagammadelta.org/2020/05/29/the-evolution-of-primary-recruitment/)).

**Quota and total.**
- **Quota** is how many new members each chapter may bid in formal recruitment. It isn't fixed in advance: after preference round and the signed binding agreements, the FSL advisor and the RFM specialist pick it from a range by looking at the match results for each option ([UA Panhellenic](https://uapanhellenic.com/recruitment-questions)).
- **Total** is the cap on a chapter's whole size, initiated and new members together. It decides whether a chapter may keep recruiting after formal recruitment.
- **Quota additions:** unmatched PNMs who kept their options open are placed as additions, only with chapters that followed RFM and matched to quota. **Snap bids** go only to chapters that didn't match quota. CampusDirector has a Snap Bid feature ([KB](https://support.mycampusdirector2.com/portal/en/kb/articles/campusdirector-adding-snap-bid)).

**The binding agreement (MRABA).**
- Before matching, a PNM signs the Membership Recruitment Acceptance Binding Agreement, a contract under NPC rules ([Dartmouth](https://students.dartmouth.edu/greek-life/recruitment/isc-recruitment/mraba)).
- If she's matched to a chapter she listed and declines, she can't join another NPC chapter on that campus until the next primary recruitment (the **one-year rule**). A transfer can join at her new school.
- COB has its own MRABA with the same limit ([Colorado](https://www.colorado.edu/greeks/sites/default/files/attached-files/mraba2024cob.pdf)). Campuses require filing within about one business day ([SIU](https://fsl.siu.edu/_common/documents/forms-documents/mraba-formal-recruitment.pdf)).

**Recruitment counselors (Rho Gammas, Pi Chis) and disaffiliation.**
- Counselors guide PNMs through recruitment and are **disaffiliated** from their own chapter for the period: they don't wear letters, and don't attend their chapter's recruitment meetings ([WPI rules](https://static-prod-us-east-1.campusgroups.com/upload/wpi/2024/doc_602604_Recruitment_Rules_2024_64c128b8-24f3-4b3b-b587-478947c68994_108192855.pdf)). They usually sign a behavior contract.
- At some schools the whole Panhellenic executive board is disaffiliated too, from the start of the term to bid day. Dates are local; one school starts on July 15 ([UGA](https://greeklife.uga.edu/wp-content/uploads/sites/9/2024/03/UGA-Panhellenic-Recruitment-Rules-3-13.pdf)).

**Continuous Open Bidding (COB).**
- COB is informal recruitment outside primary recruitment, open only to chapters **below total** ([Texas A&M](https://cpc.tamu.edu/continuous-open-bidding)). A chapter at 220 with total 225 may bid up to five.
- It's voluntary and unstructured, and campuses time it differently: right after bid day, or each spring once total is re-set ([Colorado](https://www.colorado.edu/greeks/node/333)).

**"No frills" and values-based recruitment.**
- Campus rules cite NPC policy for minimal decorations, no skits or costumes, and no gifts (a gift being "any item the PNM didn't have before entering the room") ([Winthrop](https://www.winthrop.edu/uploadedFiles/greeklife/FinalCompact828.pdf), [SIUE](https://siue.edu/kimmel-hub/pdf/SIUE_PanhellenicRecruitmentRules_Approved05152024.pdf)).
- NPC's own wording lives in its Manual of Information, which no search returned. Campus rules call NPC's Unanimous Agreements "valued and non-negotiable".

**What the vendors do** (unverified):
- **CampusDirector** (Phired Up): registration, invitations, schedules matched to chapter lists, and bid matching in one place. Its matching has two modes: quota-style for Panhellenic and accept/decline for IFC. After a match it reports each unmatched PNM, how she ranked chapters and how they ranked her ([CampusDirector KB](https://support.mycampusdirector2.com/portal/en/kb/articles/campusdirector-configuring-rounds)). It claims 300+ Panhellenic communities (from the earlier research on #4192).
- **ICS** (Interactive Collegiate Solutions): council recruitment and ranking; one Panhellenic used it to organize rankings as early as 2011 ([IDS News](https://www.idsnews.com/article/2011/01/pha-database-organizes-recruitment-decisions)). It charges per chapter, council and PNM, per the earlier #4192 research.
- **OmegaFi:** the earlier research lists registration, payments, matching and voting. This pass found nothing more.

### What a tool must respect (derived from the rules above)

1. **Frapp doesn't compute release figures, quota or total.** The RFM specialist and the advisor set them. Frapp takes them as input per round and per season, records who entered them, and enforces them as caps. A wrong figure is NPC's and the school's call to correct, not an algorithm Frapp owns.
2. **Rankings are the most sensitive data in the system.** A chapter's ranked list and a PNM's preference card must never reach another chapter, the PNM, or a council officer who isn't running the match. Under decision 11 they're push-up events, readable only by an explicit-grant matching role.
3. **Disaffiliation must hold inside Frapp.** A counselor who can still read her chapter's recruitment channel or candidate pages isn't disaffiliated. Frapp can't stop a phone call, and says so, as #4218's quiet period does.
4. **The binding agreement is a legal instrument.** Its text is NPC's and the school's. Frapp records a signature and its date, applies the one-year rule to eligibility, and shows the PNM what she signed. It doesn't write the text.
5. **"No frills" rules aren't Frapp's to enforce.** They govern rooms and parties. Frapp's part is not to add frills of its own: no PNM-facing chapter swag, themes or gift flows in the formal-recruitment screens (derived).
6. **Matching errors are public and high-stakes.** A wrong match puts a PNM in the wrong chapter and can't be quietly undone.

### Design: a separate flow on the same records

Panhellenic reuses #4218's records (`pnms`, interests, eligibility, the PNM's view, push-up events) and adds a formal-recruitment flow beside it.

| Piece | Who | What it is |
| --- | --- | --- |
| **Season with rounds** | `council:recruitment_manage` | Rounds in order, each with a type (open house, invitational, preference), dates and party slots |
| **Release figures** | `council:recruitment_manage` | Entered per chapter per round from the RFM specialist. Recorded with who entered them |
| **Quota and total** | `council:recruitment_manage` | Quota per season, entered after matching (option ranges allowed). Total per chapter, which also gates COB |
| **Invitation lists** | Chapter, `rush:manage` | Each round, the chapter submits its invite list, capped by its release figure, plus flex-plus and flex-minus lists. A **push-up event**: the council never reads the chapter's pipeline to build it |
| **PNM preferences** | The PNM, in her own view | After each round, she ranks the chapters she wants to return to. A PNM push-up |
| **PNM schedules** | System, from both lists | Who visits which chapter in which party slot. The PNM sees only her own |
| **Preference-round bid lists** | Chapter, `rush:manage` | The ranked list, pushed up once |
| **Binding agreement** | The PNM | Signed in her view before matching, with the school's text |
| **Matching** | Explicit-grant `council:matching_operate` | See [below](#matching-import-first-build-later) |
| **Quota additions and snap bids** | `council:matching_operate` | Recorded against the match, within the rules above |
| **Bid day** | `council:recruitment_manage` | #4218's **release** mode, required for `formal` |
| **COB** | Chapters below total | #4218's open bidding, allowed only while `members + accepted bids < total`, with the COB binding agreement and the one-year rule applied to eligibility |

**Counselors and disaffiliation.**
- **Recruitment counselors are a council role**, seeded as their own tier ([§ Default role titles](#default-role-titles)). A counselor sees her assigned PNM group's logistics: names, schedules, attendance. She sees no rankings, no chapter data, and no PNM's preferences.
- **Disaffiliation is a dated record the council publishes:** member, chapter, start, end. While it runs and the chapter's council link is accepted, the **chapter's** permission resolution drops that member's `rush:*` keys and hides recruitment channels from her. The chapter sees the record and can't edit it.
- That is a council fact changing what a chapter member can see. Decision 11 forbids the council *reading* a chapter, and this reads nothing, but it does reach down. It's [decision 3](#decisions-for-paul).
- The same record covers a disaffiliated executive board.

**Season limits on council officers** (#4218 § Council officers are also chapter members) stay as written. Disaffiliation is in addition to them, not instead.

#### Matching: import first, build later

**Recommendation: Frapp doesn't run Panhellenic matching in its first Panhellenic release.**
1. **Phase 4a, import.** The council exports the final lists and preferences in the format its matching provider takes, runs the match there (CampusDirector, ICS, or the NPC process the campus already uses), and imports the results. Frapp then runs bid day, the PNM's acceptance, the binding agreement and COB.
2. **Phase 4b, build,** only if Paul decides it's worth the risk. A match engine needs NPC sign-off on its method, a reproducible run log, and test fixtures from real past seasons. The two-sided ranking matches the deferred-acceptance family (derived from the research's comparison with medical residency matching), but NPC's exact rules aren't public in what was found.

Why: matching errors are public, the method is NPC's, and the vendors already serve hundreds of Panhellenics. What Frapp adds is everything around the match, which is most of what a chapter and a PNM touch.

## NPHC

### How intake works (research, unverified)

- **Pledging was abolished in 1990.** The NPHC organizations issued a joint statement eliminating pledging and pledge "lines" as a membership process; each adopted its own membership intake process ([NPHC joint statement, reaffirmed 2020](https://studentaffairs.jhu.edu/hazing/wp-content/uploads/sites/59/2025/08/NPHC-Joint-Position-on-Hazing-statement-Reaffirmed-June-2020.pdf)). Hazing, including after intake, is prohibited.
- **There's no council recruitment.** NPHC and MGC have "no formal recruitment period" ([Elon](https://www.elon.edu/u/fraternity-and-sorority-life/recruitment-information/membership-intake/)). Each chapter decides when it takes members, within its national's rules.
- **The FSL office gates intake, not the council.** The common sequence across schools:
  1. The chapter gets written approval to hold intake ([FAU](https://www.fau.edu/fslife/documents/fau-nphc-ugc-membership-intake-policy-procedures.pdf)).
  2. Candidates sign a grade consent form.
  3. The council's advisor verifies GPA and enrollment ([CMU](https://www.cmu.edu/fsl/prospective/nphc-intake-packet.pdf)).
  4. Only after the advisor's verification does the chapter start national paperwork or collect fees ([Texas State](https://docs.gato.txst.edu/646834/2023%20NPHC%20Membership%20Intake%20Form.pdf)).
- **Interest meetings** are often required and regulated: some schools require advance notice to the advisor, a staff member presenting the hazing policy, and attendees receiving that policy ([Tennessee](https://studentlife.utk.edu/gogreek/wp-content/uploads/sites/13/2025/08/MIP-policy.pdf), [Clemson](https://www.clemsonmgc.org/s/Clemson-Membership-Intake-Guidelines-Jan-2022.pdf)).
- **Intake records are confidential.** Schools keep intake documents confidential and share them on a need-to-know basis ([Virginia Tech](https://fsl.vt.edu/content/dam/fsl_vt_edu/NPHC%20Full%20Membership%20Intake%20Policy%20-%20Fall%202025.pdf)); one ties that to state law.
- **The process runs about 4 to 8 weeks,** varying by organization ([KU](https://kusfl.ku.edu/national-pan-hellenic-council-intake-family-resource-guide)).
- **New members are revealed publicly at the end.** Background knowledge, with no source found in this pass: who is in intake is not public until the chapter presents its new members.

### What Frapp must not do

These are design rules, derived from the research. Each holds regardless of settings:

1. **No council-side intake data.** An NPHC council's recruitment model is `none`, with no way to change it. It has no master list, no PNM records, no registration form and no Recruitment area. Not even counts: "Chapter X has 12 aspirants" is itself intake information.
2. **No public interest capture for NPHC chapters by default.** Chapter interest forms (`/f/<form-slug>`) and QR codes are off for archetype `nphc` (its `rush` module is already `false` in `packages/org-archetypes/src/index.ts`). A chapter can turn its module on; the form then feeds only the chapter, and the settings toggle says the records are chapter-private and deleted at intake's end.
3. **No aspirant in the chapter before they're a member.** Frapp has no "aspirant" membership state: no roster row, no chat channel, no role. An aspirant is not invited into the chapter's Frapp until the chapter makes them a member. Group chats with candidates are where hazing evidence and hazing itself tend to live (derived); Frapp shouldn't host that space.
4. **Nothing that reveals intake to anyone else.** No activity rows, notifications, campus-home cards, calendar markers or search results that name an aspirant or say a chapter is in intake. Intake dates aren't campus events unless the chapter publishes an interest meeting as an ordinary public event.
5. **The `lines` module records lines after crossing only.** Its catalog entry is "NPHC/MGC line tracking — cohort, crossing date, line name" (`packages/org-archetypes/src/index.ts`). It never holds anyone who hasn't crossed.
6. **The council never sees intake paperwork.** If Frapp ever carries the candidate verification packet (grade consents, the candidate list), it goes from the chapter straight to the school's FSL office, never through the council. That needs the school-office tenant (#4222 Q8) and is [decision 1](#decisions-for-paul).

### What NPHC councils actually need

| Need | What Frapp gives it | Exists today? |
| --- | --- | --- |
| **Council events:** Meet the Greeks, step shows, yard shows, NPHC week, homecoming ([Ole Miss](https://olemiss.edu/departments/student-affairs/greeks/nphc/index.php), [Western Michigan](https://wmich.edu/studentengagement/greek/chapters/nphc)) | The council's own Events, shown on campus home and offered to linked chapters as read-only rows | Events, yes. Campus home is planned |
| **Step show logistics:** team sign-up, order, rules, judges, scoring | A sign-up form per event (#3926's chat form cards) and documents. A scoring tool is later and only if asked | Partly |
| **Service:** council service projects, a week of service ([UNC](https://dailytarheel.com/article/2015/03/national-pan-hellenic-council-week-of-service-gets-back-to-origins)) | Events marked as service. Each linked chapter can push its service-hour total up, never member detail | Service hours exist per chapter ([`service-hours.md`](service-hours.md)) |
| **Council meetings and votes** | Council chat, documents (constitution, minutes) and polls among delegates | Yes, as tenant features |
| **Announcements to chapter officers** | #4222's `council:announce` | Planned |
| **Each organization's information** | A public chapter page with how to contact the chapter about membership. No "I'm interested" button that records anyone | No |
| **Plots and yard spaces** | Out of scope. Campus monuments some NPHC organizations maintain; no source found in this pass | — |

The NPHC council is the cheapest council to support: everything it needs is tenant features that already exist plus campus home. That's a reason to ship it early (derived): [§ Phasing](#phasing).

## MGC

**Research (unverified):**
- **No council-wide recruitment.** Maryland's MGC "does not coordinate a council-wide or collaborative recruitment process"; each organization runs its own intake or recruitment ([UMD](https://fsl.umd.edu/potential-members/recruitment-intake/mgc-intake-recruitment)). Colorado's says the same, adding that most organizations host information events ([CU](https://www.colorado.edu/greeks/mgc-faqs)).
- **Intake times vary** through the year, and requirements vary by organization: most require a standing college GPA, and some sophomore standing.
- **Membership comes through several national umbrellas.** One school lists organizations from NALFO (Latino), the National Multicultural Greek Council and even NPHC under its MGC ([UTEP](https://utep.edu/student-affairs/selc/Fraternity-and-Sorority-Life/multicultural-greek-council.html)). Asian-interest organizations (under NAPA) are common in MGCs; their rules weren't found.
- **Council boards limit chapter weight.** Texas A&M caps the board at two members from any one organization; Ohio bars a board member from also being their organization's delegate ([TAMU](https://mgc.tamu.edu/wp-content/uploads/2023/05/MGC-Constitution-By-Laws-Updated-March-2023.pdf), [Ohio](https://www.ohio.edu/greek/multicultural-greek-council-constitution-bylaws-0)).
- **Some MGC organizations recruit rather than hold intake,** per student reporting of a "less formal process… word of mouth, Facebook events and in-person conversations" ([Daily Northwestern](https://dailynorthwestern.com/2019/03/08/campus/in-focus-as-the-multicultural-greek-council-evolves-students-still-face-institutional-hurdles-lack-of-name-recognition)).

**Design:**
- **Council model `none` by default,** changeable to nothing else in the MVP. The council's space is programming, events, meetings and announcements, like NPHC's.
- **Each chapter decides its own joining process.** The `mgc` archetype's `rush` module is `false` today. A chapter that recruits openly turns it on and gets the chapter pipeline from #4218, private to the chapter. A chapter that holds intake keeps it off and follows the [NPHC rules](#what-frapp-must-not-do).
- **NPHC rules follow the chapter's archetype, not its council.** An NPHC organization sitting in an MGC (UTEP's case) or a combined council keeps every rule in [§ What Frapp must not do](#what-frapp-must-not-do).
- **Board composition rules are later.** A per-council setting, "at most N officers from one chapter", checked when a role is assigned, would cover the Texas A&M rule. Officers' captions already name the chapter they represent (#4192 UI design).
- **Later, opt-in: an information-night sign-up** that a student fills in once and that sends their contact only to the organizations they tick, with no list kept at the council. It's the one recruitment-like feature an MGC might want. Not designed further until an MGC asks.

## Organizations outside the councils

### Research (unverified)

- **Professional, service and honor organizations usually sit outside the four councils.** Lehigh's councils are IFC, Panhellenic and MGC; Alpha Phi Omega (service) is outside them and has no formal recruitment ([The Brown and White](https://thebrownandwhite.com/2015/04/02/non-ofsa-greek-houses/)).
- **Some schools have a professional fraternity council.** UC Merced's PFC includes Alpha Kappa Psi, Alpha Phi Omega, Delta Epsilon Mu, Delta Sigma Pi, Phi Alpha Delta and Phi Delta Epsilon ([UC Merced](https://fraternitysorority.ucmerced.edu/contact-us)).
- **Recognition varies.** Rutgers lists APO among unrecognized organizations it won't support ([Rutgers](https://greeklife.rutgers.edu/chapters/unrecognized-organizations)). Such groups are usually registered student organizations, under the student-activities office rather than FSL.
- **Honor societies induct by invitation,** usually from a GPA list the school produces (background; no source in this pass).

### Design

| Archetype | Links to a school | Offered a council link | Recruitment |
| --- | --- | --- | --- |
| `professional` | Yes | Only to a council of type `other` the school has, such as a PFC | Its own chapter pipeline, private |
| `service` | Yes | The same | The same |
| `honor` | Yes | No | None. Inducting from a school GPA list is out of scope: it would need the school-office tenant and a separate legal review |
| `colony` | Yes | To the council of its national's type, if the council accepts. The council decides whether colonies get recruitment access | Its own pipeline. On a council with `open_bidding`, the same as any linked chapter |

- **`other` is a real council type,** for a PFC, a combined "United Greek Council", or anything else a school has. Its label is the council's name, its default model is `none`, and it may switch to `open_bidding`.
- **More than one `other` council per school is allowed.** #4222 § 2.3 allows one council of each type per school; that rule shouldn't count `other` ([§ Changes](#changes-the-sibling-designs-need)).
- **`Archetype.council` is not a campus council for these archetypes.** It reads "Professional Fraternity Association", "Service Fraternity" and "Association of College Honor Societies", which are national bodies or labels. The link offer uses an explicit map from council type to archetypes instead of that string.
- **Clubs** stay out of scope, as #4192 records.

## Default role titles

Every council gets #4222 § 5.3's structure: three tiers, a Council admin role holding `*`, and one floor role with `system_key = MEMBER`. Only the seeded titles, and where noted an extra tier, change by type. Every title renames.

| Type | Executive board | Officers | Floor tier |
| --- | --- | --- | --- |
| **IFC** (#4222) | President, VP Recruitment, VP Judicial, Treasurer, Secretary | — | Delegate |
| **Panhellenic** | President, VP Recruitment, VP Recruitment Counselors, VP Judicial, VP Finance, VP Philanthropy, VP Public Relations | **Recruitment counselors** tier: Recruitment Counselor | Delegate |
| **NPHC** | President, Vice President, Secretary, Treasurer, Parliamentarian, Public Relations | — | Delegate, Alternate delegate |
| **MGC** | President, Vice President, Secretary, Treasurer, VP Programming, VP Judicial | — | Delegate |
| **Other** | President, Vice President, Secretary, Treasurer | — | Delegate |

Titles are common ones from campus pages, not a standard: Panhellenic from [Ole Miss](https://olemiss.edu/departments/student-affairs/greeks/cph/exec-board) and [Kent State](https://www.kentstatefsl.com/panhellenic-1), NPHC from [Ohio](https://www.ohio.edu/greek/nphc-constitution-bylaws) and [Murray State](https://www.murraystate.edu/campus/orgsRecreation/StudentOrganizations/greek/media/nphc-governing-documents-02-11-16.pdf), MGC from [Ohio](https://www.ohio.edu/greek/multicultural-greek-council-constitution-bylaws-0) and [Cornell](https://archive.assembly.cornell.edu/uploads/SA/SAF1618APP-Multicultural-Greek-Letter-Council.pdf).

**Keys the titles start with** (#4222's council keys, plus two new ones):

| Role | Keys beyond its tier |
| --- | --- |
| VP Recruitment (IFC, Panhellenic) | `council:pnm_manage`, `council:recruitment_manage`. Eligibility keys only by explicit grant, as #4222 says |
| VP Recruitment Counselors (Panhellenic) | **New** `council:counselors_manage`: assign counselors to PNM groups, publish disaffiliation records |
| Recruitment Counselor (Panhellenic) | **New** `council:pnm_group_view`: her assigned group's names, schedules and attendance only |
| VP Programming, Public Relations | `council:calendar_manage`, `council:announce` |
| Running the match (Panhellenic) | **New** `council:matching_operate`, **explicit grant**, like the eligibility keys: `*` doesn't satisfy it. Usually the VP Recruitment and the FSL advisor |

An NPHC or MGC council's role editor shows no `council-recruitment` keys at all: the catalog filters by recruitment model as well as by kind.

## What each council's space shows

| | IFC | Panhellenic | NPHC | MGC | Other |
| --- | --- | --- | --- | --- | --- |
| **Web nav** | Home, Chat, Recruitment, Events, Chapters, Officers, Documents | The same; Recruitment adds Rounds, Counselors and Matching in season | Home, Chat, Events, Service, Chapters, Officers, Documents | Home, Chat, Events, Chapters, Officers, Documents | As MGC; Recruitment only if `open_bidding` |
| **Mobile third tab** | Recruitment | Recruitment | Events | Events | Events, or Recruitment if `open_bidding` |
| **Council home** | Season status, PNM counts, the next council date | The same, plus the current round and counselor groups | Upcoming council events, service totals, open votes | Upcoming events, open votes | Upcoming events |
| **On campus home** | "Recruitment" card: dates and how to register | The same, with the formal-recruitment schedule | "Meet the Greeks" and council events; each chapter's page with how to contact it about membership | The same as NPHC | Events |
| **What a student can't do from campus home** | — | — | Register interest with the council or a chapter | Register interest with the council | — |

**ADR-27 and the UI design need one change here:** the council tab set comes from the council's recruitment model, not from `kind` alone ([§ Changes](#changes-the-sibling-designs-need)).

## Phasing

| Phase | What | Why here |
| --- | --- | --- |
| **IFC MVP** (#4192 phases 1–3) | Everything #4218 lists, **plus** the council profile mechanism with only the IFC profile active, the recruitment model column with `open_bidding` and `none`, and the `none` check on every council-recruitment route | Building the model check into the MVP costs one column and one guard; adding it after IFC routes ship means auditing every one |
| **Small councils** (new, can follow the MVP closely) | NPHC, MGC and `other` profiles with model `none`; their role packs; the NPHC rules for `nphc`-archetype chapters (forms off by default, no aspirant state); the council home and tab set by model; service-total push-up | It's tenant features that already exist. It lets a school onboard every council at once instead of only the IFC |
| **Panhellenic 4a** | The Panhellenic profile; counselors and disaffiliation; rounds, release figures, invitation lists, preferences, schedules; matching **by import**; quota and total; binding agreements; bid-day release; COB | #4218's Panhellenic section; this file details it |
| **Panhellenic 4b** (only if Paul says so) | Frapp's own match engine | [§ Matching](#matching-import-first-build-later) |
| **Later** | MGC information-night sign-up; board-composition caps; step-show scoring; a chapter → FSL-office intake packet (needs the school-office tenant) | Each waits for a council to ask |

**Not in any phase:** council-side NPHC intake data of any kind.

## Changes the sibling designs need

Sent to Winston's hub for the owning workers. None is made by this PR.

**Data model (#4222, `school-layer.md`):**
1. **Recruitment model.** A council column (or council setting) `recruitment_model in ('open_bidding', 'formal', 'none')`, checked against `council_type`: `nphc` allows only `none`; `mgc` and `other` allow `none` and (for `other`) `open_bidding`; `panhellenic` allows `formal`, `open_bidding` and `none`; `ifc` allows `open_bidding` and `none`.
2. **Push-up refusal.** No push-up event creates or links a `pnms` row for a council whose model is `none`, and every `council-recruitment` route checks the model beside `@TenantKinds`.
3. **Role packs by type.** `COUNCIL_SEEDED_ROLES` and `COUNCIL_STARTING_ROLE_TIERS` keyed by `council_type`, per [§ Default role titles](#default-role-titles), with the Panhellenic Recruitment counselors tier.
4. **New keys:** `council:counselors_manage`, `council:pnm_group_view`, and the explicit-grant `council:matching_operate`. The permission catalog filters by recruitment model as well as kind.
5. **One council per type per school, except `other`.**
6. **Link offers by explicit map** from council type to archetypes, not from `Archetype.council`.
7. **Disaffiliation records** (`council_disaffiliations`: council, user, chapter, starts, ends, published by), read by the chapter's permission resolution while the link is accepted. Pending [decision 3](#decisions-for-paul).
8. **Panhellenic tables, later** (placeholders): `recruitment_rounds`, `round_release_figures`, `round_invitation_lists`, `pnm_round_preferences`, `pnm_round_schedule`, `preference_bid_lists`, `match_imports` and `match_results`, `chapter_season_totals` (quota and total), `binding_agreements`. Rankings and preferences readable only through `council:matching_operate`.

**Recruitment (#4218, `ifc-recruitment.md`):**
1. **§ Panhellenic differences** points here for the detail.
2. **COB isn't just the IFC flow.** It also needs the total cap, the COB binding agreement, and the one-year rule in eligibility. #4218 currently says "the IFC flow covers it".
3. **Interest forms by archetype.** `nphc`-archetype chapters have forms off by default, and their settings say why; a chapter whose councils are all model `none` gets forms that feed only the chapter. #4218 § Before the chapter's council link is accepted already has that behavior; it should name this case.
4. **"Matching or integrate with a provider"** becomes the import-first recommendation above.

**URLs and UI (ADR-27, the UI design):**
1. **The council tab set** reads the recruitment model, not only `kind` (ADR-27 § Mobile). An NPHC council's third tab is Events.
2. **Council creation:** picking NPHC, MGC or Other skips every recruitment step and seeds that type's role pack. The Unverified badge and link flow are unchanged.
3. **Campus home** draws each council's card by type ([§ What each council's space shows](#what-each-councils-space-shows)). An NPHC or MGC chapter's entry never has an "I'm interested" action.

## Decisions for Paul

⚑ marks an item on the [AGENTS.md raise-first list](../../AGENTS.md#adr-discipline).

1. **⚑ NPHC intake: Frapp holds no intake data at the council, ever, and no aspirant state in a chapter** (recommended). The alternative is chapter-private intake tracking. Either way, a later chapter → FSL-office intake packet would hold grade consents, which is the same FERPA question as GPA storage (#4222 Q1).
2. **Panhellenic matching: import first** (recommended), or build an engine in 4b. Building it is the riskiest piece in the whole school layer.
3. **Disaffiliation reaching into a chapter.** A council-published record that removes a counselor's `rush:*` access in her own chapter. It reads nothing from the chapter, so it fits decision 11 as written, but it is a council affecting a chapter. Alternatives: the counselor's chapter applies it by hand, or Frapp only shows the record and enforces nothing.
4. **⚑ The binding agreement (MRABA) signed in Frapp.** It's legal copy that isn't Frapp's, and an e-signature on a binding contract. Same lawyer questions as the FERPA release in #4218.
5. **⚑ Panhellenic registration fees.** Common, per #4218's research. A billing decision, beside council billing (#4222 Q3).
6. **Shipping the small councils right after the IFC MVP.** Cheap, and it lets a school's whole FSL community join together. It sits behind "baseline first" like the rest of #4192.

## Sources

All unverified; each is a search-result summary of the linked page. School pages describe that school's rules only.

- **Panhellenic:** [UA Panhellenic FAQ](https://uapanhellenic.com/recruitment-questions); [Dartmouth RFM FAQ](https://students.dartmouth.edu/greek-life/sites/students_greek_life.prod/files/greek_life/wysiwyg/rfm_and_recruitment_process_faq.pdf) and [MRABA](https://students.dartmouth.edu/greek-life/recruitment/isc-recruitment/mraba); [Alpha Gamma Delta on RFM](https://alphagammadelta.org/2020/05/29/the-evolution-of-primary-recruitment/); [Texas A&M COB](https://cpc.tamu.edu/continuous-open-bidding); [Colorado COB](https://www.colorado.edu/greeks/node/333) and [COB MRABA](https://www.colorado.edu/greeks/sites/default/files/attached-files/mraba2024cob.pdf); [SIU MRABA](https://fsl.siu.edu/_common/documents/forms-documents/mraba-formal-recruitment.pdf); [WPI](https://static-prod-us-east-1.campusgroups.com/upload/wpi/2024/doc_602604_Recruitment_Rules_2024_64c128b8-24f3-4b3b-b587-478947c68994_108192855.pdf) and [UGA](https://greeklife.uga.edu/wp-content/uploads/sites/9/2024/03/UGA-Panhellenic-Recruitment-Rules-3-13.pdf) recruitment rules; [Winthrop](https://www.winthrop.edu/uploadedFiles/greeklife/FinalCompact828.pdf) and [SIUE](https://siue.edu/kimmel-hub/pdf/SIUE_PanhellenicRecruitmentRules_Approved05152024.pdf) on no-frills; [Daily Pennsylvanian](https://www.thedp.com/article/2013/02/sorority-medical-residency-recruitment-similar).
- **Vendors:** [CampusDirector: configuring rounds](https://support.mycampusdirector2.com/portal/en/kb/articles/campusdirector-configuring-rounds) and [snap bids](https://support.mycampusdirector2.com/portal/en/kb/articles/campusdirector-adding-snap-bid); [IDS News on ICS](https://www.idsnews.com/article/2011/01/pha-database-organizes-recruitment-decisions); the earlier vendor research on [#4192](https://github.com/pdcarlson/Frapp/issues/4192).
- **NPHC:** [NPHC joint statement on hazing](https://studentaffairs.jhu.edu/hazing/wp-content/uploads/sites/59/2025/08/NPHC-Joint-Position-on-Hazing-statement-Reaffirmed-June-2020.pdf); [Elon](https://www.elon.edu/u/fraternity-and-sorority-life/recruitment-information/membership-intake/); [FAU](https://www.fau.edu/fslife/documents/fau-nphc-ugc-membership-intake-policy-procedures.pdf); [CMU](https://www.cmu.edu/fsl/prospective/nphc-intake-packet.pdf); [Texas State](https://docs.gato.txst.edu/646834/2023%20NPHC%20Membership%20Intake%20Form.pdf); [Virginia Tech](https://fsl.vt.edu/content/dam/fsl_vt_edu/NPHC%20Full%20Membership%20Intake%20Policy%20-%20Fall%202025.pdf); [Tennessee](https://studentlife.utk.edu/gogreek/wp-content/uploads/sites/13/2025/08/MIP-policy.pdf); [Clemson](https://www.clemsonmgc.org/s/Clemson-Membership-Intake-Guidelines-Jan-2022.pdf); [KU](https://kusfl.ku.edu/national-pan-hellenic-council-intake-family-resource-guide); [Ole Miss NPHC](https://olemiss.edu/departments/student-affairs/greeks/nphc/index.php); [Western Michigan](https://wmich.edu/studentengagement/greek/chapters/nphc); [UNC week of service](https://dailytarheel.com/article/2015/03/national-pan-hellenic-council-week-of-service-gets-back-to-origins).
- **MGC:** [UMD](https://fsl.umd.edu/potential-members/recruitment-intake/mgc-intake-recruitment); [Colorado](https://www.colorado.edu/greeks/mgc-faqs); [UTEP](https://utep.edu/student-affairs/selc/Fraternity-and-Sorority-Life/multicultural-greek-council.html); [TAMU](https://mgc.tamu.edu/wp-content/uploads/2023/05/MGC-Constitution-By-Laws-Updated-March-2023.pdf); [Ohio](https://www.ohio.edu/greek/multicultural-greek-council-constitution-bylaws-0); [Daily Northwestern 2016](https://dailynorthwestern.com/2016/11/22/campus/students-of-color-describe-challenges-in-multicultural-greek-councils) and [2019](https://dailynorthwestern.com/2019/03/08/campus/in-focus-as-the-multicultural-greek-council-evolves-students-still-face-institutional-hurdles-lack-of-name-recognition).
- **Outside the councils:** [The Brown and White](https://thebrownandwhite.com/2015/04/02/non-ofsa-greek-houses/); [UC Merced](https://fraternitysorority.ucmerced.edu/contact-us); [Rutgers](https://greeklife.rutgers.edu/chapters/unrecognized-organizations).
