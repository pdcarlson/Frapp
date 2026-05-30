# Positioning — chat is the spine

The chat-first product (see [`spec/README.md`](../README.md#roadmap)) inverts the historical "12 modules side-by-side" model. **Chat is the magnum opus**; every other capability (events, tasks, dues, points, polls) is a *chat integration* — surfaced inline in conversation, not behind a separate nav tab. Chat is non-optional, free, and the default landing route on web (`/chat`) and mobile (chat tab).

The paid tier gates the ops integrations (events with check-in, dues invoicing, points ledger, reports) and the AI features (meeting transcription/summary, Q&A over chapter content). The free tier — unlimited chat, unlimited members, unlimited chapters — is the wedge. The chunk roadmap in [`spec/README.md`](../README.md#roadmap) is the canonical context for that direction; this spec captures the current ship state.

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

- Events with QR check-in, points ledger, dues invoicing / Stripe collection, custom workflows, exports/reports, backwork library, and the AI features (meeting transcription/summary, Q&A over chapter content).
- **14-day trial on first activation.** Trials begin when a chapter first activates a paid module.
- Disabling a paid module hides its slash commands, mutes its system channel, and hides its dashboard page; data is preserved and restored on re-enable.

## Vocabulary-first

Greek organizations use different words for the same concepts — rush vs recruitment vs intake; pledge vs aspirant vs candidate; class vs line vs cohort. Vocabulary is resolved per chapter and applied everywhere, including chat channel names and slash-command labels.

## Member-visible audit log

Officer changes (dues, modules, roles) post into a `#chapter-audit` system channel that all members can read. Trust by default — members can see what officers change without having to ask.

## Officer onboarding with directory autofill

The first-officer flow is school search → chapter search → archetype confirm → invite members. A new officer types something like "Sigma Phi Epsilon @ UCLA" and the wizard autofills chapter identity (Greek letters, designation, school short, founded year, default colors) from a curated Greek-life directory. Target: under 90 seconds from signup to first chat message for a chapter that exists in the directory. Subsequent ops setup (enabling paid modules, configuring dues, setting workflows) is optional and surfaced as inline nudges rather than a mandatory gate.

## Full chapter theming

A chapter picks two colors — a dark and an accent. Sidebar tint, header band, message-accent stripe, mention pills, link colors, and reaction highlights all derive from those two colors via a controlled palette generator that respects WCAG contrast against the bone (light) and ink (dark) backgrounds. Theming runs deeper than an accent chip: it themes the entire experience. The derivation algorithm is specified in [`spec/architecture/README.md`](../architecture/README.md).

---

# Visual Identity: "Modern Ivy"

Frapp balances the prestige of traditional Greek life with the clean feel of modern SaaS.

**Cross-app tokens, CTA color semantics, and motifs** are specified in **[`spec/ui-brand-identity.md`](../ui-brand-identity.md)** and implemented in `@repo/theme`. This section summarizes product-facing labels; where naming differs, **ui-brand-identity wins** (e.g., ShadCN **`primary`** is royal blue for buttons and links, not navy).

## Color Palette

| Role                                    | Color                         | Hex       |
| --------------------------------------- | ----------------------------- | --------- |
| Navy (headlines, body text, trust)      | Professional, trustworthy     | `#0F172A` |
| Royal blue (**primary** actions, links) | Action-oriented CTAs          | `#2563EB` |
| Success (Emerald)                       | Growth, positive transactions | `#10B981` |
| Background (Slate)                      | Clean, focused                | `#F8FAFC` |

Dark mode variants defined in `@repo/theme`. Dark mode respects system preference with manual override.

## Typography

- **Primary font:** Geist Sans (see [`spec/ui-brand-identity.md`](../ui-brand-identity.md) §4).
- **Web dashboards:** High density, compact spacing.
- **Mobile:** Generous spacing, touch-friendly targets (minimum 44x44px).

## Mobile Design

- Unified codebase (Expo/React Native) for iOS and Android.
- System-adaptive design via NativeWind. No platform-specific UI forks.
- Haptic feedback on key actions (check-in, point award, reactions).
- Swipe gestures for chat (swipe to reply, swipe to archive DM).
