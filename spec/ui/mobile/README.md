> **TARGET SPEC (not yet built).** This tree specifies the mobile app Signet is being rebuilt into; `apps/mobile` today is the pre-Signet build and most of the specified screens do not exist yet. Implementation is tracked in GitHub Issues — do not file spec-vs-implementation drift issues against these documents.

# Mobile App

> Surface rules for the Signet mobile app (`apps/mobile`): what makes it feel iOS-native, what runs in Expo Go versus an EAS build, and how screens are styled. Screen inventory, navigation, and interaction patterns live in the sibling docs below.

Visual truth: [`../design-system/reference/canvas-screens.dc.html`](../design-system/reference/canvas-screens.dc.html) renders all 23 locked screens (s01–s23). Where a written doc disagrees with it, the reference wins (precedence rules: [`../README.md`](../README.md)).

## Contents

| Doc | Governs |
| --- | ------- |
| [`screens.md`](screens.md) | The s01–s23 screen inventory and its expo-router route map |
| [`navigation.md`](navigation.md) | 4-tab IA, More hub, global entries, deep links, typed routes |
| [`patterns.md`](patterns.md) | Bottom sheets, QR check-in, study sessions, dues payment, push |

Tokens, components, icons, and copy shared across Signet surfaces live in [`../design-system/`](../design-system/README.md) — this tree never restates them. Network, optimistic-update, and loading/empty/error delivery rules live in [`../resilience.md`](../resilience.md).

## Native-feel rules

The app must feel iOS-native, not like a web view. These rules are binding for every screen:

| Situation | Required pattern |
| --------- | ---------------- |
| Destructive, irreversible action (delete channel, remove member, end session early) | Native `Alert.alert` confirm with the destructive button given `style: "destructive"`. `window.confirm` is banned everywhere. |
| Reversible delete (remove a task, retract a message) | No confirm. Apply immediately and show an undo snackbar; only the snackbar timeout makes it permanent. |
| Creation flow (new task, log service hours, upload document, adjust points) | Bottom sheet via `@gorhom/bottom-sheet` v5 — mechanics in [`patterns.md`](patterns.md). |
| One-tap response (RSVP, poll vote, reaction) | Inline optimistic tap on the card itself. MUST NOT open a sheet, modal, or confirm — the tap is the whole interaction. Optimistic/rollback rules: [`../resilience.md`](../resilience.md). |
| Admin event creation | Web-only. It is not in the 23-screen set. If it is ever built on mobile it MUST be a full-screen modal route, never a sheet. |

## Run paths: Expo Go vs EAS

**Expo Go is the only current run path** (`npm run start -w apps/mobile`, scan from a device). This constrains what may ship unguarded:

- The following do **not** run in Expo Go and MUST live behind isolation modules — a runtime execution-environment check with a graceful fallback, so importing the screen never crashes Go:
  - `@stripe/stripe-react-native` (dues payment — see [`patterns.md`](patterns.md))
  - Remote push notifications (see [`patterns.md`](patterns.md))
  - `react-native-keyboard-controller` (in-sheet keyboards — see [`patterns.md`](patterns.md))
- Code outside an isolation module MUST NOT import these packages directly.
- Device-native features beyond Go's module set require a future **EAS dev build** (profiles already exist in `apps/mobile/eas.json`). Until that build exists, every guarded feature MUST degrade to a usable Go experience, not a dead screen.

## Styling

- Screens are styled with **typed `StyleSheet` token factories**: a factory takes the theme tokens (neutral ladder, accent scale, type scale, radius map from [`../design-system/foundations.md`](../design-system/foundations.md)) and returns a typed `StyleSheet`. Raw hex values in screen code are a defect — every color comes from a token.
- **NativeWind MUST NOT style Signet surfaces.** The existing `nativewind` usage in `apps/mobile` is pre-Signet and is retired as each screen is reskinned; sheet chrome in particular is a hard ban (see [`patterns.md`](patterns.md)).
- No drop shadows — elevation is a lighter surface step; borders are low-opacity white, never fixed hex. These and the other research-derived bans are enumerated in §2 "De-Google guardrails" of [`../design-system/README.md`](../design-system/README.md).
- Chapter accent colors reach screens only through the generated scale — never the raw seed. Pipeline: [`../design-system/accent-engine.md`](../design-system/accent-engine.md).
- Every screen implements the skeleton/empty/error states family from [`../design-system/components.md`](../design-system/components.md); the inventory in [`screens.md`](screens.md) does not repeat this per row.
- UI copy follows [`../design-system/writing.md`](../design-system/writing.md).

## Naming

Spec prose says **Signet**; code stays `frapp` (`apps/mobile` app.json scheme `frapp`, domain `frapp.live`, `@repo/*` packages) until the deferred repo rename. When these docs cite code, they cite the real current names.
