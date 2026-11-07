import * as Sentry from "@sentry/react-native";
import { codeOf, statusOf } from "@repo/api-sdk";

/**
 * What Chat home's error state says when the channel list fails.
 *
 * A 403 is the server refusing this member, not the network failing, so it
 * must not say "couldn't reach the server": that sends a member to check
 * their signal while the actual fix is an officer giving them a role. On
 * 2026-11-07 two testers who joined on a "Cabinet" invite (a role brought
 * over from Discord with only a channel permission) saw the network copy on
 * every launch. The server now grants Member beside such a role
 * (`spec/behavior/onboarding.md`), so this copy is for the cases still left:
 * an officer removing a member's last base role, or a role whose base
 * permissions were edited away.
 */
export type ChannelsErrorCopy = {
  title: string;
  body: string;
};

export function channelsErrorCopy(
  error: unknown,
  chapterName: string | null,
): ChannelsErrorCopy {
  if (statusOf(error) === 403) {
    const chapter = chapterName ?? "this chapter";
    return {
      title: "Chat isn't open to you yet",
      body: `Your role in ${chapter} doesn't include chat. Ask an officer to give you the Member role, then pull down to refresh.`,
    };
  }
  return {
    title: "Couldn't load channels",
    body: "Chat couldn't reach the server.",
  };
}

let reportedRefusal = false;

/**
 * Report a refused channel list to Sentry, once per app run.
 *
 * The shared query-error reporter skips every 401 and 403 as the auth flow
 * answering (`@repo/observability` `query-errors.ts`), which is right for a
 * signed-out session but hid the testers above: a signed-in member refused
 * their own chapter's chat is a bug, and nothing reported it. A warning,
 * fingerprinted on its own, so it groups as one issue however many members
 * hit it.
 */
export function reportChannelsRefused(error: unknown): void {
  if (reportedRefusal || statusOf(error) !== 403) return;
  reportedRefusal = true;
  Sentry.captureMessage("Chat home: channel list refused (403)", {
    level: "warning",
    fingerprint: ["chat-home-channels-refused"],
    tags: { "api.code": codeOf(error) ?? "none", area: "chat-home" },
  });
}

/** Tests only: forget that a refusal was reported. */
export function resetChannelsRefusedReport(): void {
  reportedRefusal = false;
}
