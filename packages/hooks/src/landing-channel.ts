/**
 * Which channel Chat opens on when nothing named one: the member's last
 * channel, else `#general`, else the first row (owner, 2026-11-05: "Mobile
 * opens up to the last channel you were in. like discord").
 *
 * One rule for every reader, so they cannot disagree:
 *
 * - web's `chat-shell.tsx`, as the last rung of the open channel, after
 *   `?channel=` and after a still-valid selection;
 * - web's first-chunk cache, which never evicts this channel's tail, because
 *   it is the one a cold load paints first;
 * - mobile's chat home, which opens this channel on launch when the member
 *   was last in one (`lastChannelLandingId`, no fallback there: with no last
 *   channel the phone stays on the list).
 *
 * The last channel is remembered on the device, per member and chapter
 * (`lastChannelStorageKey`), not on the server: it is where this device was,
 * and a phone and a laptop open where each one left off.
 *
 * Never a DM the member hid (#2303): it is still in `GET /v1/channels`,
 * flagged `hidden`, but landing on it would put back on screen the
 * conversation they just put away. A remembered channel the member can no
 * longer see is simply absent from the list and falls through.
 */
export type LandingChannel = { id: string; name: string; hidden?: boolean };

/** The remembered channel, when it is still listed and not hidden. */
export function lastChannelLandingId(
  channels: readonly LandingChannel[],
  lastChannelId: string | null | undefined,
): string | null {
  if (!lastChannelId) return null;
  return channels.some((c) => c.id === lastChannelId && !c.hidden)
    ? lastChannelId
    : null;
}

export function landingChannelId(
  channels: readonly LandingChannel[],
  lastChannelId?: string | null,
): string | null {
  const listed = channels.filter((channel) => !channel.hidden);
  return (
    lastChannelLandingId(listed, lastChannelId) ??
    listed.find((channel) => channel.name === "general")?.id ??
    listed[0]?.id ??
    null
  );
}

/**
 * Where a device keeps the member's last channel: localStorage on web,
 * AsyncStorage on mobile. Scoped to the member and the chapter, so a shared
 * browser or a chapter switch never opens someone else's or another
 * chapter's channel.
 */
export function lastChannelStorageKey(
  userId: string,
  chapterId: string,
): string {
  return `frapp.chat.last-channel.${userId}.${chapterId}`;
}
