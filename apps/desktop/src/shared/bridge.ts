/**
 * The contract between the web app and the shell: `window.frappDesktop`.
 *
 * The preload exposes exactly this, and nothing reaches Node or Electron any
 * other way (ADR-29 decision 4). The web app treats the object's presence as
 * "I am running inside the desktop app". Every argument crossing into the main
 * process is checked here, because the main process must assume the page
 * could be compromised.
 */

/** IPC channel names. One place, so preload and main can't drift apart. */
export const IPC = {
  setBadgeCount: "frapp-desktop:set-badge-count",
  openExternal: "frapp-desktop:open-external",
} as const;

export type FrappDesktopBridge = {
  /** The shell's own version, e.g. "0.1.0" (not the web app's). */
  readonly version: string;
  readonly platform: "darwin" | "win32" | "linux";
  /** The unread count on the dock or taskbar icon; 0 clears it. */
  setBadgeCount(count: number): void;
  /** Open an https page in the member's default browser (OAuth, #4841). */
  openExternal(url: string): void;
};

/** The badge stops counting where the dock does: macOS shows up to 99999. */
const MAX_BADGE = 99_999;

/** A badge count the main process will apply, or `null` to ignore the call. */
export function parseBadgeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return Math.min(value, MAX_BADGE);
}

/**
 * A URL `openExternal` may hand to the operating system, or `null`. Only
 * https: the bridge exists for the OAuth provider page, and a page that could
 * open `file:` or an app scheme could launch a program.
 */
export function parseExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
