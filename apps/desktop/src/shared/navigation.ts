/**
 * Where a link may go (ADR-29 decision 4).
 *
 * The window shows only the app's own origin. Everything else a member clicks
 * (a link in a message, a document on Supabase Storage, Google Maps for an
 * event) opens in their default browser, the way Discord and Slack desktop
 * behave. A scheme the browser can't usefully open (`file:`, `javascript:`,
 * a custom app scheme) is dropped, so a crafted link in chat can't launch
 * another program.
 */

export type NavigationDecision =
  /** Load it in the app window. */
  | { kind: "stay" }
  /** Hand it to the operating system's default browser or mail app. */
  | { kind: "external"; url: string }
  /** Do nothing. */
  | { kind: "block" };

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

export function decideNavigation(target: string, appOrigin: string): NavigationDecision {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { kind: "block" };
  }
  if (url.origin === appOrigin) return { kind: "stay" };
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { kind: "external", url: url.toString() };
  return { kind: "block" };
}

/**
 * The browser permissions the app may ask for, and only from its own origin:
 * notifications (#4842), the microphone for recording a meeting (#712),
 * clipboard writes for Copy, and full screen for a photo or video.
 * Everything else (camera, location, MIDI, USB, …) is refused.
 */
const ALLOWED_PERMISSIONS = new Set([
  "notifications",
  "media",
  "clipboard-sanitized-write",
  "fullscreen",
]);

export function isPermissionAllowed(
  permission: string,
  requestingUrl: string,
  appOrigin: string,
  mediaTypes: readonly string[] = [],
): boolean {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;
  let origin: string;
  try {
    origin = new URL(requestingUrl).origin;
  } catch {
    return false;
  }
  if (origin !== appOrigin) return false;
  // `media` covers the camera too; recording minutes needs only the microphone.
  if (permission === "media") return mediaTypes.every((type) => type === "audio");
  return true;
}
