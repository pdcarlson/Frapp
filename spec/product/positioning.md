# Positioning — chat is the spine

The chat-first product (see [`spec/README.md`](../README.md#active-work)) inverts the historical "12 modules side-by-side" model. **Chat is the magnum opus**; every other capability (events, tasks, dues, points, polls) is a *chat integration* — surfaced inline in conversation, not behind a separate nav tab. Chat is non-optional, free, and the default landing route on web (`/chat`) and mobile (chat tab).

The paid tier gates the ops integrations (events with check-in, dues invoicing, points ledger, reports) and the AI features (meeting transcription/summary, Q&A over chapter content). The free tier — unlimited chat, unlimited members, unlimited chapters — is the wedge. Delivery sequencing lives in **GitHub Issues**, not a chunk roadmap; [`spec/README.md`](../README.md#active-work) is the index. This spec captures positioning, not ship state.

**AI features are anchored on authoritative content, not casual chat.** The AI corpus is meeting minutes, uploaded documents, structured chapter data, and announcements — not the general channels. This is an intentional product call: smaller AI that's reliably right, instead of bigger AI that's frequently embarrassing. See [`spec/behavior/ai.md`](../behavior/ai.md) for scope and non-goals.

## Audience

Frapp targets **normal chapters across the full Greek spectrum** — IFC, NPC, NPHC, MGC, professional, service, honor, and pre-charter colonies. Customization is the product because every chapter runs differently: vocabulary, roles, dues structure, and modules all vary by organization.

## Pick one thing to be perfect at — chat

Every UX decision routes through "does this make chat better?" Mobile lands on chat. Web's home is a chat catch-up. Ops events/tasks/dues exist primarily as inline chat artifacts, not as separate destinations.

## Free tier (the wedge)

The free tier is a real, ungated product, not a teaser:

- **Unlimited chat, unlimited members, unlimited chapters. No credit card.** Anyone can sign up, create a chapter, invite members, and chat without ever touching Stripe.
- Drives adoption among casual chapters who currently use GroupMe.
- Always-on free modules: chat, members (directory + invites), announcements, audit log, chapter settings.

## Paid tier (Chapter Pro)

A per-chapter monthly subscription unlocks the ops integrations and AI:

- **$149 per chapter / month, USD, flat.** One price for the chapter regardless of member count — no per-seat component and no quantity tiers. This is the number the public site sells (`apps/landing/app/page.tsx:419` and the page's JSON-LD offer), so it is a commercial commitment, not an internal default: moving it means moving the site in the same change.
- The flatness is load-bearing in the code, not only in the positioning. `StripeService.createCheckoutSession` builds a single line item at `quantity: 1` against one `STRIPE_PRICE_ID`, so per-seat billing, quantity tiers, and any per-chapter price variation are all code changes, not a different Price object. Treat "swap the Price ID" as able to change *the amount* and nothing else.
- Events with QR check-in, points ledger, dues invoicing / Stripe collection, custom workflows, exports/reports, backwork library, and the AI features (meeting transcription/summary, Q&A over chapter content).
- **14-day trial, opened at checkout.** The trial begins when the chapter subscribes, not when it first activates a paid module — activation-triggered trials would need module-activation state that does not exist. Stripe reports the window as `trialing`, which maps to `active`, so a trialing chapter is fully active to every permission gate. A card is collected up front; the first charge lands on day 15. Set by `subscription_data.trial_period_days` on the Checkout Session — Stripe's Price object has no writable trial field, so this cannot ride on `STRIPE_PRICE_ID`.
- Disabling a paid module hides its slash commands, mutes its system channel, and hides its dashboard page; data is preserved and restored on re-enable.

## Vocabulary-first

Greek organizations use different words for the same concepts — rush vs recruitment vs intake; pledge vs aspirant vs candidate; class vs line vs cohort. Vocabulary is resolved per chapter and applied everywhere, including chat channel names and slash-command labels.

## Member-visible audit log

Officer changes (dues, modules, roles) post into a `#chapter-audit` system channel that all members can read. Trust by default — members can see what officers change without having to ask.

## Officer onboarding with directory autofill

The first-officer flow is school search → chapter search → archetype confirm → invite members. A new officer types something like "Sigma Phi Epsilon @ UCLA" and the wizard autofills chapter identity (Greek letters, designation, school short, founded year, default colors) from a curated Greek-life directory. Target: under 90 seconds from signup to first chat message for a chapter that exists in the directory. Subsequent ops setup (enabling paid modules, configuring dues, setting workflows) is optional and surfaced as inline nudges rather than a mandatory gate.

## Full chapter theming

A chapter picks an accent seed — one colour. Chrome, message accents, mention pills, links, and reaction highlights derive from that seed via the accent engine, not from a hand-picked second palette. Theming runs deeper than an accent chip. Derivation: [`spec/ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md).

## Visual identity

Do not duplicate brand values here. **Signet** (dark-first, warm, Figtree, house gold) is specified in [`spec/ui/brand-identity.md`](../ui/brand-identity.md); token values live in [`spec/ui/design-system/foundations.md`](../ui/design-system/foundations.md). The frozen landing site still ships the legacy Frapp look until its reskin — see brand-identity §5; the web dashboard cut over with the #920 shell slice. Touch targets ≥ 44px: [`foundations.md`](../ui/design-system/foundations.md). Haptics on confirming actions: [`spec/ui/mobile/README.md`](../ui/mobile/README.md) (native-feel table). Chat swipe-to-reply / swipe-to-archive is **not** in the Signet inventory (`screens.md` s05 is live with no reply-quote) — do not resurrect NativeWind-era gesture copy from older positioning drafts.
