# Positioning — chat is the spine

The chat-first redesign (see [`spec/README.md`](../README.md#roadmap)) inverts the historical "12 modules side-by-side" model. **Chat is the magnum opus**; every other capability (events, tasks, dues, points, polls) is a *chat integration* — surfaced inline in conversation, not behind a separate nav tab. Chat is non-optional, free, and the default landing route on web (`/chat`) and mobile (chat tab).

The paid tier gates the ops integrations (events with check-in, dues invoicing, points ledger, reports). The free tier — unlimited chat, unlimited members, unlimited chapters — is the wedge. The chunk roadmap in [`spec/README.md`](../README.md#roadmap) is the canonical context for that direction; this spec captures the current ship state.

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
