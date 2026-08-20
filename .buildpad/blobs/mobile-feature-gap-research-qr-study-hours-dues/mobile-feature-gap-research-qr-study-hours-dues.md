# Mobile feature-gap research (QR, study hours, dues, push)

QR check-in: server-signed rotating token (~30s, not TOTP); geofence is the real anti-proxy layer, not rotation alone; use expo-camera's CameraView (expo-barcode-scanner is deprecated/removed); QR must render dark-on-white even in dark UI for scan reliability; manual code + officer override as fallbacks.

Mobile study hours: build foreground-only, no background geofencing \u2014 avoids App Store background-location review risk entirely and background geofencing is unreliable anyway. Wall-clock timestamps, not JS counters. AppState-driven pause/resume with a grace window; server-side stale-session sweep handles force-quit.

Mobile dues: Stripe-direct is safe to ship \u2014 Apple 3.1.3(e) exempts real-world services from IAP, Google explicitly exempts gym memberships, competitor Greek apps already do this. Use PaymentSheet (reuses existing PaymentIntent/webhook backend almost unchanged). Must move mobile off Expo Go onto EAS dev builds since Stripe RN SDK is native-only.

Push notifications: registration hooks already exist, unused. Must create Android notification channel BEFORE requesting permission (ordering bug that silently breaks the Android 13+ prompt). Contextual primer screen (not launch-time) roughly doubles-triples opt-in. Four-destination router needs both a live-tap listener and getLastNotificationResponseAsync for cold start, with a dedup guard against double-routing.