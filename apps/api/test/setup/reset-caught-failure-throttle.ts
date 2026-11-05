import { resetCaughtFailureThrottle } from '../../src/infrastructure/observability/caught-failure-throttle';

// `reportCaughtFailure` sends one Sentry event per fingerprint per window, and
// that window lives in module state. Specs in one file share it, so without this a
// spec that expects a report would pass or fail by test order.
afterEach(() => {
  resetCaughtFailureThrottle();
});
