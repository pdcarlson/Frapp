/**
 * The start of a channel's history, in one wording for both clients.
 *
 * An empty channel used to swap its timeline for a "Nothing in this channel
 * yet" card. It now draws what a channel looks like at the top of its
 * history: its name, what it is for, and who it is with. The same block sits
 * above the oldest message once people have posted, so scrolling to the
 * start of a channel always ends on it. Rostered in
 * `spec/ui/design-system/writing.md` § Chat (dashboard), Channel start.
 *
 * `description` is the channel's own line (`chat_channels.description`),
 * written by officers in Chat admin; the four default channels start with one
 * (`DEFAULT_CHANNELS` in the API). A channel without one shows only the start
 * line, rather than a sentence we make up about it.
 */

export type ChannelStartType =
  "PUBLIC" | "PRIVATE" | "ROLE_GATED" | "DM" | "GROUP_DM";

export interface ChannelStartInput {
  type: ChannelStartType;
  /** The channel's name without `#`, or a DM's display name. */
  name: string;
  description?: string | null;
}

export interface ChannelStartCopy {
  title: string;
  /** "This is the start of …": where the reader is. */
  startLine: string;
  /** The channel's own description, trimmed, or null when it has none. */
  description: string | null;
}

/** The trimmed description, or null for a blank one. */
export function channelDescription(
  description: string | null | undefined,
): string | null {
  const trimmed = description?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function channelStartCopy(input: ChannelStartInput): ChannelStartCopy {
  const description = channelDescription(input.description);
  switch (input.type) {
    case "DM":
      return {
        title: input.name,
        startLine: `This is the start of your conversation with ${input.name}.`,
        description: null,
      };
    case "GROUP_DM":
      return {
        title: input.name,
        startLine: "This is the start of your group conversation.",
        description: null,
      };
    // A role-gated channel is not called private: who can read it depends on
    // its required permissions, and the seeded #alumni asks only for
    // `members:view`, which every member holds.
    case "PRIVATE":
      return {
        title: `Welcome to #${input.name}`,
        startLine: `This is the start of the private #${input.name} channel.`,
        description,
      };
    default:
      return {
        title: `Welcome to #${input.name}`,
        startLine: `This is the start of #${input.name}.`,
        description,
      };
  }
}

/** The officer's shortcut from the channel start into Chat admin. */
export const EDIT_CHANNEL_LABEL = "Edit channel";
/** The same shortcut when the channel has no description yet. */
export const ADD_CHANNEL_DESCRIPTION_LABEL = "Add a description";

/**
 * Channels the server writes to itself (`#chapter-audit`, the audit log's
 * mirror). Both clients mark them with the audit glyph, and the row menu
 * (`channel-row-actions.ts`) offers them no Edit or Delete.
 */
const SYSTEM_CHANNEL_NAMES: ReadonlySet<string> = new Set(["chapter-audit"]);

export function isSystemChannel(channel: { name: string }): boolean {
  return SYSTEM_CHANNEL_NAMES.has(channel.name);
}

/**
 * The mark a (non-direct) channel draws beside its name, in a channel list and
 * at its start: the audit shield for the audit channel, a lock for a channel
 * not every member can join, and `#` for the rest. `PRIVATE` and `ROLE_GATED`
 * both draw the lock, but only a `PRIVATE` one is called private (see
 * {@link channelStartCopy}): a role-gated channel such as the seeded #alumni
 * may be open to every member. Web's rail and channel start draw the same
 * marks (`apps/web/components/chat/channel-list.tsx`, `channel-start.tsx`).
 */
export type ChannelMark = "hash" | "private" | "role-gated" | "audit";

export function channelMarkFor(channel: {
  name: string;
  type: string;
}): ChannelMark {
  if (isSystemChannel(channel)) return "audit";
  if (channel.type === "PRIVATE") return "private";
  if (channel.type === "ROLE_GATED") return "role-gated";
  return "hash";
}
