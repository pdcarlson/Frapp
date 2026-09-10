const { getSentryExpoConfig } = require("@sentry/react-native/metro");

/**
 * Sentry Expo Metro config (debug IDs / source context).
 *
 * `includeWebReplay: false` and `includeWebFeedback: false` — Sentry Replay
 * is not enabled on any surface (`spec/behavior/observability.md`). Session
 * replay is PostHog-only, and production PostHog replay is itself off until
 * #2038.
 *
 * `annotateReactComponents` stays off (the default). Auto-injecting labels
 * from visible text would put member copy into the native breadcrumb stream.
 */
module.exports = getSentryExpoConfig(__dirname, {
  annotateReactComponents: false,
  includeWebReplay: false,
  includeWebFeedback: false,
});
