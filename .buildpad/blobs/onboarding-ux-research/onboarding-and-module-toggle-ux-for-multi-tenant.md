# Onboarding design for Signet: a concrete wizard, bulk-invite, and member first-run flow

**The evidence points to one clear answer: Signet should copy the *consumer/community* onboarding model (Discord, OurHouse, GroupMe) for members and the *lightweight team-SaaS* model (Linear, ClickUp ClickApps) for the admin, not the enterprise model (CSV roster import, SSO, granular permission matrices).** For a 60–150-person chapter, the single highest-leverage decision is to invite the roster with **one reusable join code/link that members self-redeem**, rather than importing a CSV of 60+ emails and provisioning accounts. Every consumer product that onboards large groups easily — the exact bar the command sets ("as easy as joining a Discord server") — uses a shareable link, and the leading fraternity app OurHouse already uses a chapter code where "all of your members will register their personal accounts using this Chapter Code" [alphachirho](https://www.alphachirho.org/wp-content/uploads/2019/03/OurHouse-Executive-Board-Guide-.pdf). The admin setup wizard should be **three real steps** (identity → modules → invite), with module on/off handled as sensible-default toggles that are changeable later — modeled directly on ClickUp's ClickApps. Almost everything else the enterprise products do (CSV import, per-role permission matrices, Discord-style self-select onboarding questions, SSO/SCIM) is **overkill for a two-week single-chapter beta and should be deferred to the multi-chapter/national-org phase.**

---

## 1. How the admin (workspace/tenant) creation wizard should work

### What the best products actually do

The strong products converge on a short wizard that reaches a usable workspace fast and defers everything non-essential. **Slack's signup is a "3-step" flow that asks only the three most important things: who you are, what your team does, and who's in it** [userguiding](https://userguiding.com/blog/slack-user-onboarding-teardown). **Notion asks a single upfront question — "How do you want to use Notion?" — and that one answer determines which templates appear, what the sidebar looks like, and which checklist items surface** [supademo](https://supademo.com/blog/how-to-design-an-effective-onboarding-flow). **Linear auto-generates a default team with the same name as the workspace**, so the workspace is immediately usable without a separate "create your first team" step [linear](https://linear.app/docs/teams). **Asana asks the user to choose their role/function, then uses that to pick a recommended template** [medium](https://medium.com/@strana/never-miss-a-deadline-step-by-step-onboarding-process-in-asana-for-individuals-and-teams-cfb4b9f0c46c), and **Airtable ships a base pre-populated with example records so a usable workspace exists in "10 minutes"** [airtable](https://www.airtable.com/guides/start/how-to-create-a-base).

The best-practice guidance is unusually consistent and gives you hard numbers to design against:
- **Keep the minimal path to value to 3–5 essential steps**, use progressive disclosure for advanced features, and add a "skip for now" on non-critical setup [supademo](https://supademo.com/blog/how-to-design-an-effective-onboarding-flow).
- **2–4 onboarding questions immediately after signup is the sweet spot** for understanding role/use-case without it feeling like a form [appcues](https://www.appcues.com/blog/saas-user-onboarding).
- **Require only what the system genuinely needs; defer optional details and secondary preferences until they're relevant** [trevorcalabro](https://trevorcalabro.substack.com/p/onboarding-and-in-app-help-strategy). A wizard is appropriate *only* when the task needs a clear required sequence, and should never "force optional configuration or present every available feature at once" [trevorcalabro](https://trevorcalabro.substack.com/p/onboarding-and-in-app-help-strategy).
- The canonical anti-pattern to avoid: **a setup wizard where value arrives only at step five** (name workspace → invite → connect data → configure → finally see it work); the fix is to defer nonessential setup so the product shows partial value earlier [celvix](https://celvix.co/blog/saas-onboarding-ux-teardown/).

### Recommended Signet admin wizard: three steps

Give the president a wizard with exactly three steps, then drop them into a working chapter:

**Step 1 — Chapter identity (ask upfront).** Chapter/organization name, school, and the single accent color. This is the equivalent of Slack's "who you are." The accent color feeds the theming system you already specced. Keep it to these fields — this is the only unavoidable data.

**Step 2 — Modules (sensible-default toggles, changeable later).** Present Signet's six modules as toggles with defaults pre-set, exactly like ClickUp's ClickApps model, where **"some ClickApps are activated by default"** and the setup flow tells users **"if you're not sure yet which ones you'll need, you can add or edit the default ClickApps later"** [clickup](https://help.clickup.com/hc/en-us/articles/10636005013271-Set-up-your-team-s-Workspace-from-scratch). Recommended defaults:
  - **Chat: on, locked** (this is the free base tier and the Discord-replacement core).
  - **Events + QR attendance, Points/tasks, Backwork: on by default** (zero config needed to be useful).
  - **Study hours + geofencing: off by default** — it requires the president to draw geofence locations, so turning it on should trigger that config *when they choose it*, not block the wizard.
  - **Dues/billing: off by default** — it requires Stripe Connect setup and bank details, which is the classic "step 5" trap. Turning it on later opens dues config.

  Frame this as "You can turn any of these on or off anytime in Settings" — every product studied (Linear opt-in modules in team settings [linear](https://linear.app/docs/teams), ClickUp ClickApps [clickup](https://help.clickup.com/hc/en-us/articles/6304327753111-Intro-to-ClickApps), Monday "fully customizable… anytime" [monday](https://support.monday.com/hc/en-us/articles/360001362625-monday-com-templates)) makes the "change later" promise explicit, which is what lets you present defaults without fear.

**Step 3 — Invite the chapter (generate the join code/link).** Show the reusable join code + link and a "share" action. This is the payoff step and should be the *last* thing, not buried mid-wizard.

**Explicitly defer (do not put in the wizard):** Stripe/dues configuration, geofence drawing, points rules and values, channel structure beyond 2–3 auto-created defaults, and any role customization beyond a fixed President / Officer / Member set. Each of these has a natural in-context entry point (opening the module) that follows the "defer until relevant" rule [trevorcalabro](https://trevorcalabro.substack.com/p/onboarding-and-in-app-help-strategy).

**Do not build for the beta:** per-use-case *chapter templates* (the Notion/Asana "pick a template" model) — with one org type you have nothing to template yet; this belongs in the multi-chapter phase where a "Fiji chapter" preset becomes valuable.

---

## 2. Module enable/disable: toggles with defaults, not a permission matrix

The command asks how admins turn optional features on/off without being overwhelmed. The dominant safe pattern is **owner/admin-only toggles, some enabled by default, changeable anytime** — ClickUp restricts ClickApp activation to "workspace owners and admins" while members and guests cannot [clickup](https://help.clickup.com/hc/en-us/articles/6304327753111-Intro-to-ClickApps), and Linear marks specific modules (Triage, Cycles) as opt-in that "need to be enabled in team settings" [linear](https://linear.app/docs/teams). Note that in every product studied, module toggles live in **settings, not exclusively inside the creation wizard** — Monday, Asana, and Linear all expose these as ongoing admin controls, and only ClickUp surfaces a "decide which to enable" prompt inside setup itself [clickup](https://help.clickup.com/hc/en-us/articles/6309390855319-Create-and-edit-Spaces). 

For Signet this means: the Step 2 toggles and the Settings toggles should be **the same component in two places**. Keep it to a flat list of six on/off switches with a one-line description each. Do **not** build a granular per-role, per-module permission grid for the beta — that is the enterprise pattern (Microsoft Teams guest-permission matrices [microsoft](https://support.microsoft.com/en-us/office/set-guest-permissions-for-channels-in-microsoft-teams-4756c468-2746-4bfd-a582-736d55fcc169)) and is unnecessary complexity when your role set is just President/Officer/Member.

---

## 3. The member invite flow: one reusable join code, not a CSV import

### The landscape splits into two models

**Link/code-based, self-serve (the consumer/community model):**
- **Discord**: tap an invite link to join instantly; links default to 7-day expiry but max-uses can be set to "No limit" for a reusable link [discord](https://support.discord.com/hc/en-us/articles/208866998-Invites-101). This is the friction bar the command names.
- **OurHouse (fraternity-specific)**: officers hand out a **Chapter Code**; every member installs the app and "create[s] your personal account using this Chapter Code" [alphachirho](https://www.alphachirho.org/wp-content/uploads/2019/03/OurHouse-Executive-Board-Guide-.pdf).
- **GroupMe**: invite via a shareable **join link** or phone number, explicitly marketed for "massive groups" [groupme](https://groupme.com/blog/how-to-manage-massive-groups-with-groupme-the-best-large-member-chat-app).
- **Slack**: a reusable invite link works for **up to 400 people and lasts 30 days** [slack](https://slack.com/help/articles/201330256-Invite-new-members-to-your-workspace).

**Email/CSV-based, admin-provisioned (the enterprise/roster model):**
- **Circle**: CSV/Excel bulk import with column mapping, but rate-limited (50/day on trial, up to 1,000/day on paid) [circle](https://help.circle.so/p/audience/onboarding/importing-members-in-bulk).
- **Skool**: CSV import that grants "instant access," recommended in **batches of 500** [skool](https://help.skool.com/article/14-how-do-i-invite-members-to-my-community).
- **Mighty Networks**: email or CSV, but each invite is **one-time-use and expires once that email joins** [mighty](https://docs.mightynetworks.com/for-hosts/payments-and-access/how-do-i-invite-people-to-my-mighty-network).
- **Greekbill** (a cautionary example): roster updates require providing member contact info **to your Greekbill rep** [greekbill](https://greekbillhq.zendesk.com/hc/en-us/articles/14336315779991-FAQ-How-do-we-update-the-roster) — a rep-assisted, high-friction model Signet should not emulate.

### Recommendation for Signet: join code + link for the beta

For a single chapter of 60+ people who are all downloading a mobile app for the first time, **the reusable join code/link is dramatically simpler than CSV import** and matches the exact bar members already know from Discord and OurHouse. Concretely:
- Generate **one reusable, non-expiring chapter join code + link** on wizard Step 3. (Slack proves a single link scales past 400 [slack](https://slack.com/help/articles/201330256-Invite-new-members-to-your-workspace); you need ~150.)
- The president broadcasts it however the chapter already communicates (the existing GroupMe/Discord, group text, at a chapter meeting). Reddit chapter officers confirm the *social* act of getting everyone to switch is the real work, not the technical invite — one described leading a GroupMe→Discord switch, taking "heat from a lot of the older folks/alumni" because "adding ppl on groupme is easier," but "everyone got over it after a year of usage" [reddit](https://www.reddit.com/r/Frat/comments/dncfrj/controversial_replacing_groupme_with_discord/). This tells you to minimize *per-member* friction to the absolute floor.

**Role assignment: default everyone to Member, promote officers after.** Across every product, role is chosen either at invite time (Slack member-vs-guest dropdown [slack](https://slack.com/help/articles/201330256-Invite-new-members-to-your-workspace), Linear "Invite as…" [linear](https://linear.app/docs/invite-members), Notion role dropdown [notion](https://www.notion.com/help/add-members-admins-guests-and-groups)) or after join, but crucially **none of the reusable-link flows reliably encode a role in the link** — Slack, Linear, Discord, and Notion invite links all default new joiners to a base role, with elevated roles assigned separately [slack](https://slack.com/help/articles/201330256-Invite-new-members-to-your-workspace) [linear](https://linear.app/docs/invite-members). So: everyone who redeems the join code becomes a **Member**; the president promotes the handful of officers from the member list afterward. This is far simpler than pre-sorting a roster by role.

**Defer CSV roster import to the multi-chapter/national phase.** It is exactly what Greekly ("import roster from CSV… configure dues… invite officers," "most chapters finish setup in under an hour") [greekly](https://www.greekly-app.com/chapter-management-software) and Greek Connect ("Import your roster by CSV, invite your members… up and running the same day") [getgreekconnect](https://www.getgreekconnect.com/compare/omegafi) offer — and it is genuinely valuable *when onboarding many chapters or migrating from OmegaFi*, because a national org can hand you spreadsheets. For a single beta chapter where the president can drop a link in the existing group chat, building a CSV importer, column-mapper, and email-provisioning pipeline is wasted effort against your two-week deadline.

---

## 4. The invited member's first-run experience

### What good products show a member joining an already-set-up space

The universal pattern is that **the joiner's flow is far lighter than the creator's** — no wizard, straight into content, with auto-joined defaults:
- **Slack** auto-adds new members to configured **default channels** (and always to `#general`, which "can't be changed"), then offers a "Getting started" flow focused on filling out profile → notifications → sending a first message [slack](https://slack.com/help/articles/201898998-Set-default-channels-for-new-members) [slack](https://slack.com/help/articles/218080037-Getting-started-for-new-Slack-users).
- **Discord Community Onboarding** lets members "pick out their own roles and channels" by answering a few questions, producing a personalized channel list rather than dumping them into everything [discord](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ). *But* this is heavy to configure — Discord requires **at least 7 default channels, 5 of which must let @everyone view and post** [discord](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ), and Reddit admins complain about these hard requirements [reddit](https://www.reddit.com/r/discordapp/comments/16jq5bp/need_help_with_onboarding/). **Skip Discord's self-select model for the beta** — auto-join every member to the same 2–3 default channels instead.
- **Mighty Networks** shows a configurable **Welcome Checklist** flyout with items like "Download the App," "Fill Out Your Profile," and "Invite Someone" [mighty](https://faq.mightynetworks.com/en/articles/3825300-how-do-i-set-up-a-welcome-section-and-checklist-for-new-members).

### Empty states and mobile first-open

The member's first screen will be near-empty (a chat with few messages, an events tab with nothing scheduled), so empty-state design is the activation surface. The guidance is firm: **empty states must teach and drive exactly one action — "offer one obvious next action, not three"** [72technologies](https://www.72technologies.com/blog/empty-states-as-onboarding-surface), never "drop your users into a dead-end" [smashing](https://www.smashingmagazine.com/2017/02/user-onboarding-empty-states-mobile-apps/). The "what / why / next" structure (what will appear here, why it's empty, one CTA) is the standard anatomy [design.basis](https://design.basis.com/components/empty-state). If you add a checklist, keep it to **3–5 items tied to activation milestones** with an exit option [appcues](https://www.appcues.com/blog/saas-user-onboarding) [kompassify](https://kompassify.com/blog/how-to-create-a-user-onboarding-checklist).

For mobile first-open, the permission-priming rule is critical and directly relevant to Signet's push and location needs: **do not request device permissions on the splash/first screen — ask in context, only when the feature is first used** [appcues](https://www.appcues.com/blog/mobile-permission-priming), which Android's own guidance echoes ("permission priming at the specific moment of need rather than as a bulk request at the start") [android](https://developer.android.com/design/ui/mobile/guides/patterns/onboarding). This matters because a Clutch study cited by Appcues found **72% of users want onboarding to take under 60 seconds** [appcues](https://www.appcues.com/blog/mobile-permission-priming).

### Recommended Signet member first-run flow

1. **Tap link / enter join code** → app store → open app.
2. **Minimal account creation** — name + phone or email verification. Nothing else. (Every consumer flow prompts account creation only at the point of joining [mighty](https://docs.mightynetworks.com/for-members/explore-mighty/how-do-i-join-a-mighty-network).)
3. **Auto-join** the member to 2–3 default channels (a general/announcements channel plus main chat) — the Slack default-channel model [slack](https://slack.com/help/articles/201898998-Set-default-channels-for-new-members). Do **not** make them self-select.
4. **A one-screen warm welcome** naming the chapter ("You're in — [Chapter Name]"), then land them directly in the main chat.
5. **Permission priming in context**: request push notifications the first time it's genuinely relevant (or with a one-line "so you don't miss chapter announcements" primer), and request **location only the first time the member opens Study Hours** — never both on launch [appcues](https://www.appcues.com/blog/mobile-permission-priming).
6. **Non-blank empty states everywhere**: the chat shows a friendly "Say hi 👋" prompt; the events tab shows "No events yet — your officers will post them here"; each with one obvious action.
7. **Optional lightweight checklist (3 static items max)**: complete profile, post in chat, explore the "Ask" pill. Keep it static — do **not** build a checklist automation engine for the beta.

---

## 5. Beta vs. defer: what's overkill for a two-week single-chapter launch

| Build for the 2-week beta | Defer to multi-chapter / national-org phase |
|---|---|
| 3-step admin wizard (identity → modules → invite) | Per-org **chapter templates/presets** (nothing to template with one org type) |
| Six module on/off toggles with defaults, changeable in Settings (ClickApps model [clickup](https://help.clickup.com/hc/en-us/articles/10636005013271-Set-up-your-team-s-Workspace-from-scratch)) | **CSV roster import** + email provisioning (Greekly/Circle model [greekly](https://www.greekly-app.com/chapter-management-software) [circle](https://help.circle.so/p/audience/onboarding/importing-members-in-bulk)) |
| One reusable join code + link; everyone joins as Member | SSO/SAML/SCIM, guest roles, cross-chapter channels |
| Fixed President/Officer/Member roles; promote officers after join | Granular per-role, per-module permission matrix |
| Auto-join to 2–3 default channels; in-context permission priming; non-blank empty states | Discord-style member self-select onboarding questions (heavy config, hard channel minimums [discord](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ)) |
| Static 3-item welcome checklist | Checklist automation engine, product-tour builder, personalization questions |

The through-line: for the beta, **effort spent on admin-side power features (import pipelines, permission grids, templating) is misallocated** because you have one chapter and one org type. Spend that effort instead on making the *member's* 60-second first-run frictionless, because Reddit chapter officers confirm the hard part of adoption is social buy-in across the roster, not the mechanics [reddit](https://www.reddit.com/r/Frat/comments/dncfrj/controversial_replacing_groupme_with_discord/) — and every second of member friction multiplies across 60–150 people.

One implementation note for the monorepo: the module-toggle component (Section 2), the empty-state component (Section 4), and the join-code redemption flow are the three pieces worth building as clean shared/reusable primitives now, because they are the ones the multi-chapter phase will extend rather than replace — mirroring how the AI-UI research recommended building the "Ask" sheet shell once and swapping only its body later.

---

## Where more research would most change the recommendation

Two areas carry the most residual uncertainty. **First, phone-vs-email verification and deliverability at chapter scale**: the recommendation to verify members by phone (SMS) rests on the assumption that a group of ~60 college students will complete SMS verification faster and with less drop-off than email — plausible given the mobile-first context, but not directly evidenced here, and SMS carries per-message cost implications for a self-funding solo founder that weren't investigated. **Second, whether a single reusable join code creates a security concern for a chapter** (a leaked code letting non-members in) — the consumer products handle this with link reset/rotation (Linear invite-link reset [linear](https://linear.app/docs/invite-members), Slack deactivate/renew [slack](https://slack.com/help/articles/360060363633-Manage-pending-invitations-and-invite-links-for-your-workspace)), and a lightweight president-approval-on-join step (as Mighty Networks and Discord optionally gate [mighty](https://docs.mightynetworks.com/for-hosts/payments-and-access/how-do-i-invite-directly-to-a-plan) [discord](https://support.discord.com/hc/en-us/articles/29729107418519-Server-Member-Applications)) may be worth prototyping if fraternity privacy expectations turn out to be higher than the frictionless ideal assumes.