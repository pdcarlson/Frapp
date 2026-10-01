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
 * `data-sentry-element`, `data-sentry-source-file`), and by default
 * (`autoInjectSentryLabel`) a `sentry-label` built from each root element's
 * static text, which the touch boundary prefers over `accessibilityLabel`.
 * Touch breadcrumbs carry no label of any kind either way: `beforeBreadcrumb`
 * in `lib/sentry/options.ts` names the element by component alone (#2982).
 */
module.exports = getSentryExpoConfig(__dirname, {
  annotateReactComponents: false,
  includeWebReplay: false,
  includeWebFeedback: false,
});
