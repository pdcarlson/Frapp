import { Redirect } from "expo-router";

/**
 * Catch-all for unmatched paths, including stale deep links into routes this
 * slice deleted (`/points`, `/notification-targets`, `/onboarding-tour`,
 * `/documents-reports`, `/task-center`, `/chat`).
 *
 * It redirects rather than drawing a dead end: chat is home, and a member who
 * followed an old link is better served by the app than by an error. The one
 * deep link that must never reach here is `frapp://event-details`, whose route
 * is a filename contract (spec/ui/mobile/navigation.md:49).
 */
export default function NotFound() {
  return <Redirect href="/" />;
}
