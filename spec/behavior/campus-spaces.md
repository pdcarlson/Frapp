# Campus spaces: school-wide social features and their moderation

**Status: Proposed, pending Paul.** Nothing here is built. Asked by Winston (`whewitt-frapp`), 2026-11-11, for [#4192](https://github.com/pdcarlson/Frapp/issues/4192). Until Paul accepts it, the specs listed in [§ 10](#10-specs-this-would-change) describe the system, and this doc changes none of them.

This doc is one part of #4192's design. It covers everything at a school that isn't recruitment: the campus feed, campus channels, messages between chapters, the school directory, campus events, how campus activity reaches people, and who moderates it all. Four parts are decided elsewhere, and this doc builds on them rather than restating them:

- **URLs and tenant context:** ADR-27 (PR [#4213](https://github.com/pdcarlson/Frapp/pull/4213)). Campus pages live at `/s/<school>`, carry `x-school-id` to a `SchoolGuard` that checks for a `school_members` row, and read only what chapters push up. Unread counts span every space through a per-user `GET /v1/me/unread`.
- **Data model and permissions:** `spec/architecture/school-layer.md` (PR [#4222](https://github.com/pdcarlson/Frapp/pull/4222)). It owns `schools`, `school_members` (with `directory_visibility`), councils as `chapters.kind = 'council'`, the `school_chapters` and `council_chapters` affiliations, and the council permission scope. It reserves `council:campus_moderate` for this phase.
- **Recruitment:** `spec/behavior/ifc-recruitment.md` (PR [#4218](https://github.com/pdcarlson/Frapp/pull/4218)). It owns PNMs, interest forms, the master list, eligibility, the season calendar, the quiet period and rules-violation reports.
- **Screens:** the UI design on #4192 ([part 1](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6805291622), [part 2](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6805368256), [part 3](https://github.com/pdcarlson/Frapp/issues/4192#issuecomment-6805509052)). It draws the campus home, the switcher and the empty states. This doc says what those screens hold and who may act on them.

**Settled before this doc** (Winston, on #4192):
- People belong to their school directly. A PNM is a school member with status `pnm`.
- The campus home `/s/<school>` is a page, not a tenant: a feed with pinned items, events, councils and chapters.
- Paul's [#4068](https://github.com/pdcarlson/Frapp/issues/4068) decision 11: chapters push data up, and a parent never reads chapter data live.
- Councils are run like chapters, and council officers moderate the school's spaces.

**How to read the claims.**
- **Today's code and specs** were read at `main` `63d22c0` (2026-11-11), and each claim cites the file or spec section.
- **Other products** come from web search results, not from opening the products. Every row in the comparison tables is **unverified** unless it says otherwise, and "background" marks general knowledge with no source found.
- **"Derived"** marks a statement reasoned from the code rather than run.

## Contents

1. [Decisions this design makes](#1-decisions-this-design-makes)
2. [School-wide spaces](#2-school-wide-spaces)
3. [Messages between chapters](#3-messages-between-chapters)
4. [School directory](#4-school-directory)
5. [Moderation](#5-moderation)
6. [Campus events](#6-campus-events)
7. [Notifications](#7-notifications)
8. [Phasing](#8-phasing)
9. [Open questions for Paul](#9-open-questions-for-paul)
10. [Specs this would change](#10-specs-this-would-change)

## 1. Decisions this design makes

| # | Decision | Why, in one line |
|---|---|---|
| C1 | The campus feed is a **feed of posts**, not a chat channel. Councils and Frapp staff post to it; everyone verified at the school reads it | A campus of thousands needs one place that says what matters, and a chat channel at that size is noise |
| C2 | Campus channels and messages between chapters are **school-scoped chat channels**: `chat_channels` gains a `school_id`, with `chapter_id` null for them | Neither chapter can own a conversation between two chapters, and a council-owned channel would vanish at a school with no council |
| C3 | Nothing on a campus surface is read live from a chapter. A chapter **publishes** an event or a role contact to the campus, and that copy is what campus pages show | Decision 11 |
| C4 | Messaging someone at another chapter starts as a **request** they accept, ignore or block | Slack Connect, Discord and Instagram all gate first contact; #3719 and #3740 ask for the same |
| C5 | The school directory is **hidden by default**, PNMs are never listed in it, and a chapter can cap how visible its own members are | Students didn't sign up to be findable by a whole campus; a chapter's roster is its own data |
| C6 | Campus moderators are council officers holding `council:campus_moderate`, plus Frapp staff over every school. **A campus ban needs a second moderator from a different chapter, or staff** | Council officers are brothers in competing chapters, so one officer must not be able to exile a rival |
| C7 | A block made on a campus surface is a **person-level block**, separate from today's chapter-scoped block, and it never tells the blocked person | Campus spaces sit outside any chapter, and the chapter block's "not delivering, never refusing" rule must carry over |
| C8 | Campus pushes are **NORMAL, never URGENT**, and capped per council | Chapter announcements ring through quiet hours; a campus of councils doing the same would teach people to mute Frapp |

## 2. School-wide spaces

### 2.1 What exists at a school

| Space | What it is | Who reads | Who posts | MVP? |
|---|---|---|---|---|
| **Campus feed** | Posts from councils and Frapp staff, newest first, with up to three pinned | Every verified school member: `member`, `pnm`, `alum`, `staff` | Holders of `council:campus_post` in a verified council at the school, and Frapp staff | Yes |
| **Campus events** | Council events, and chapter events their chapter published | Every verified school member, subject to each event's audience ([§ 6](#6-campus-events)) | Councils and chapters publish; nobody posts | Yes |
| **Campus chat** | One open channel per school, `#campus` | Verified school members with status `member` who joined it | Same | No |
| **Interest channels** | Topic channels (`#intramurals`, `#philanthropy`, `#housing`), created on request | Members who join each one | Same, unless the channel is read-only | No |
| **Council channels to the campus** | A council's read-only channel that the whole school may follow, for a council that wants more than feed posts | Followers | The council's posters | No |

**Not a space:** a chapter's own channels never appear on campus. A chapter that wants a campus presence publishes events and role contacts, and its members join campus channels as themselves.

### 2.2 The campus feed

- **A post** has a title (up to 100 characters), a body (up to 2,000, the same Markdown subset chat renders), up to four images, and an optional link to a campus event. It names the council that posted it and the officer who wrote it, under their council title.
- **Pinned items.** A council can pin up to three of its own posts, and staff can pin above them (for example a safety notice). The feed shows pinned items first, then the rest newest first.
- **Comments are off.** A feed post takes no replies and no reactions. Discussion belongs in campus chat, once it exists. That keeps the feed something a moderator can read in full, and keeps an announcement from becoming a pile-on under an officer's name.
  - *Alternative considered:* threads under posts, as Winston chose for chapter announcements in #4027. Rejected for the feed because the readership is a whole campus, but it can follow once campus moderation has run for a season.
- **Posting is a council action, through the council's own tenant.** `POST /v1/campus/posts` runs under the council's `/c/<council>` context (`@TenantKinds('council')`, `council:campus_post`), and the post records `school_id` from the council's primary active `school_chapters` row. Reading runs under `/s/<school>` (`SchoolGuard`).
- **An unverified council can't post.** Its posts would appear under a name nobody has confirmed. School-layer's `council_verified_at` gates `council:campus_post` the way it gates grade import.
- **Edits and deletes.** The author, or anyone in the council with `council:campus_post`, can edit or delete a post. An edit after 15 minutes shows "Edited". A campus moderator from another council can remove a reported post ([§ 5](#5-moderation)).
- **Who sees which post.** A post can target the whole school, or one audience: members (no PNMs), PNMs only (a council's recruitment kickoff), or alumni. The recruitment spec's quiet period doesn't stop council posts to PNMs; it pauses chapter-to-PNM messages only.

**How a council's announcement reaches every chapter's members.** Three routes, from widest to narrowest:
1. **The campus feed** reaches every verified school member, whichever chapter they're in, because people belong to the school directly. This is the default.
2. **The chapter's own `#announcements`.** A council post can ask its linked chapters to re-share it. A chapter officer with `announcements:post` sees a card, "RPI IFC asks chapters to share this", with *Share in #announcements* and *Not now*. Sharing posts a council-post card in the chapter's channel under that officer's name, so the chapter's usual URGENT announcement push applies. **The council never writes into a chapter's chat.** The chapter decides, which keeps decision 11's direction.
3. **Council contacts.** School-layer's `council:announce` reaches each linked chapter's designated council contacts (the recruitment chair, the delegate), for officer business that isn't for the whole campus.

Members who haven't verified their school email don't see the feed at all. Route 2 is the one that reaches them.

### 2.3 Campus chat and interest channels

These ship after the MVP ([§ 8](#8-phasing)), but their shape is fixed now so the MVP doesn't paint them into a corner.

**Where they live (C2).** `chat_channels` gains a nullable `school_id`, and a check that exactly one of `chapter_id` and `school_id` is set. `chat_messages` already keys on `channel_id` (`00000000000000_initial_schema.sql`), so messages, reactions, threads, attachments and reports follow the channel. What changes:

- **Access.** `canAccessChannel` (`apps/api/src/domain/utils/channel-access.ts`) gains a school branch beside the chapter one: a school-scoped channel admits a caller with an active `school_members` row at that school whose status the channel allows, and who has joined the channel. The rule "every chat read is authorized from a trusted DB lookup" ([`chat/README.md` § Channels](chat/README.md#channels)) stays exactly as it is; only the lookup gains a second shape.
- **Realtime.** A new `realtime_can_read_school_scope`, beside `realtime_can_read_chapter_scope`, checks school membership and channel membership by id.
- **Every chat query that assumes a chapter** must say which scope it means: unread counts, search, the push worker's audience, the bookmark list. Like school-layer's tenant-kind filter, each gets a scope filter or a recorded reason (derived; the full list is the build PR's first step).

**Rules.**
- **Who can join `#campus`:** verified school members with status `member`. PNMs and alumni can't, by default.
  - PNMs, because a council's recruitment rules usually limit contact between chapters and PNMs, and an open campus chat is exactly where a dirty-rush message would go. The recruitment spec's quiet period can't be enforced in an open room.
  - Alumni, because the campus is for students now there. A council can open a separate alumni channel.
  - Both are council settings later; the default is closed.
- **Interest channels are requested, not created freely.** Any verified `member` can request a channel with a name and a one-line purpose. A campus moderator approves it, and the requester becomes its first channel moderator. A school holds at most 30 interest channels, and one with no message in 60 days is archived. Discord Student Hubs show what happens without this: hubs fill with one-person and off-topic servers, which users asked Discord to let them moderate ([community request](https://support.discord.com/hc/en-us/community/posts/12675524201751-Student-Hub-Moderation), unverified).
- **Joining is opt-in.** Nobody is added to a campus channel automatically, and leaving is always allowed. A campus channel never counts toward the chapter's unread badges.
- **Every message shows the sender's chapter** beside their name, or "No chapter" for a member without one, and never their chapter role unless they chose to show it ([§ 4](#4-school-directory)).

### 2.4 Comparable products

| Product | How the school space works | What we take |
|---|---|---|
| **Discord Student Hubs** | A school-email-verified directory of student-run servers. Not run by the school; Discord Trust & Safety investigates reported hubs ([parents' guide](https://discord.com/safety/360044149591-answering-parents-and-educators-top-questions), [help](https://support.discord.com/hc/articles/4407546283031)) | Verify by school email; the platform stays the moderator of last resort |
| **GroupMe Campus** | A school's directory of groups, gated by a school-email PIN, independent of the college. Version 16 added a campus directory, groups and events in one place, with search by class year and major ([help](https://support.microsoft.com/en-us/GroupMe/what-is-groupme-campus), [v16 blog](https://groupme.com/blog/v16)) | Campus events beside campus groups; directory filters |
| **Fizz** | One anonymous feed per campus, school email required; about 15 student moderators per school vote on reports, two of three deciding ([Fizz guide](https://fizzsocial.app/Blog/a-quick-guide-to-fizz-moderation), [Rice Thresher](https://www.ricethresher.org/article/2025/09/fizz-users-and-moderators-talk-fame-challenges)) | Peer moderation that needs more than one moderator |
| **Yik Yak** | One feed per area; a post at −5 votes is removed, reports go to a moderation team, and naming other students is banned ([Community Guardrails](https://yikyak.notion.site/Community-Guardrails-2fd5f5274f30415784956efbdf986f1b)) | An automatic hide on enough independent reports, pending a human |
| **Slack Connect** | Channels shared between organizations; each side's admins govern their own members (background) | A space no single chapter owns |

## 3. Messages between chapters

This answers #3740 ("message members of other chapters") and #3719 ("reach a role at another chapter"), within one school. Messages across schools aren't proposed.

### 3.1 Requests

**The first message to someone outside your chapters is a request (C4).** It lands in the recipient's **Requests**, not their DM list, and shows:
- the sender's name, photo, school and chapter, with the *Verified at RPI* mark;
- the role they're writing as, if they're writing to a role (below);
- the first message, up to 500 characters, with no attachments and no links shown as links.

The recipient picks one:
- **Accept.** The request becomes a school-scoped DM (C2) in both people's lists, under "Other chapters". Either person can now message freely.
- **Ignore.** The request leaves their list. The sender isn't told and still sees it as sent. The sender can't request this person again for 30 days.
- **Block** ([§ 5.4](#54-block)). Also ignores the request, and the sender can't tell the difference.
- **Report** ([§ 5.3](#53-report)). Files a report and offers Block.

**No request is needed** between people who already share a chapter or a council (they use today's chapter-scoped DM), or who are both in a campus channel and one replies to the other's message there. A reply in a channel is public anyway; a DM still needs a request.

**Who may send one.**
- Verified school members with status `member` or `staff`. PNMs and alumni can't send requests by default; a PNM writes to a chapter through its interest form, which the recruitment spec owns.
- **Each person chooses who may request them**, in `/me` → Privacy: *Anyone at my school* (the default for officers who publish a role contact), *People in my councils' chapters*, or *Nobody*. With *Nobody*, they can still be reached through a role contact if they hold one.

### 3.2 Writing to a role ("Pi Phi social chair")

#3719's case: an officer at one chapter needs whoever holds a job at another, without knowing who that is this semester.

- **A chapter publishes role contacts.** An officer with `chapter-config:manage` picks which of its roles appear on campus (say *Social chair*, *Philanthropy chair*, *Recruitment chair*, *President*), and the label they appear under. That's a push-up (C3): campus pages read the published list, never the chapter's roles table.
- **The holders opt in once.** A member holding a published role is asked "Your chapter lists *Social chair* on the RPI campus. People from other chapters can send requests to it." with *OK* and *Don't route to me*. A role with no opted-in holder shows as "No one available" rather than disappearing.
- **A request to a role** goes to every opted-in holder, as one request with the role named: "From Alex Chen (Sigma Chi), to Pi Beta Phi · Social chair". The first holder to accept owns the conversation, and the others see "Accepted by Jordan". Nobody outside the chapter learns who the holders are until one accepts.
- **When the role changes hands**, an open request moves to the new holders. An accepted DM stays between the two people; the role was the introduction, not a shared inbox.
  - *Alternative considered:* a shared role inbox the next holder inherits, like a team email address. Rejected for now, because it turns a person's DM history into chapter data on handover; a later "role channel" could do it deliberately.

### 3.3 Limits

| Limit | Value (proposed) | Why |
|---|---|---|
| New requests a person can send | 10 a day, 30 a week | A request is an interruption; this is enough for an officer coordinating a mixer |
| Requests to one chapter's role | 3 a week from one person | Stops one person hammering a single officer |
| After Ignore | 30 days before the same pair again | The ignore must mean something, without being a permanent oracle |
| Accounts verified less than 24 hours ago | Can't send requests | A new account is the usual spam vector (Discord's verification levels do the same with account age, [guide](https://www.howtogeek.com/873251/how-to-protect-your-discord-server-from-spam-and-attacks/), unverified) |
| Requests ignored or blocked | 5 of the last 10 ignored or blocked pauses sending for 7 days | A sender most people refuse is sending something unwanted |

A refused send tells the sender plainly and with the limit: "You've sent 10 requests today. You can send more tomorrow." That is a limit on the sender's own volume, so it reveals nothing about any recipient.

### 3.4 Officers and outside conversations

- **No officer can read a member's DMs with another chapter.** That's already true of every DM today ([`chat/README.md` § Officer action](chat/README.md#officer-action-removing-a-reported-message)), and a cross-chapter DM belongs to neither chapter.
- **A report on a cross-chapter DM goes to the campus queue** ([§ 5.2](#52-who-moderates)), not to either chapter's queue, because either chapter's officers would be judging their own brother.
- **Leaving a chapter** keeps a person's cross-chapter DMs: they're school-scoped, and school membership stays. **Leaving the school** (`left_at` set) archives them, readable by id but closed to new messages.

### 3.5 Comparable products

| Product | First contact | What we take |
|---|---|---|
| **Slack Connect DMs** | The sender invites by email; the recipient accepts, ignores, or blocks, and a block stops future invitations from that email ([help](https://slack.com/help/articles/1500001422062)) | Accept / ignore / block; an ignore isn't announced |
| **Discord message requests** | DMs from non-friends go to a Requests folder that shows shared servers, with Accept and Ignore and a Spam tab ([help](https://support.discord.com/hc/articles/7924992471191)) | Show the context the two people share (school, chapter) on the request |
| **Instagram message requests** | Messages from people you don't follow wait in Requests; the sender doesn't see "Seen" until accepted (background) | The sender can't tell whether the request was read |
| **GroupMe Campus** | Search verified students at your school and add them, filtered by class year and major ([v16 blog](https://groupme.com/blog/v16)) | Not taken: adding without a request is what #3740 asks us to avoid |

## 4. School directory

### 4.1 Who appears, and how

**Hidden by default (C5).** School-layer's `school_members.directory_visibility` is `hidden`, `officers` or `school`, defaulting to `hidden`. This doc fixes what each level means:

| Level | Who can find you | Shown |
|---|---|---|
| `hidden` (default) | Nobody by browsing. People in a campus channel with you see your name and chapter there | — |
| `officers` | Officers of other chapters and councils at your school: members holding a published role contact or any council role | Name, photo, chapter, class year, published roles you hold |
| `school` | Every verified `member` and `staff` at the school | Same |

- **Never shown in the directory:** email, phone, chapter-private profile fields ([`members.md` § Custom Fields](members.md#custom-fields)), and your role in your chapter unless it's a published role contact you opted into.
- **Searching** is by name, chapter and class year. There's no "list everyone" view, and a search returns at most 25 results, so the directory can't be scraped page by page through the app.
- **Message** on a directory card sends a request ([§ 3](#3-messages-between-chapters)), subject to that person's request setting.

**What each status appears as:**

| Status | In the directory? | Elsewhere on campus |
|---|---|---|
| `member` | If they chose `officers` or `school` | Their name and chapter in channels they joined |
| `pnm` | **Never**, whatever the setting | Nowhere outside recruitment. A PNM's existence is recruitment data, owned by the recruitment spec |
| `alum` | Only at `school`, labelled *Alum · class of 2024* | Not in campus chat by default |
| `staff` | Yes, labelled *Frapp staff* | Their moderation actions name them as staff |

**The first-run choice.** When someone first opens campus home, they see the three levels with *Hidden* already selected and a one-line explanation of each. Nothing changes until they pick one. The Privacy page in `/me` holds it after that.

### 4.2 Chapters and their roster

- **A chapter can cap its members' visibility.** A chapter setting, *Campus directory*, with *Members choose* (the default), *Officers only at most* and *Hidden*. A member's effective level is the lower of their own and their chapter's. A member in two chapters takes the lowest cap.
- **Why a cap, not a chapter roster page.** A chapter's roster is chapter data. Under decision 11, the campus never reads it; it reads only the `school_members` rows of people who chose to be listed, plus each one's chapter name, which their chapter published by being placed in the school. A cap lets a chapter that recruits quietly, or one under a council sanction, stay off the campus map without the campus needing its member list.
- **Chapter member counts** aren't shown on campus. A chapter can publish one (*About 80 members*) as part of its campus listing if it wants.

### 4.3 Comparable products

| Product | Directory default | What we take |
|---|---|---|
| **GroupMe Campus** | Verified students are searchable by class year and major ([v16 blog](https://groupme.com/blog/v16)) | Search filters; not its default visibility |
| **Engage / Presence** | Campus admins see every organization; an organization's roster visibility is set by the organization ([Presence](https://involve-support.moderncampus.com/hc/en-us/articles/14706388242061), unverified) | The chapter decides how visible its roster is |
| **Microsoft Teams (Education)** | School Data Sync builds class teams with hidden membership ([docs](https://learn.microsoft.com/en-us/schooldatasync/edu-security-groups), unverified) | Hidden by default for groups below the institution |

## 5. Moderation

### 5.1 What has to be true

App Store Guideline 1.2 asks a UGC app for a way to filter objectionable material, a way to report it with timely responses, a way to block abusive users, and published contact information ([guidelines](https://developer.apple.com/app-store/review/guidelines/); the full current text didn't load, so this list comes from search summaries and is unverified). Google Play asks for terms the user accepts before creating UGC, moderation fit for the kind of UGC, and in-app tools to report users and content and to block users ([Play policy](https://support.google.com/googleplay/android-developer/answer/12923286), unverified).

Frapp already answers 1.2 inside a chapter ([`chat/README.md` § Report and block](chat/README.md#report-and-block), #2257): report, chapter-scoped block, officer removal of a reported message, the Terms' zero-tolerance clause, and Paul's decision (2026-09-28) that **nothing screens a message before it posts** ([§ No pre-post content filter](chat/README.md#no-pre-post-content-filter)). Campus spaces are a new surface with a wider audience, so each control is restated for them:

| Requirement | Inside a chapter (today) | On campus (this design) |
|---|---|---|
| Accept terms before posting | The Terms checkbox before a membership is created ([`legal.md`](legal.md)) | Verifying a school email doesn't create a chapter membership, so **campus verification asks for the same acceptance** if the person hasn't accepted the current version |
| Filter | The Terms, report, block and officer removal; no pre-post filter | The same, **plus** the automatic hide on independent reports ([§ 5.3](#53-report)) and new-account limits ([§ 5.6](#56-rate-limits-and-new-accounts)). Still no pre-post content filter (Paul, 2026-09-28) |
| Report | Per-chapter officer queue | Campus queue ([§ 5.2](#52-who-moderates)) with a 24-hour escalation to staff |
| Block | Chapter-scoped, silent | Person-level on campus surfaces, silent ([§ 5.4](#54-block)) |
| Contact information | `team@frapp.live` and `frapp.live/support` in the store listing (`apps/mobile/store/README.md`) | Campus home's footer and every moderation notice link to the same support page |

**Whether campus spaces change Paul's no-filter decision is his call** ([Q3](#9-open-questions-for-paul)). His reason was that swearing is normal in a chapter's own chat. A campus feed and open chat are read by strangers, PNMs included for the feed, so the case is different. This design proposes no word filter, and relies on the auto-hide and new-account limits instead.

### 5.2 Who moderates

**Campus moderators (C6).** A council member holding `council:campus_moderate` in a **verified** council at the school. School-layer reserves the key; this doc defines it:

| Key | Grants |
|---|---|
| `council:campus_post` | Post to the campus feed, pin the council's own posts, edit or delete the council's posts |
| `council:campus_moderate` | Work the campus report queue, remove reported content, time people out of campus spaces, approve interest channels, propose a campus ban |

- **Both keys seed on the council's Executive board tier** and can be moved like any key. Neither is explicit-grant: a council's `*` admin holds them.
- **Every verified council at a school moderates the whole school's campus spaces,** not just its own posts. At a school with an IFC and a Panhellenic council, both sets of moderators see one queue. A school with no verified council on Frapp has no campus chat, no interest channels and no cross-chapter DMs; its feed shows staff posts only, and its reports go straight to staff.
- **Frapp staff** moderate every school, with the same actions plus account-wide ones. Frapp has no staff tooling today (no staff role or admin console turned up in `apps/api/src` or the migrations, derived), so a staff moderation queue is a build item of this design, and someone at Frapp has to own it ([Q2](#9-open-questions-for-paul)).
- **Channel moderators.** The requester of an interest channel moderates it: they can remove messages in it and time people out of it, not out of the campus. Any campus moderator outranks them.

**Conflicts of interest.** Council officers are brothers and sisters in competing chapters (the recruitment spec's reason for hiding interests in season). So:
- **A moderator can't act on a report about themselves** (today's chapter rule), **nor on one about a member of their own chapter.** Those reports are hidden from them and answer 404, the same as a report that doesn't exist.
- **Removal and a timeout up to 24 hours** take one moderator.
- **A longer timeout or a campus ban** takes a proposal by one moderator and approval by a second **from a different chapter**, or by staff. Fizz's two-of-three vote is the model ([Fizz guide](https://fizzsocial.app/Blog/a-quick-guide-to-fizz-moderation), unverified). A proposal no one approves within 72 hours goes to staff.
- **Moderators see who wrote the reported content.** Fizz hides authors from its moderators because Fizz is anonymous; Frapp's campus isn't, so hiding the author would hide nothing. The **reporter** is never shown to anyone, as today.

### 5.3 Report

Everything in [`chat/README.md` § Report](chat/README.md#report) holds for campus chat and cross-chapter DMs, with the campus queue in place of the chapter queue: report as a read, filed as the caller, an evidence snapshot with held attachments, one open report per person per message, one-way resolution, the reporter never disclosed, and report-scoped removal that never opens a DM.

What's new:
- **What can be reported:** a campus feed post, a campus chat message, a cross-chapter DM message or request, a directory profile (photo or name), an interest channel itself (its name and purpose), and a published campus event.
- **Reasons**, picked from a list: harassment or bullying, hate, sexual content, threats or violence, spam or scams, personal information shared without consent, hazing, impersonation, and other. *Hazing* and *threats* go to the top of the queue and also notify staff at once.
- **Automatic hide on independent reports.** When three different verified school members, from at least two different chapters, report the same campus message or post within 24 hours, it's hidden from everyone but its author, marked *Hidden while moderators review it*, until a moderator decides. A report from someone the author has blocked, or from someone in the author's own chapter, doesn't count toward the three. That's Yik Yak's community-vote removal ([Guardrails](https://yikyak.notion.site/Community-Guardrails-2fd5f5274f30415784956efbdf986f1b), unverified) without letting one chapter brigade another. DMs are exempt: a DM has one other reader.
- **Timely response.** A campus report not resolved within 24 hours escalates to the staff queue, and the reporter sees "Frapp is reviewing this" in place of "Moderators are reviewing this". Apple asks for "timely responses"; 24 hours is a proposed number.
- **The reporter hears the outcome:** "We removed the message you reported" or "We reviewed the message you reported and left it up", never who decided or what happened to the author.

### 5.4 Block

**A campus block is person-level (C7).** Today's block is scoped to one chapter ([`chat/README.md` § Block](chat/README.md#block)), keyed on user ids in `chat_member_blocks`. A campus surface belongs to no chapter, so it needs a block that does:

- **Scope.** A block made from a campus surface (a campus message, a request, a cross-chapter DM, a directory card) applies to every campus surface at every school, and to cross-chapter DMs. It does **not** change chapter-scoped blocks, and a chapter-scoped block doesn't reach campus surfaces.
- **When the two people also share a chapter,** the block sheet adds one checkbox, ticked by default: "Also block in Phi Gamma Delta." That writes today's chapter-scoped block too, so blocking someone on campus doesn't leave them in your chapter's chat unexpectedly.
- **Silent, as today.** The blocked person isn't told and can't find out. Their request "sends"; their DM "sends"; nothing arrives. They still see the blocker's feed posts and campus messages, because hiding those from them would also be an oracle. They can't find the blocker in the directory, which is indistinguishable from the blocker being hidden.
- **What it hides from the blocker:** the blocked person's campus messages (tombstoned as today), requests, DMs, reactions, directory card, and their RSVPs in an event's "who's going". It doesn't hide a council feed post they wrote as an officer, because that speaks for the council; the blocker can report it.
- **Undo** is in `/me` → Blocked people, one list with a label on each row: *Campus* or *Phi Gamma Delta*.
- **Storage:** a new `user_blocks(blocker_user_id, blocked_user_id, created_at)` with RLS on and **no policies**, the same reason `chat_member_blocks` has none: a "read your own blocks" policy is one edit from telling an abuser who blocked them.
- **The masking contract** ([§ The masking contract](chat/README.md#the-masking-contract)) applies unchanged to school-scoped channels: the server masks, the client applies its own list, and a list that can't be read holds rather than shows.

*Alternative considered:* make every block person-level, everywhere. That's simpler for members and is what Discord and Instagram do, but it reverses a recorded chapter rule ("blocking someone in one chapter says nothing about another chapter they may both belong to"), so it's [Q4](#9-open-questions-for-paul), not this design's default.

### 5.5 Actions and the record

| Action | Who | Effect |
|---|---|---|
| Remove | One campus moderator, or a channel moderator in their channel | The message or post is soft-deleted, as an officer's removal is today |
| Timeout | One moderator for up to 24 hours; two (different chapters) or staff for 3 or 7 days | No posting, reacting or requests on campus. Reading stays |
| Campus ban | Two moderators (different chapters) or staff | No campus access at that school except the feed and events. Chapter memberships are untouched |
| Account action | Staff only | Suspension or deletion under the Terms, across Frapp |

- **Every action is logged** in an append-only campus moderation log: who acted, on what, the reason, and the report it answered. Every campus moderator at the school and staff can read it. Nobody can edit or delete a row.
- **The person acted on is told**, in-app: what was removed or what restriction applies, the guideline it broke, when it ends, and *Appeal*. The notice names the action as "RPI campus moderators" or "Frapp", never the officer.
- **A chapter is never told** that its member was moderated on campus. That would put campus discipline into chapter politics. A council's judicial process, if it wants to act on conduct, is its own part of #4192.

### 5.6 Rate limits and new accounts

| Surface | Limit (proposed) |
|---|---|
| Campus chat, everyone | Slow mode of 5 seconds per person per channel; a moderator can raise it to 2 minutes during a pile-on |
| Campus chat, verified less than 72 hours ago | Slow mode of 30 seconds; no links or attachments |
| Feed posts | 5 a day per council; at most 2 of them pushed ([§ 7](#7-notifications)) |
| Interest channel requests | 1 open request per person |
| Reports | 20 a day per person, so the queue can't be flooded; beyond that a report files silently without counting toward an auto-hide |
| DM requests | [§ 3.3](#33-limits) |

Discord's slowmode and verification-level account-age gates are the model ([guide](https://www.howtogeek.com/873251/how-to-protect-your-discord-server-from-spam-and-attacks/), unverified). Every limit is enforced server-side; a client that skips its own check gets a `429` with the limit named.

### 5.7 Appeals

- **One appeal per action**, from the notice, within 14 days, with up to 1,000 characters.
- **Reviewed by someone who didn't act:** a campus moderator from a third chapter, if there is one, else staff. A ban's appeal always goes to staff.
- **Answered within 7 days** (proposed). An appeal not answered in 7 days goes to staff.
- **Staff's answer is final.** The person is told the outcome and, if it's reversed, the content comes back and the restriction lifts.

### 5.8 Comparable products

| Product | Moderation | What we take |
|---|---|---|
| **Fizz** | Per-campus student moderators vote on reports; two of three decide; moderators don't see authors or each other ([Fizz guide](https://fizzsocial.app/Blog/a-quick-guide-to-fizz-moderation), [Fizz community moderation](https://fizzsocial.notion.site/Community-Moderation-at-Fizz-9af4aa46859b4d7ba470a3be926e3d92), unverified). Student papers report inconsistency across campuses ([Daily Northwestern](https://dailynorthwestern.com/2025/01/30/campus/fizz-builds-community-sparks-debates-over-content-moderation)) | Two moderators for anything serious; a platform layer above campus moderators |
| **Yik Yak** | Community downvotes remove a post at −5; reports go to a moderation team; one strike for serious violations ([Guardrails](https://yikyak.notion.site/Community-Guardrails-2fd5f5274f30415784956efbdf986f1b), unverified) | Automatic hide on independent reports, pending a person |
| **Discord** | Each server moderates itself; AutoMod, slowmode and verification levels; Trust & Safety investigates reported Student Hubs ([AutoMod](https://discord.com/moderation/1500000178701-321:-Auto-Moderation-in-Discord), unverified) | Slow mode, new-account limits, platform escalation |
| **Slack Connect** | Each organization's admins govern their own members in a shared channel (background) | Not taken: on campus, no chapter should judge another's member alone |

## 6. Campus events

### 6.1 Publishing

**Push-up only (C3).** The campus calendar never reads a chapter's `events` table.
- **A chapter publishes an event.** An officer with `events:update` turns on *Show on RPI campus* on one of the chapter's events. That writes a `campus_events` row with the fields it publishes: name, start and end, location, description, cover image, and audience. Editing the chapter's event re-pushes those fields. Turning it off, or deleting the event, withdraws the campus copy.
- **A council publishes the same way,** from its own events (it has them as a tenant). The recruitment spec's season dates appear on the campus calendar as all-day markers the council publishes.
- **What isn't published:** the chapter's attendance, points, check-in zone, role gates, notes and minutes. An event that limits its audience inside the chapter (`others_invited = false`, or excluded roles) **can't be published**, for the same reason it can't post a chat card ([`events.md`](events.md)): its details aren't meant for everyone.
- **Audience** on campus: *Everyone at RPI*, *Members* (no PNMs), *PNMs* (only for an event the chapter marked *Open to PNMs*, which the recruitment spec owns, and only outside the council's quiet period), or *Invited chapters* (a mixer: the publishing chapter names the chapters, and only their members see it).

### 6.2 RSVP across chapters

- **A campus RSVP is its own record,** `campus_event_rsvps(campus_event_id, user_id, status)`, with Going and Maybe. It's not a chapter attendance row: chapter check-in awards points ([`events.md`](events.md)), and someone from another chapter isn't a member. Chapter events have no RSVP yet either: "RSVP intent … is not yet modelled" ([`events.md`](events.md)).
- **The host sees who's going.** RSVPing is the person's own action toward the host (as an interest form is), so the publishing chapter or council sees the names and chapters of people who RSVP'd, and a count. Other attendees see only the count, plus friends from their own chapter who RSVP'd.
- **Capacity.** The publisher can set a cap; RSVPs past it join a waitlist that moves up automatically.
- **Members of the publishing chapter** RSVP on the chapter event itself, as they would anyway, and the campus count adds them.
- **Reminders** go only to people who RSVP'd Going ([§ 7](#7-notifications)).

### 6.3 Comparable products

| Product | Campus events | What we take |
|---|---|---|
| **GroupMe Campus** | v16 brings campus events beside groups and the directory ([v16 blog](https://groupme.com/blog/v16)) | Events live on the campus home, not in a separate app |
| **Engage / Presence** | Organizations post events to a campus calendar; students RSVP (background) | A chapter's event published to campus keeps its own owner |
| **Discord** | Scheduled events per server, with "Interested" counts (background) | A count everyone sees; names only for the host |

## 7. Notifications

### 7.1 What makes a sound

| Campus activity | Push | In-app row | Badge |
|---|---|---|---|
| Council feed post, school-wide | NORMAL, at most 2 per council per day; the rest in-app only | Yes | Campus row in the switcher |
| Staff safety notice | URGENT, only for a real safety issue, staff only | Yes | Yes |
| Your post or message was removed, or a restriction | NORMAL | Yes | Yes |
| A DM request to you or a role you hold | NORMAL, one per request; a second request from the same person in the window doesn't push | Yes | Requests count |
| A DM in an accepted cross-chapter conversation | Same as a chapter DM today | Same | Same |
| An @-mention or a reply to you in campus chat | NORMAL | Yes | Yes (red: it addresses you) |
| Other campus chat messages | None by default | No | None; a campus channel with unread shows bold, never a count |
| Campus event published | None | No | None |
| Campus event you RSVP'd Going to | Reminder, as chapter events | Yes | — |
| Campus reports, to moderators | NORMAL, content-free, as chapter reports today | Yes | Yes |

- **Campus pushes are never URGENT (C8)**, except a staff safety notice. Chapter announcements push URGENT and ring through quiet hours ([`chat/README.md` § Announcements](chat/README.md#announcements)). A school with three councils doing the same would teach everyone to turn Frapp off.
- **Quiet hours and Do Not Disturb apply** to every campus push, as to every NORMAL push ([`notifications.md` § Quiet Hours](notifications.md#quiet-hours)).
- **A blocked person never causes a push** to the blocker, as today.

### 7.2 The inbox and the switcher

- **Campus is one space in `GET /v1/me/unread`** (ADR-27), counted beside each chapter and council: unread feed posts since your last visit, pending requests, mentions and replies, and unread cross-chapter DMs. The UI design's switcher shows it on the School row.
- **The red crest dot** stays for "you were addressed": a request, a mention, a reply, a DM, a moderation notice. A new feed post adds to the campus row's count but never lights the red dot.
- **Notifications stay one inbox** across spaces, each item naming its space (UI part 2). Campus items read "RPI campus" or the council's name.

### 7.3 Settings

- **A new notification category, `campus`,** in the shared catalog (`NOTIFICATION_CATEGORIES` in `@repo/validation`, [`notifications.md` § Preference sync](notifications.md#preference-sync)), with three switches: *Council posts*, *Requests*, *Campus events*. All on by default.
- **Campus preferences belong to the person, not a chapter.** Today's preferences are chapter-scoped and refuse a `chapter_id` the caller isn't in. Campus preferences are keyed on the school, checked against `school_members`, so a member who leaves their chapter keeps them.
- **A weekly campus digest** (SILENT, in-app) is a later option, for people who turn council posts off.

### 7.4 Comparable products

| Product | Notification model | What we take |
|---|---|---|
| **Discord** | Large servers default to "@mentions only"; message requests badge without a normal DM notification ([help](https://support.discord.com/hc/articles/7924992471191), unverified) | Campus chat defaults to mentions only |
| **Slack** | Channels you didn't join don't notify; Slack Connect invitations surface once (background) | One push per request |

## 8. Phasing

The recruitment spec's MVP is the pipeline, forms, the master list, eligibility, the council season and the PNM's own view. Campus spaces ride along only where the IFC needs them, so the MVP is small.

| Phase | Ships | Depends on |
|---|---|---|
| **IFC MVP** | The campus feed (council posts, pins, audiences); *Share in #announcements* from a council post; campus events, published by councils (season dates, kickoff) and by chapters, with campus RSVP; the `campus` notification category and the campus row in `/v1/me/unread`; report and person-level block on feed posts and campus events; the staff queue | School-layer phases 1–2 and ADR-27; a verified council |
| **Campus 1** | School-scoped chat channels (C2); `#campus`; the campus report queue, auto-hide, timeouts, the two-moderator ban, appeals and the moderation log; slow mode and new-account limits | IFC MVP; Paul on [Q2](#9-open-questions-for-paul) and [Q3](#9-open-questions-for-paul) |
| **Campus 2** | Cross-chapter DM requests; role contacts (#3719); the school directory with chapter caps | Campus 1, because requests and DMs need its moderation |
| **Later** | Interest channels; council channels to the campus; the weekly digest; threads under feed posts | Campus 2, after a season of real moderation load |

**Why not chat in the MVP.** Campus chat and DMs between chapters are the part with real harassment risk, and the part App Review probes. They need the whole moderation stack (a queue, a second moderator, appeals, staff escalation) before they open, and nothing in the IFC's recruitment flow needs them. The feed and events need far less: their authors are council officers acting under their council's name.

**What the MVP still has to get right for App Review.** A feed post and a campus event are UGC. Both need Report on every item and Block on the author, the staff queue behind them, and the Terms accepted at campus verification. Without those, the MVP fails 1.2 on day one.

## 9. Open questions for Paul

⚑ marks a raise-first item (AGENTS.md § ADR discipline: security, legal or App Store copy, production, removing a feature). Nothing on it is built until Paul says go.

1. **Q1 Accept the shape?** A campus feed in the MVP; campus chat and cross-chapter DMs as school-scoped channels later; requests to reach another chapter. This also answers #3719 and #3740, which are yours and parked.
2. **Q2 ⚑ Frapp staff as moderators of last resort.** Someone at Frapp has to own a staff queue with a 24-hour response for escalated campus reports, threats and hazing reports, and every ban appeal. No staff tooling exists. Who owns it, and is 24 hours a promise Frapp can keep?
3. **Q3 ⚑ Does the no-pre-post-filter decision (2026-09-28) extend to campus spaces?** This design keeps it, adding automatic hide on independent reports and new-account limits. The App Review note would need a campus line either way.
4. **Q4 Person-level blocks everywhere?** This design adds a campus block and leaves chapter blocks as they are, with a checkbox to block in a shared chapter too. The simpler alternative makes every block person-level, which reverses the chapter-scoped rule in `chat/README.md` § Block.
5. **Q5 ⚑ Under-18 PNMs on campus.** The Terms say 18+ (#2261), and the recruitment spec already flags 17-year-old first-years. This design keeps PNMs out of campus chat, requests and the directory, but they read the feed and campus events. Is that enough, or must campus verification also confirm 18+?
6. **Q6 Staff safety notices as URGENT.** The only campus push that rings through quiet hours. Keep it, or drop URGENT on campus entirely?
7. **Q7 Moderators' own chapters.** This design hides reports about a moderator's own chapter from them. At a small school with one council of four officers from four chapters, that's fine; at a school whose whole IFC board is from two houses, it may leave reports with only staff. Acceptable?

**Raised to the hub for the sibling designs** (not Paul's):
- School-layer's `council:announce` reaches chapters' council contacts. This doc adds `council:campus_post` and defines `council:campus_moderate`; the permission table in `school-layer.md` § 5.1 should gain them when both are accepted.
- `chat_channels.school_id` is a schema change to a chat table, which school-layer's § 9 doesn't list.

## 10. Specs this would change

If Paul accepts this, the PR that builds each part rewrites these in the same change:

| Spec | What changes |
|---|---|
| [`chat/README.md`](chat/README.md) | Channels gain the school scope; DMs gain requests and the cross-chapter kind; Report and block gain the campus queue, auto-hide and the person-level block |
| [`notifications.md`](notifications.md) | The `campus` category; campus preferences keyed on the school; the campus caps |
| [`events.md`](events.md) | *Show on campus*, and campus RSVP beside chapter attendance |
| [`members.md`](members.md) | The chapter's campus directory cap and published role contacts |
| [`legal.md`](legal.md) | Terms acceptance at campus verification |
| [`data-retention.md`](data-retention.md) | Account deletion and leaving a school: person-level blocks, campus RSVPs, requests and the moderation log |
| [`multi-tenancy.md`](multi-tenancy.md) | School-scoped channels are the second named exception to chapter scoping, beside school-layer's |
| `apps/mobile/store/README.md` § Review notes | A campus line in the 1.2 answer |
