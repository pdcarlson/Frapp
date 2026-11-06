import type { ChannelChoice } from "./mapping-issues";
import type { StagedChannel } from "./upload-step";
import type { SameAsDiscordReaders } from "./role-matching";

/**
 * What a "Who can read" control over many channels shows: the answer every
 * new channel in its reach shares, `mixed` when they disagree, `unset` when
 * none of them is answered yet, or null when none of them is imported as a
 * new channel (there is nothing to set).
 *
 * "Same as Discord" is the default a bot import starts from, so it has to
 * read as one answer even though only the private channels hold it: a public
 * channel is whole-chapter in Discord too. It is shown when every channel
 * whose Discord readers are known is on Same as Discord and every other one
 * is whole-chapter.
 *
 * A channel with no answer yet makes it Mixed (or Choose… when none is
 * answered). Showing the others' shared answer instead would make picking
 * that same answer do nothing, since a select only reports a change.
 */
export type BulkVisibilityState =
  NonNullable<ChannelChoice["visibility"]> | "mixed" | "unset";

export function bulkVisibilityState(
  targets: readonly StagedChannel[],
  choices: Record<string, ChannelChoice>,
  readersOf: (channel: StagedChannel) => SameAsDiscordReaders | null,
): BulkVisibilityState | null {
  const creating = targets.filter(
    (channel) => choices[channel.channelId]?.action === "create_new",
  );
  if (creating.length === 0) return null;
  const answered = creating.flatMap((channel) => {
    const visibility = choices[channel.channelId]?.visibility;
    return visibility === undefined
      ? []
      : [{ visibility, knowsReaders: !!readersOf(channel) }];
  });
  if (answered.length === 0) return "unset";
  if (answered.length < creating.length) return "mixed";
  const all = (visibility: ChannelChoice["visibility"]) =>
    answered.every((entry) => entry.visibility === visibility);
  if (all("chapter")) return "chapter";
  if (all("restricted")) return "restricted";
  if (
    answered.some((entry) => entry.visibility === "discord") &&
    answered.every((entry) =>
      entry.knowsReaders
        ? entry.visibility === "discord"
        : entry.visibility === "chapter",
    )
  ) {
    return "discord";
  }
  return "mixed";
}
