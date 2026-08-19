# Feasibility and design brief: mass communications + automated personalized notifications for Signet

**Bottom line up front.** Both features are viable on a self-funded stack, but they split cleanly on effort. **Bulk email is cheap, fast, and low-compliance — ship it first** (~$15-20/month flat at your scale, only CAN-SPAM basics to satisfy). **Bulk SMS is the outlier: a real registration gate (A2P 10DLC) adds a 1-2 week carrier approval delay, ~$20-60 in one-time fees plus small monthly campaign fees, and a stricter consent/opt-out regime — defer it to a later phase and gate it behind explicit per-member opt-in.** For personalized notifications, **start rules-based and in-app/email only** (query the user's own pending items and fill deterministic templates), and layer LLM-generated natural-language recaps later once your RAG infra exists — the LLM version costs less than a tenth of a cent per user per day but adds reliability and cost-scaling risk you don't need yet. The permission model that fits Greek life best is a **role × target-group matrix** borrowed almost directly from Flocknote and Remind: certain roles can broadcast, each scoped to the groups they administer.

---

## Feature 1 — Configurable member-to-member / mass communications

### Email providers and costs (ship this first)

All four candidates are viable; the differentiator at your scale is simplicity and free-tier headroom, not per-email cost — the volume is trivial.

| Provider | Entry cost | What you get | Note |
|---|---|---|---|
| **Postmark** | **$15/mo** (Basic) | 10,000 emails/mo, up to 5 sender domains, 15 streams [postmarkapp](https://postmarkapp.com/pricing) | Cleanest multi-tenant separation via streams/signature domains [postmarkapp](https://postmarkapp.com/blog/new-we-made-pro-and-platform-tier-features-accessible-to-lower-volume-email-plans) |
| **Resend** | **$0** free (3,000/mo, 100/day), then **$20/mo** (50,000/mo) [resend](https://resend.com/pricing) | 10 domains on Pro, 1 on Free | Most developer-friendly; generous free tier covers early beta |
| **SendGrid** | **$19.95/mo** (Essentials, 50k) [twilio](https://www.twilio.com/en-us/products/email-api/pricing) | Subusers for per-tenant segmentation [sendgrid](https://docs.sendgrid.com/ui/account-and-settings/subusers) | Owned by Twilio — useful if you consolidate SMS+email later |
| **AWS SES** | **~$1/mo** for 10k emails ($0.10/1,000) [aws](https://aws.amazon.com/ses/pricing/) | Cheapest at volume; new accounts get $200 free credits (6 mo) [aws](https://aws.amazon.com/ses/faqs/) | More setup/deliverability work; the "cheap but you build more" option |

**Recommendation: start on Resend's free tier during beta** (3,000 emails/mo covers a single chapter easily) and move to Resend Pro or Postmark Basic (~$15-20/mo) once you cross the free ceiling. For a **5 chapters × 200 members** scenario with modest email use you are comfortably inside one paid tier — call it **~$20/month all-in**. AWS SES is the long-run cost floor (~$1/mo for that volume) but costs you deliverability/reputation setup that isn't worth it for a solo founder pre-scale.

Multi-tenancy note: whichever you pick, use the provider's tenant-isolation primitive so one chapter's sending reputation can't poison another's — Postmark streams/signature domains [postmarkapp](https://postmarkapp.com/pricing), Resend multiple domains [resend](https://resend.com/pricing), or SendGrid subusers [sendgrid](https://docs.sendgrid.com/ui/account-and-settings/subusers).

### SMS providers and costs

Per-message costs are near-identical across providers; the real cost is registration and ongoing campaign fees, not the messages.

| Provider | Per-SMS (US) | Number rental | Notes |
|---|---|---|---|
| **Twilio** | $0.0083 + carrier fee (~$0.0035-0.005) [twilio](https://www.twilio.com/en-us/sms/pricing/us) | $1.15/mo long code | Most documentation, subaccounts for multi-tenancy [twilio](https://www.twilio.com/docs/iam/api/subaccounts) |
| **Plivo** | $0.0077 + carrier fee [plivo](https://www.plivo.com/sms/pricing/) | $0.50/mo long code | Slightly cheaper base + number |
| **Bird (MessageBird)** | $0.0073 + carrier fee [bird](https://bird.com/en-us/pricing/sms) | $0.11/mo local number [bird](https://bird.com/en-us/pricing/numbers) | Cheapest per-unit; less multi-tenant docs |

At **~5,000 outbound SMS/month**, all three land around **$55-65/month** including carrier pass-through fees and number rental [twilio](https://www.twilio.com/en-us/sms/pricing/us) [plivo](https://www.plivo.com/sms/pricing/) [bird](https://bird.com/en-us/pricing/sms). **Recommendation: Twilio** — not because it's cheapest (it isn't, marginally) but because its 10DLC onboarding, opt-out automation, and email product (SendGrid) are the best-documented, which matters most for a solo founder using Claude Code. Twilio also plans to auto-unify opt-out across SMS/MMS/RCS from March 2026 [twilio](https://support.twilio.com/hc/en-us/articles/223134027-Twilio-Support-for-Opt-out-Keywords-SMS-STOP-Filtering).

### Compliance: what actually blocks launch vs. what can be deferred

This is the section that determines sequencing. **The asymmetry is stark: email can ship now; SMS cannot ship without clearing a carrier registration gate.**

**Email — CAN-SPAM (low bar, does NOT block launch):** No prior consent required to email your members [ftc](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business). Requirements are mechanical and easy to build: accurate From/subject lines, a valid physical postal address in the footer, a working unsubscribe honored within 10 business days and kept live 30+ days [ftc](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business). Penalties are large per-email ($53,088) but violations are easy to avoid [ftc](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business). **Verdict: build the unsubscribe/footer logic and ship.**

**SMS — A2P 10DLC (hard launch blocker):** Messages sent from unregistered long codes **"will not be delivered"** — carriers filter/block them [plivo](https://www.plivo.com/docs/messaging/a2p-10dlc/quickstart). You must register a **brand** and a **campaign** before any SMS reliably reaches members. Costs and timeline:

- **Brand registration:** ~$4 (low-volume standard) to $44 (standard) one-time [twilio](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc); Twilio sole-proprietor brand is $4.50 [twilio](https://support.twilio.com/hc/en-us/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service).
- **Campaign:** ~$15 one-time vetting fee + **$1.50-$10/month** recurring per campaign [twilio](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc).
- **Timeline:** Twilio estimates "under one week"; Plivo says "1-2 weeks" of manual carrier review [twilio](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc) [plivo](https://support.plivo.com/hc/en-us/articles/360054871572-A2P-10DLC). Practitioners report rejections and multi-week loops in worse cases [reddit](https://www.reddit.com/r/twilio/comments/14tigsn/how_long_is_a2p_10dlc_campaign_registration/).
- **Throughput:** low-volume/unvetted brands are throttled to ~15 messages/minute per carrier; a whole-chapter blast of 200 texts is fine but not instant [plivo](https://www.plivo.com/docs/messaging/a2p-10dlc/quickstart).
- **Watch-out:** T-Mobile charges a **$250 fee** if an active campaign sends no traffic for 60 days  — a real risk for a seasonal, low-frequency chapter use case.

**SMS — TCPA consent (blocks launch of SMS specifically):** Marketing/telemarketing texts sent via automated systems require **prior express written consent** [ecfr](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200); damages run **$500-$1,500 per text** [law.cornell](https://www.law.cornell.edu/uscode/text/47/227). Research could **not confirm any carve-out** for texting your own club members [ecfr](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200) — treat this as a gap requiring legal confirmation, but the safe design is unambiguous: **collect explicit, logged SMS opt-in from each member before texting them** (Remind's model: the member must reply YES to confirm before receiving any message [remind](https://help.remind.com/hc/en-us/articles/204430265-What-Remind-texts-look-like)).

**SMS — opt-out (STOP) handling (build requirement, but providers help):** You must honor revocation via any reasonable method within ≤10 business days, and standard keywords (STOP, QUIT, CANCEL, UNSUBSCRIBE, END, etc.) must work [ecfr](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200) . Twilio's Messaging Services automate STOP suppression at the provider level [twilio](https://support.twilio.com/hc/en-us/articles/223134027-Twilio-Support-for-Opt-out-Keywords-SMS-STOP-Filtering), which reduces (but doesn't eliminate) your build.

**Sequencing implication:** Email is a "build the send flow + footer" task. SMS is "build the send flow + integrate 10DLC registration + build opt-in capture + build opt-out suppression + wait 1-2 weeks for approval per brand + carry monthly fees." That's why they must be different phases.

### Recommended permission model: role × target-group matrix

The comparable products converge on the same pattern, and Flocknote's is the closest analog to Greek life. Borrow it directly:

- **Broadcast is a role-gated capability, scoped to groups the role administers.** Flocknote's tiers map perfectly: Super Admins can send to any group, Group Admins can send only to groups they manage, and Note Senders can send only to specific groups [flocknote](https://blog.flocknote.com/initial-faqs). For Signet: **President/exec = broadcast to whole chapter; committee chair = broadcast only to their committee; pledge educator = broadcast to pledge class.**
- **Groups as the targeting abstraction, with multi-select and individual override.** Flocknote lets a sender target one group, multiple groups, or a few individuals in one composer [flocknote](https://help.flocknote.com/article/18-what-is-a-note-and-how-do-i-send-one) [flocknote](https://help.flocknote.com/article/153-send-a-note-to-multiple-groups); ChurchTrac adds "include only checked names" for manual subset sends [churchtrac](https://www.churchtrac.com/support/people/how-to-send-voice-messages). Signet's natural groups: whole chapter, pledge class, each committee, exec board, alumni.
- **Restrict which groups a limited sender can even see/target.** ChurchTrac's "restrict this user to specific smart lists" is the enforcement mechanism [churchtrac](https://www.churchtrac.com/support/people/smart-lists) — a committee chair shouldn't be able to select "whole chapter." Remind similarly only shows the announcement option to owners/admins and constrains staff from school-wide sends [remind](https://help.remind.com/hc/en-us/articles/115000590990-Send-an-individual-group-class-or-role-based-message) [remind](https://help.remind.com/hc/en-us/articles/4415935285901-How-do-I-change-the-role-of-school-participants).

Signet already has chapter-scoped roles/permissions, so this is an extension of the existing permission system — a new `can_broadcast` capability plus a per-role allowed-target-group set — not new infrastructure.

### Opt-in / per-channel delivery UX

The cleanest pattern (Flocknote's) is **per-member, per-channel opt-in with a graceful fallback, so mass-send never breaks on missing consent:**

- A member's record carries independent channel preferences: **in-app, email, SMS** (and push). Flocknote sends via whatever the member is opted into for that group, and if email is off it falls back to text [flocknote](https://help.flocknote.com/article/274-note-delivery-will-members-get-my-message-as-an-email-or-text). ChurchTrac only sends SMS to members who have a mobile number stored [churchtrac](https://www.churchtrac.com/support/people/how-do-I-text-my-church).
- **Mass-send resolves each recipient to their available channel** rather than failing. A member with no SMS consent simply gets the email/in-app version; the sender sees no error. This is what lets you ship email now and add SMS later without reworking the send flow — build the channel-resolution layer once.
- Collect SMS consent explicitly and lazily: prompt for phone + opt-in the first time a member would benefit, mirroring Remind's YES-to-confirm activation [remind](https://help.remind.com/hc/en-us/articles/204430265-What-Remind-texts-look-like). Members can change preferences anytime, and a STOP reply turns off that channel without removing them [flocknote](https://help.flocknote.com/article/182-stopreplies).

---

## Feature 2 — Automated personalized in-app notifications (recaps + reminders)

### Architecture: start rules-based, add LLM later

The evidence strongly favors a **deterministic, rules-based digest first**, with LLM natural-language generation as a later layer once your RAG infra lands.

- The core mechanic is provider-agnostic and simple: **buffer per-user events, then process on a schedule** rather than firing one notification per event [oneuptime](https://oneuptime.com/blog/post/2026-03-31-redis-notification-digest-system/view). For Signet the "buffer" is largely already in your Postgres — you query the user's own pending tasks, unread mentions, points balance, upcoming events at digest time and fill a template.
- **LLMs are explicitly the wrong default for "low-variance transactional alerts,"** where "template-based systems remain the superior design" [arxiv](https://arxiv.org/pdf/2605.16264). "You have 2 overdue tasks and a study-hours shortfall" is exactly this case.
- LLM summarization in production carries reliability tax: hallucination/omission risk [nature](https://www.nature.com/articles/s41746-025-01670-7), the need for output-format constraints and fallbacks to raw highlights when the model fails [galileo](https://galileo.ai/blog/llm-summarization-production-guide). None of that is worth taking on for a digest you can template deterministically.
- **Design the phases so the LLM slots in cleanly:** produce well-structured facts (counts + short entity lists) in the rules-based phase, then — only later — feed those bounded facts to an LLM for a friendlier natural-language wrapper. Galileo's guidance is that structured, bounded input is the precondition for reliable LLM summaries [galileo](https://galileo.ai/blog/llm-summarization-production-guide).

### LLM digest cost (why it's affordable later, and why it still isn't the priority)

Using gpt-4o-mini pricing ($0.15/1M input, $0.60/1M output [openai](https://developers.openai.com/api/docs/models/gpt-4o-mini)), a small bounded recap (~2,000 input + ~300 output tokens) costs **~$0.0005 per user per day** [openai](https://developers.openai.com/api/docs/models/gpt-4o-mini). Across 1,000 members daily that's ~$15/month — genuinely cheap. The reason to defer isn't cost; it's that (a) the reliability/guardrail work outweighs the UX gain for simple reminders, and (b) cost and latency compound once you reach tens of thousands of daily digests [galileo](https://galileo.ai/blog/llm-summarization-production-guide). Rules-based delivers 90% of the value at 0% of the model risk.

### Notification-preferences center UX

The standard model across community/SaaS apps is **category × channel × frequency**, and users must have real control including mute/snooze [suprsend](https://www.suprsend.com/post/notification-preference-center) [saasui](https://www.saasui.design/blog/saas-notification-toast-ux-patterns) [codelit](https://codelit.io/blog/notification-system-architecture). A practical starter set for Signet:

- **Categories** (toggle each): Tasks, Mentions, Events, Points/Balance, Study hours.
- **Frequency** per category: Off / Daily / Weekly (reserve real-time for a small critical set like direct mentions) [suprsend](https://www.suprsend.com/post/notification-batching-and-digest).
- **Channels:** start with **in-app + email only** to cut complexity; add push (server infra already exists) and SMS later, reusing the same preference model [codelit](https://codelit.io/blog/notification-system-architecture).
- Digests are **user-configured and sent only to that user** [userpilot](https://docs.userpilot.com/configure/notifications/digest); not every user necessarily opts in [higherlogic](https://support.higherlogic.com/hc/en-us/articles/360032691152-Manage-Email-Digests). Add per-user timezone/quiet-hours at the profile level so digests land at a sensible local hour [suprsend](https://docs.suprsend.com/docs/time-window).

### Scheduling on a Node/Postgres stack (cheap, no enterprise tooling)

- **Phase 0 (single instance):** `node-cron` or OS cron running a digest job on a fixed cadence is the correct, non-over-engineered choice for "single process, low stakes" — just make the send idempotent (track `last_digest_sent_at` in Postgres) [nextjs-from-zero](https://nextjs-from-zero.vercel.app/articles/4004730).
- **Phase 1 (when you scale to multiple instances or need retries):** move to **pg-boss**, a Postgres-backed job queue with cron scheduling and IANA-timezone support — **no Redis required**, which keeps your stack minimal [github](https://github.com/timgit/pg-boss) [nerdleveltech](https://nerdleveltech.com/pg-boss-postgres-job-queue-node-typescript-production-tutorial). Cron alone breaks with multiple instances (runs twice per host) and lacks retries/visibility [nextjs-from-zero](https://nextjs-from-zero.vercel.app/articles/4004730).
- **Per-user timezone/cadence:** rather than one cron per user, run a global scheduler every few minutes that selects "due" users by comparing their timezone, frequency, and last-sent timestamp, then renders and sends. Timezone-aware digest scheduling on the recipient's local clock is the established pattern [suprsend](https://docs.suprsend.com/docs/digest).
- If you already use Supabase, `pg_cron` + `pg_net` to invoke a function on schedule is a zero-extra-infra option [supabase](https://supabase.com/docs/guides/functions/schedule-functions).

---

## Recommended combined build order

**Phase A — Email broadcast + rules-based in-app notifications (cheap, fast, no blockers).** Ship the role × target-group permission model, the channel-resolution send layer (email + in-app), CAN-SPAM footer/unsubscribe, and a rules-based daily/weekly digest on node-cron. Cost: ~$0-20/month email. No registration wait, minimal compliance. This delivers most of the user value.

**Phase B — Notification-preferences center + push channel.** Add the category × channel × frequency preference UI and wire push (server infra already exists — just add mobile client registration). Reuses the Phase A send layer.

**Phase C — SMS broadcast (deferred).** Only after email proves adoption. Budget a 1-2 week 10DLC approval wait [twilio](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc), ~$20-60 one-time + $1.50-10/month per campaign [twilio](https://support.twilio.com/hc/en-us/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service), explicit opt-in capture, and STOP suppression (Twilio automates much of this [twilio](https://support.twilio.com/hc/en-us/articles/223134027-Twilio-Support-for-Opt-out-Keywords-SMS-STOP-Filtering)). Because Phase A already built channel resolution and per-member preferences, SMS becomes "add a channel," not a rebuild. Watch the T-Mobile $250 dormancy fee given seasonal usage .

**Phase D — LLM-generated recaps (fast-follow after RAG).** Wrap the already-structured rules-based facts in natural language via gpt-4o-mini (~$0.0005/user/day) with format constraints and a fallback to the deterministic template [galileo](https://galileo.ai/blog/llm-summarization-production-guide). Migrate scheduling to pg-boss if you've scaled past a single instance [github](https://github.com/timgit/pg-boss).

---

## Where additional research would most change the conclusions

1. **TCPA scope for the specific use case.** Whether informational (non-marketing) texts from a chapter to its own opted-in members clear a lower consent bar than the "prior express written consent" standard for marketing texts [ecfr](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200) is genuinely decision-relevant and could not be resolved from public sources — a brief consult with a TCPA-familiar attorney (or Twilio's compliance guidance for your registered use case) before Phase C would firm up how heavy the opt-in flow must be. It does not change the "email first, SMS deferred" sequencing, since 10DLC gates SMS regardless.
2. **Real-world 10DLC approval experience for education/nonprofit-adjacent low-volume senders.** Timelines and rejection rates vary; a short scan of current Twilio community threads at the moment you start Phase C would set realistic expectations, since reported experiences range from under a week to multi-week loops [reddit](https://www.reddit.com/r/twilio/comments/14tigsn/how_long_is_a2p_10dlc_campaign_registration/).