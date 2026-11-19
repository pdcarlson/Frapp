import type { components } from "@repo/api-sdk";

/**
 * The invite card's words, shared by web `/join` and the phone's join screen
 * (#5625) so the two read the same, dead or alive. The card itself is each
 * app's own; `spec/ui/design-system/writing.md` § Join chapter specifies the
 * strings.
 */

/** `POST /v1/invites/details`: the card's facts and whether the link works. */
export type InviteDetails = components["schemas"]["InviteDetailsResponseDto"];
export type InviteLinkState = InviteDetails["state"];

/** The sender's first name, for "Ask Paul for a new link". */
export function inviterFirstName(
  details: Pick<InviteDetails, "invited_by">,
): string | null {
  const first = details.invited_by?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * The line under the chapter's name on a live card: who sent it and how many
 * are already in, `Paul Carlson invited you · 41 members`.
 */
export function inviteCardLine(
  details: Pick<InviteDetails, "invited_by" | "member_count">,
): string {
  const members =
    details.member_count > 0
      ? `${details.member_count} ${details.member_count === 1 ? "member" : "members"}`
      : null;
  return [
    details.invited_by ? `${details.invited_by} invited you` : null,
    members,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A written-out date, the way dates read across the apps: "Friday, November 14". */
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * What a dead link says (#5625). The chapter and sender still show, so the
 * visitor knows exactly whom to ask, and one tap asks them.
 */
export function deadInviteCopy(
  details: Pick<InviteDetails, "state" | "invited_by" | "sent_at">,
): { title: string; sent: string | null; body: string; ask: string } {
  const first = inviterFirstName(details);
  const whom = first ?? "the officer who sent it";
  const sent = details.invited_by
    ? `${details.invited_by} sent it on ${longDate(details.sent_at)}`
    : null;
  const ask = first ? `Ask ${first} for a new link` : "Ask for a new link";
  switch (details.state) {
    case "used":
      return {
        title: "This invite was already used",
        sent,
        body: `Each personal invite works once. Ask ${whom} for a new one.`,
        ask,
      };
    case "off":
      return {
        title: "This invite was turned off",
        sent,
        body: `An officer turned this link off. Ask ${whom} for a new one.`,
        ask,
      };
    default:
      return {
        title: "This invite has expired",
        sent,
        body: `Invite links stop working after a week so they can't spread. Ask ${whom} for a new one.`,
        ask,
      };
  }
}

/** Under the Ask button before it's pressed, and what replaces it after. */
export function askForNewLinkCopy(details: Pick<InviteDetails, "invited_by">): {
  hint: string;
  sent: string;
  signedOutHint: string;
} {
  const first = inviterFirstName(details);
  return {
    hint: first
      ? `${first} gets a notification with your name.`
      : "They get a notification with your name.",
    sent: first
      ? `Asked. ${first} got a notification with your name and can send you a new link.`
      : "Asked. They got a notification with your name and can send you a new link.",
    signedOutHint: first
      ? `Sign in first, so ${first} knows who's asking.`
      : "Sign in first, so they know who's asking.",
  };
}

/** A link that never was an invite, or whose chapter is gone (404). */
export const UNKNOWN_INVITE_COPY = {
  title: "This invite link doesn't work",
  body: "Check that you copied the whole link, or ask the officer who sent it for a new one.",
} as const;
