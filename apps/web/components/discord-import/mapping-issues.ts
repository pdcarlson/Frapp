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

/** Why a channel may not default to readable by the whole chapter. */
export type PrivacyReason =
  "private" | "private-threads" | "unknown" | "export";

/**
 * Why a channel may not default to readable by the whole chapter, or null
 * when it may.
 *
 * The API applies the same rule: only a channel the scan SAW was public,
 * holding no private thread, takes the whole-chapter default. Unknown counts
 * as private, because the roles read that answers it can fail on its own, and
 * so does an uploaded export, which carries no permissions at all (the
 * "Set who can read…" control answers a whole export in one click).
 */
export function privacyReason(channel: StagedChannel): PrivacyReason | null {
  if (channel.privateInDiscord === true) return "private";
  if ((channel.privateThreads ?? 0) > 0) return "private-threads";
  if (channel.privateInDiscord === null) return "unknown";
  if (channel.privateInDiscord === undefined) return "export";
  return null;
}

function defaultVisibility(channel: StagedChannel): "chapter" | undefined {
  return privacyReason(channel) ? undefined : "chapter";
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
 *  - a channel with a `privacyReason` gets no visibility, which is a "Needs
 *    attention" item until the admin chooses. Nothing private becomes
 *    readable by the whole chapter by default, and the API refuses it too.
 */
export function defaultChoice(channel: StagedChannel): ChannelChoice {
  if (channel.readable === false) return { action: "skip" };
  return {
    action: "create_new",
    newName: channel.channelName,
    visibility: defaultVisibility(channel),
  };
}

export function defaultChoices(
  channels: StagedChannel[],
): Record<string, ChannelChoice> {
  return Object.fromEntries(
    channels.map((channel) => [channel.channelId, defaultChoice(channel)]),
  );
}

/**
 * Turn a choice into a new channel, filling in what a skip or a merge left
 * blank the same way the default would, so switching a row to New never
 * invents a problem (or hides one) that the default would not have.
 */
export function asNewChannel(
  current: ChannelChoice,
  channel: StagedChannel,
): ChannelChoice {
  return {
    ...current,
    action: "create_new",
    newName: current.newName?.trim() ? current.newName : channel.channelName,
    visibility: current.visibility ?? defaultVisibility(channel),
  };
}

/**
 * The choices for a new scan of the same server.
 *
 * What the admin decided survives only while the facts it was decided under
 * still hold, because `previous` holds untouched defaults as well as real
 * decisions and nothing tells the two apart:
 *
 *  - a channel Frapp can no longer read is skipped, the only thing it can be;
 *  - a channel it can now read (it was skipped because it could not be)
 *    starts at its default, which is the point of scanning again;
 *  - when a channel's privacy changed (it became private, gained a private
 *    thread, can no longer be told, or turned out public after all), a new
 *    channel's visibility goes back to the default for what the scan sees
 *    now, unless it was restricted, which is safe either way; and a merge
 *    into an existing channel is asked again if the channel is now private,
 *    since it was decided for one that was not.
 *
 * A name, a skip, or anything else decided while the facts held is kept.
 */
export function restageChoices(
  previousChannels: readonly StagedChannel[],
  previousChoices: Record<string, ChannelChoice>,
  nextChannels: StagedChannel[],
): Record<string, ChannelChoice> {
  const before = new Map(
    previousChannels.map((channel) => [channel.channelId, channel]),
  );
  const next = defaultChoices(nextChannels);
  for (const channel of nextChannels) {
    const was = before.get(channel.channelId);
    const kept = previousChoices[channel.channelId];
    if (!was || !kept) continue;
    if (channel.readable === false || was.readable === false) continue;
    const reason = privacyReason(channel);
    if (reason === privacyReason(was)) {
      next[channel.channelId] = kept;
    } else if (kept.action === "create_new") {
      next[channel.channelId] =
        kept.visibility === "restricted"
          ? kept
          : {
              ...kept,
              visibility: defaultVisibility(channel),
              requiredPermissions: undefined,
            };
    } else if (kept.action !== "use_existing" || reason === null) {
      next[channel.channelId] = kept;
    }
    // Otherwise a merge into a channel that is now private starts over at
    // the default, which asks who can read it.
  }
  return next;
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
        message: visibilityPrompt(channel, label),
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

function visibilityPrompt(channel: StagedChannel, label: string): string {
  switch (privacyReason(channel)) {
    case "private":
      return `${label} was private in Discord. Choose who can read it in Frapp.`;
    case "private-threads": {
      const count = channel.privateThreads ?? 0;
      return `${label} holds ${count} private thread${count === 1 ? "" : "s"} in Discord, which will land in it. Choose who can read it in Frapp.`;
    }
    case "unknown":
      return `Frapp could not tell whether ${label} was private in Discord. Choose who can read it in Frapp.`;
    case "export":
      return `An export does not say whether ${label} was private in Discord. Choose who can read it in Frapp.`;
    default:
      return `Choose who can read the new channel for ${label}.`;
  }
}
