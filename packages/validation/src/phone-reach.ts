/**
 * Phone reach: whether Frapp's notifications can reach a member's phone, for
 * the Directory's "Phone app" filter and the member detail row (web and the
 * phone show the same states in the same words).
 *
 * A signed-in phone holds a push token (`push_tokens`), but a token alone
 * doesn't mean a push is seen: iOS issues one without the member's
 * permission, and Android 13+ without POST_NOTIFICATIONS. So each phone also
 * reports what its own push switch reads (`notifications_enabled`), and the
 * state is worked out from every phone the member has signed in.
 */

import { canAllOfAny, MEMBER_JOINED_AUDIENCE } from "./permissions";

/**
 * - `on`: at least one phone lets Frapp's notifications show.
 * - `off`: has the app, and every phone that has said has them off.
 * - `unknown`: has the app on a build that hasn't said yet, and no phone is on.
 * - `web_only`: no phone signed in.
 */
export type PhoneReachState = "on" | "off" | "unknown" | "web_only";

export type PhonePlatform = "ios" | "android";

export interface PhoneReach {
  user_id: string;
  state: PhoneReachState;
  /** The most recently opened phone's platform, when its label says. */
  platform: PhonePlatform | null;
  /** When the member last opened the app on any phone; `null` when web only. */
  last_opened_at: string | null;
}

/** The fields of a `push_tokens` row that reach depends on. */
export interface PhoneReachDevice {
  user_id: string;
  device_name: string | null;
  last_registered_at: string;
  notifications_enabled: boolean | null;
}

/**
 * Who sees every member's reach: the officers told when someone joins
 * (`MEMBER_JOINED_AUDIENCE`, invite or role management). Anyone else is
 * served only their own. The API enforces it; clients read it to decide
 * whether to draw the filter.
 */
export const PHONE_REACH_AUDIENCE = MEMBER_JOINED_AUDIENCE;

export function canSeeChapterPhoneReach(
  permissions: readonly string[] | null | undefined,
): boolean {
  return canAllOfAny(PHONE_REACH_AUDIENCE, permissions);
}

/** The platform out of a device label such as `ios 26.1 · iPhone 16`. */
export function phonePlatformOf(
  deviceName: string | null | undefined,
): PhonePlatform | null {
  const head = deviceName?.trim().toLowerCase() ?? "";
  if (head.startsWith("ios")) return "ios";
  if (head.startsWith("android")) return "android";
  return null;
}

/** One member's reach from every phone they have signed in. */
export function phoneReachOf(
  userId: string,
  devices: readonly PhoneReachDevice[],
): PhoneReach {
  if (devices.length === 0) {
    return {
      user_id: userId,
      state: "web_only",
      platform: null,
      last_opened_at: null,
    };
  }
  const latest = devices.reduce((a, b) =>
    b.last_registered_at > a.last_registered_at ? b : a,
  );
  let state: PhoneReachState;
  if (devices.some((d) => d.notifications_enabled === true)) state = "on";
  else if (devices.every((d) => d.notifications_enabled === false))
    state = "off";
  else state = "unknown";
  return {
    user_id: userId,
    state,
    platform: phonePlatformOf(latest.device_name),
    last_opened_at: latest.last_registered_at,
  };
}

/** The filter's choices, in order. `null` is Any. */
export type PhoneReachFilter = "on" | "unreachable" | "web_only";

export const PHONE_REACH_FILTER_OPTIONS: readonly {
  value: PhoneReachFilter;
  label: string;
}[] = [
  { value: "on", label: "Notifications on" },
  { value: "unreachable", label: "Not reachable" },
  { value: "web_only", label: "Web only" },
];

/** The filter chip's name, and the detail row's label. */
export const PHONE_REACH_LABEL = "Phone app";

/**
 * Whether a member passes the filter. A member with no reach entry (a
 * failed read, or a member who joined since) passes only Any. "Not
 * reachable" is notifications off plus web only: the list an officer acts on.
 */
export function matchesPhoneReachFilter(
  reach: PhoneReach | undefined,
  filter: PhoneReachFilter | null,
): boolean {
  if (filter === null) return true;
  if (!reach) return false;
  if (filter === "on") return reach.state === "on";
  if (filter === "web_only") return reach.state === "web_only";
  return reach.state === "off" || reach.state === "web_only";
}

/** The state in words, the same on web and the phone. */
export function phoneReachStateLabel(state: PhoneReachState): string {
  switch (state) {
    case "on":
      return "Notifications on";
    case "off":
      return "Notifications off";
    case "unknown":
      return "Phone app";
    case "web_only":
      return "Web only";
  }
}

/** How long unopened before the row says when they last opened it. */
export const PHONE_REACH_STALE_DAYS = 30;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "November 18", with the year only when it isn't this year ("December 10,
 * 2025"), the written-out form the member profile's "Member since" uses.
 */
function writtenDate(date: Date, now: Date): string {
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear()
    ? day
    : `${day}, ${date.getFullYear()}`;
}

/**
 * The detail row's value: "iPhone, notifications off", or "Web only".
 * The platform leads when the label names one.
 */
export function phoneReachSummary(reach: PhoneReach): string {
  const stateText = phoneReachStateLabel(reach.state);
  if (reach.state === "web_only") return stateText;
  const device =
    reach.platform === "ios"
      ? "iPhone"
      : reach.platform === "android"
        ? "Android"
        : null;
  if (reach.state === "unknown") {
    return device ? `${device}, notifications not reported yet` : stateText;
  }
  if (!device) return stateText;
  return `${device}, ${stateText.charAt(0).toLowerCase()}${stateText.slice(1)}`;
}

/** "Last opened November 18", or `null` when web only or the date is bad. */
export function phoneReachLastOpened(
  reach: PhoneReach,
  now: Date = new Date(),
): string | null {
  if (!reach.last_opened_at) return null;
  const at = new Date(reach.last_opened_at);
  if (Number.isNaN(at.getTime())) return null;
  return `Last opened ${writtenDate(at, now)}`;
}

/**
 * The line a list row adds under the name: the last-opened date, only once a
 * phone has gone unopened for `PHONE_REACH_STALE_DAYS` (the member may have
 * deleted the app without signing out).
 */
export function phoneReachStaleNote(
  reach: PhoneReach,
  now: Date = new Date(),
): string | null {
  if (!reach.last_opened_at) return null;
  const at = new Date(reach.last_opened_at);
  if (Number.isNaN(at.getTime())) return null;
  const days = (now.getTime() - at.getTime()) / 86_400_000;
  return days >= PHONE_REACH_STALE_DAYS
    ? phoneReachLastOpened(reach, now)
    : null;
}

/** "8 of 42 members can't get notifications", for the filtered list. */
export function phoneReachCountLine(
  reaches: readonly PhoneReach[],
  memberCount: number,
): string {
  const unreachable = reaches.filter(
    (r) => r.state === "off" || r.state === "web_only",
  ).length;
  return `${unreachable} of ${memberCount} ${memberCount === 1 ? "member" : "members"} can't get notifications`;
}
