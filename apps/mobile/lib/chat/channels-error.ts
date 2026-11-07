import * as Sentry from "@sentry/react-native";
import { codeOf } from "@repo/api-sdk";
import {
  CHANNELS_ROLE_REFUSAL_TITLE,
  channelsRoleRefusalBody,
  isRoleRefusal,
} from "@repo/chat-core/channels-refused-copy";

/**
 * What Chat home's error state says when the channel list fails. A refusal
 * by role gets the shared role copy (`@repo/chat-core/channels-refused-copy`,
 * which web uses too); every other failure keeps the connection copy.
 */
export type ChannelsErrorCopy = {
  title: string;
  body: string;
};

export function channelsErrorCopy(
  error: unknown,
  chapterName: string | null,
): ChannelsErrorCopy {
  if (isRoleRefusal(error)) {
    return {
      title: CHANNELS_ROLE_REFUSAL_TITLE,
      body: channelsRoleRefusalBody(chapterName),
    };
  }
  return {
    title: "Couldn't load channels",
    body: "Chat couldn't reach the server.",
  };
}

let reportedRefusal = false;

/**
 * Report a refusal by role to Sentry, once per app run.
 *
 * The shared query-error reporter skips every 401 and 403 as the auth flow
 * answering (`@repo/observability` `query-errors.ts`), which is right for a
 * signed-out session but hid the 2026-11-07 testers: a signed-in member
 * refused their own chapter's chat is a bug, and nothing reported it. A
 * warning, fingerprinted on its own, so it groups as one issue however many
 * members hit it. The chapter guard's 403s (a stale chapter in the token, a
 * removed member) are not this, and don't use up the one report.
 */
export function reportChannelsRefused(error: unknown): void {
  if (reportedRefusal || !isRoleRefusal(error)) return;
  reportedRefusal = true;
  Sentry.captureMessage("Chat home: channel list refused by role (403)", {
    level: "warning",
    fingerprint: ["chat-home-channels-refused"],
    tags: { "api.code": codeOf(error) ?? "none", area: "chat-home" },
  });
}

/** Tests only: forget that a refusal was reported. */
export function resetChannelsRefusedReport(): void {
  reportedRefusal = false;
}
