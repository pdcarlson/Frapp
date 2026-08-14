# Mobile Interaction Patterns

> Client-side mechanics behind the screens: bottom sheets, QR check-in, study sessions, dues payment, and push notifications. Server-side rules stay in [`../../behavior/`](../../behavior/README.md) — this doc links, never restates.

Screen ids reference [`screens.md`](screens.md); surface rules (native-feel, Expo Go isolation, styling) are in [`README.md`](README.md).

## Bottom sheets

Creation flows are sheets (s19 new task, s20 log service hours, s21 upload document, s23 adjust points, and the s17 Ask presentation). One-tap actions never are — see [`README.md`](README.md).

- Library: `@gorhom/bottom-sheet` **v5**. Sheets are components hosted by their parent screen, not routes.
- Detents: snap to content height; tall sheets (s17, s20) cap at roughly 78% of the viewport as drawn. Sheet chrome uses the sheet radius and elevated surface from [`../design-system/foundations.md`](../design-system/foundations.md), with a drag handle, title row, and trailing Cancel as drawn.
- Text fields inside a sheet MUST use `BottomSheetTextInput` (plain `TextInput` breaks the sheet's keyboard coordination), with `keyboardBehavior="interactive"` on the sheet.
- `react-native-keyboard-controller` does not run in Expo Go. It lives behind an execution-environment check (isolation module per [`README.md`](README.md)); Expo Go falls back to `KeyboardAvoidingView`.
- Sheet chrome is styled with typed `StyleSheet` token factories. **NativeWind on sheet chrome is a hard ban** (research-derived; the full ban list is §2 "De-Google guardrails" in [`../design-system/README.md`](../design-system/README.md)).

## QR check-in (s18 member scanner, s22 host display)

- **Token design:** the host screen renders a server-signed rotating token — HMAC-signed, ~30-second TTL, single-use on redemption. The server accepts the current and the immediately previous window, so a scan racing a rotation still lands. This is a signed nonce scheme, **not TOTP** — there is no shared secret on member devices to leak.
- **Geofence is the real anti-proxy layer.** Any displayed code can be screenshotted and forwarded; the check that defeats proxy check-ins is the server's zone check on the scanner's location (s18 states this in-UI). The rotating code raises effort; the geofence enforces presence.
- **Scanner:** `expo-camera`'s `CameraView`. `onBarcodeScanned` fires repeatedly for one physical code — the client MUST latch the first read and debounce until the server responds, or one scan becomes N redemption attempts.
- **QR rendering is always dark-on-white** (s22: white card on the dark screen), even in dark UI. Scan reliability beats theme purity.
- **Fallbacks:** a short manual rotating code on the host screen (s22 "Show code") for members whose camera fails, and an officer manual override — every override is audit-logged.
- Check-in window, role gates, and the atomic attendance-plus-points award are server rules: [`../../behavior/events.md`](../../behavior/events.md) and [`../../behavior/points.md`](../../behavior/points.md).

## Study sessions (s10)

Client obligations for the geofenced study timer. The session state machine, pause/grace semantics, and expiry rules are owned by [`../../behavior/study-sessions.md`](../../behavior/study-sessions.md).

- **Foreground-only.** The app never requests background location and never the "Always" permission — While Using only. "No background location" is a binding ban, not an optimization.
- **Wall-clock timestamps.** Credited time derives from server-recorded timestamps, never an accumulated client-side timer — a clock the client owns is a clock the client can inflate.
- **AppState pause/resume:** backgrounding triggers the pause call; returning within the grace window (default 5 minutes, chapter-configurable per zone — s10 surfaces it as "a 5-min grace window") resumes without losing time. Exact semantics: behavior spec above.
- **Heartbeat:** every 5 minutes in the foreground, at `Location.Accuracy.Balanced` — precise enough for a building-scale polygon, cheap enough to not drain the battery.
- **Stale sessions die server-side.** A client that crashes or goes silent cannot bank time: the server voids sessions via its stale-heartbeat rule and resolves lapsed pauses on every entry point. The client never needs cleanup logic of its own.
- **Permission primer:** the location primer is contextual — shown on the first Start-session tap, explaining the zone check, never at app launch.

## Dues payment (s11)

- Payment runs through **Stripe PaymentSheet** confirming the existing PaymentIntent flow (`POST /v1/invoices/:id/payment-intent` returns the client secret). No new payment backend for mobile.
- **The webhook is the source of truth.** PaymentSheet success is provisional: the client shows the invoice as processing and flips it to Paid only when the server (webhook-driven) says so. Idempotency, reconciliation, and invoice states: [`../../behavior/billing.md`](../../behavior/billing.md).
- **Copy says "chapter dues", never "subscription".** Member dues and the chapter's own Signet subscription are different billing concepts; the UI must never blur them. General copy rules: [`../design-system/writing.md`](../design-system/writing.md).
- The whole payment path sits behind a runtime `isStripeAvailable` guard (Stripe RN does not run in Expo Go — isolation module per [`README.md`](README.md)). When unavailable, the screen still renders balance and history; the pay CTA explains that payment needs the installed app build.

## Push notifications

Server-side routing, preferences, and delivery are owned by [`../../behavior/notifications.md`](../../behavior/notifications.md). Client rules:

- **Android channel before permission.** Create the Android notification channel *before* requesting permission — on Android 13+ the prompt and delivery behave correctly only when the channel already exists.
- **Contextual primer, never at launch.** The opt-in primer appears at the first moment push has obvious value — first RSVP or first chat open — and on the first-run screen (s03) as a card, never as a cold launch-time OS prompt. Declining is a quiet "Not now"; the OS prompt fires only after the user accepts the primer.
- **Cold-start dedup.** A notification tap that launches the app is read via `getLastNotificationResponseAsync`, then cleared with `clearLastNotificationResponseAsync` — otherwise the same tap re-navigates on every remount of the handler.
- **Token lifecycle follows auth.** Register the push token on sign-in, deregister it on sign-out; a token MUST NOT outlive the session that created it.
- **Never call `getDevicePushTokenAsync` inside the token listener.** The listener fires on token changes; fetching a token from inside it can re-trigger the listener and loop.
- Remote push does not run in Expo Go — it lives behind an isolation module ([`README.md`](README.md)); in Go, notification UI renders from in-app data only.
