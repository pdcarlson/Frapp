const { getSentryExpoConfig } = require("@sentry/react-native/metro");

/**
 * Sentry Expo Metro config (debug IDs / source context).
 *
 * `includeWebReplay: false` and `includeWebFeedback: false` — Sentry Replay
 * is not enabled on any surface (`spec/behavior/observability.md`). Session
 * replay is PostHog-only, and production PostHog replay is itself off until
 * #2038.
 *
 * `annotateReactComponents` stays off (the default). It would add each
 * component's name and source file to its elements (`data-sentry-component`,
 * `data-sentry-element`, `data-sentry-source-file`), which are code, not
 * member copy. Member copy reaches touch breadcrumbs through
 * `accessibilityLabel` and visible text, which `beforeBreadcrumb` in
 * `lib/sentry/options.ts` removes either way (#2982).
 */
module.exports = getSentryExpoConfig(__dirname, {
  annotateReactComponents: false,
  includeWebReplay: false,
  includeWebFeedback: false,
});
