import type { GoogleCalendarStatus } from "./use-google-calendar";

/**
 * Settings → Linked apps (#5407): every outside account a member has tied to
 * Frapp, one row each, with the state drawn rather than written out. The same
 * three states Discord's Connections, Slack's Connected apps and Google's
 * "Third-party connections" draw:
 *
 * - `connected`: a green check, and the account it is connected as.
 * - `off`: the row greyed, with Connect.
 * - `expired`: red, with Reconnect. The link exists but the provider stopped
 *   honoring it (Google Calendar's `needs_reconnect`), so nothing syncs.
 *
 * Web and the phone draw the rows; this file is what each row says, so the two
 * never disagree.
 */
export type LinkedAppTone = "connected" | "off" | "expired";

export interface LinkedAppState {
  tone: LinkedAppTone;
  /** The short line under the app's name. */
  detail: string;
}

/** Google Calendar's row. Null where the server doesn't offer it. */
export function googleCalendarLinkedState(
  status:
    | Pick<
        GoogleCalendarStatus,
        "available" | "connected" | "status" | "google_email"
      >
    | undefined,
): LinkedAppState | null {
  if (!status?.available) return null;
  if (!status.connected) return { tone: "off", detail: "Not connected" };
  if (status.status === "needs_reconnect") {
    return {
      tone: "expired",
      detail: "Sign-in expired",
    };
  }
  return {
    tone: "connected",
    detail: status.google_email ?? "Connected",
  };
}

/** Discord's row: the account a member's imported messages are tied to. */
export function discordLinkedState(
  link:
    | { linked: boolean; available?: boolean; discord_username?: string | null }
    | undefined,
): LinkedAppState | null {
  if (!link) return null;
  if (link.linked) {
    return {
      tone: "connected",
      detail: link.discord_username ?? "Linked",
    };
  }
  if (link.available === false) return null;
  return { tone: "off", detail: "Not linked" };
}

/** One way a member can sign in to Frapp. */
export type SignInMethodKey = "email" | "google" | "apple";

export interface SignInMethod extends LinkedAppState {
  key: SignInMethodKey;
  label: string;
}

/** The fields of a Supabase Auth identity a row reads. */
export interface SignInIdentity {
  provider: string;
  identity_data?: { email?: unknown } | null;
}

const SIGN_IN_METHODS: readonly { key: SignInMethodKey; label: string }[] = [
  { key: "email", label: "Email and password" },
  { key: "google", label: "Google" },
  { key: "apple", label: "Apple" },
];

/**
 * The sign-in rows, from the account's Supabase Auth identities. Every method
 * Frapp offers is listed, so a member sees which they could also use; the
 * ones on the account carry a check and the address they sign in with.
 */
export function signInMethodsFrom(
  identities: readonly SignInIdentity[],
  accountEmail?: string | null,
): SignInMethod[] {
  return SIGN_IN_METHODS.map(({ key, label }) => {
    const identity = identities.find((i) => i.provider === key);
    if (!identity) return { key, label, tone: "off", detail: "Not set up" };
    const email = identity.identity_data?.email;
    return {
      key,
      label,
      tone: "connected",
      detail:
        typeof email === "string" && email ? email : (accountEmail ?? "Set up"),
    };
  });
}
