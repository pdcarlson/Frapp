import type { ErrorCopyOptions } from "@repo/hooks/error-copy";

/**
 * The Discord connection and import routes write each refusal for the officer
 * reading it ("Name the new role for Rush Chair.", "Frapp cannot read
 * #announcements in Discord. Allow the Frapp role on the channel…"), and the
 * import wizard depends on those sentences to say which step to fix, so their
 * screens let a refusal through `getErrorMessage` when it reads as a sentence.
 */
export const DISCORD_ROUTES_WRITE_FOR_MEMBERS: ErrorCopyOptions = {
  serverWritesForMembers: true,
};
