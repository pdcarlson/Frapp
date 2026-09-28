import type { StagedChannel } from "./upload-step";

export interface ChannelChoice {
  action: "create_new" | "use_existing" | "skip";
  targetChannelId?: string;
  newName?: string;
  readOnly?: boolean;
  /**
   * Who can read the channel `create_new` makes. Undefined means not chosen,
   * which is where a channel that was private in Discord starts.
   */
  visibility?: "chapter" | "restricted";
  /** For `restricted`: a member needs any one of these to read it. */
  requiredPermissions?: string[];
}

/**
 * The starting answer for a channel, before the admin touches anything.
 *
 * New channel, named as it was in Discord. The owner's call (#2787, after the
 * first real import had them click through 78 channels one by one): the
 * Discord name is what everyone already knows, and creating a NEW channel
 * cannot interleave anything into a live one, so it is a safe default where
 * merging never is. Two exceptions:
 *
 *  - a channel the bot cannot read starts, and stays, skipped;
 *  - a channel that was private in Discord gets no visibility, which is a
 *    "Needs attention" item until the admin chooses. Nothing private becomes
 *    readable by the whole chapter by default, and the API refuses it too.
 */
export function defaultChoice(channel: StagedChannel): ChannelChoice {
  if (channel.readable === false) return { action: "skip" };
  return {
    action: "create_new",
    newName: channel.channelName,
    visibility: channel.privateInDiscord === true ? undefined : "chapter",
  };
}

export function defaultChoices(
  channels: StagedChannel[],
): Record<string, ChannelChoice> {
  return Object.fromEntries(
    channels.map((channel) => [channel.channelId, defaultChoice(channel)]),
  );
}

/** One thing that stops the mapping from being submitted. */
export interface MappingIssue {
  /** The row to jump to; null for an issue about the whole mapping. */
  channelId: string | null;
  message: string;
}

/** Channel names compare case-insensitively and ignoring a leading `#`. */
export function normaliseChannelName(name: string): string {
  return name.trim().replace(/^#+/, "").toLowerCase();
}

/**
 * Everything the admin must fix before Continue, in list order.
 *
 * The same function decides whether Continue is enabled and what the Needs
 * attention panel lists, so the two can never disagree about why the step is
 * blocked. A clash with an existing Frapp channel is an issue rather than a
 * silent merge: `chat_channels` has no unique (chapter_id, name), so a
 * same-name channel is never evidence the admin meant to merge into it.
 */
export function mappingIssues(
  channels: StagedChannel[],
  choices: Record<string, ChannelChoice>,
  existingChannelNames: readonly string[],
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const existing = new Set(existingChannelNames.map(normaliseChannelName));

  const newNameCounts = new Map<string, number>();
  for (const channel of channels) {
    const choice = choices[channel.channelId];
    if (choice?.action !== "create_new") continue;
    const key = normaliseChannelName(choice.newName ?? "");
    if (key) newNameCounts.set(key, (newNameCounts.get(key) ?? 0) + 1);
  }

  let importing = 0;
  for (const channel of channels) {
    const choice = choices[channel.channelId];
    const label = `#${channel.channelName}`;
    if (!choice || choice.action === "skip") continue;
    importing += 1;

    if (choice.action === "use_existing") {
      if (!choice.targetChannelId) {
        issues.push({
          channelId: channel.channelId,
          message: `Pick the Frapp channel to merge ${label} into.`,
        });
      }
      continue;
    }

    const name = choice.newName?.trim() ?? "";
    const key = normaliseChannelName(name);
    if (!key) {
      issues.push({
        channelId: channel.channelId,
        message: `Name the new channel for ${label}.`,
      });
    } else if (existing.has(key)) {
      issues.push({
        channelId: channel.channelId,
        message: `#${name} already exists in Frapp. Rename the new channel for ${label}, or merge into the existing one.`,
      });
    } else if ((newNameCounts.get(key) ?? 0) > 1) {
      issues.push({
        channelId: channel.channelId,
        message: `#${name} is the new name for ${newNameCounts.get(key)} channels. Give ${label} a different one.`,
      });
    }

    if (choice.visibility === undefined) {
      issues.push({
        channelId: channel.channelId,
        message: `${label} was private in Discord. Choose who can read it in Frapp.`,
      });
    } else if (
      choice.visibility === "restricted" &&
      (choice.requiredPermissions ?? []).length === 0
    ) {
      issues.push({
        channelId: channel.channelId,
        message: `Choose who can read the new channel for ${label}.`,
      });
    }
  }

  if (channels.length > 0 && importing === 0) {
    issues.push({
      channelId: null,
      message: "Every channel is skipped. Choose at least one to import.",
    });
  }
  return issues;
}
