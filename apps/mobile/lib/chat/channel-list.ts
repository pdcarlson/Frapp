/**
 * Selectors behind the s04 channel list.
 *
 * These live in `lib/` rather than beside the screen for a hard reason: every
 * `.tsx` under `app/` is picked up by expo-router's `requireContext`, so a
 * `*.spec.tsx` placed next to a screen is bundled into the app. Doing that pulls
 * `vitest` — and through it Vite's module runner — into the Metro graph and the
 * iOS bundle **fails to build**, while `lint`, `check-types`, and `vitest` all
 * stay green. Screen-adjacent logic that wants a test belongs here.
 *
 * Everything below parses `unknown`: `GET /v1/channels` infers as `never` in the
 * generated SDK, so nothing upstream is type-checked against the real payload.
 */

/** Minimal channel shape; the SDK response type is unusable. */
export interface ChannelSummary {
  id: string;
  name: string;
  type: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function selectChannels(data: unknown): ChannelSummary[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isRecord).flatMap((row) => {
    const id = row.id;
    const name = row.name;
    const type = row.type;
    if (typeof id !== "string" || typeof name !== "string") return [];
    return [{ id, name, type: typeof type === "string" ? type : "PUBLIC" }];
  });
}

export function isDirectChannel(channel: ChannelSummary): boolean {
  return channel.type === "DM" || channel.type === "GROUP_DM";
}

/**
 * DM channels are named by the server, not by a human: `dm-<uuidA>-<uuidB>` for
 * a pair and `group-dm-<epoch>` for a group (`chat.service.ts`). Rendered raw,
 * every DM row reads as a wall of uuid.
 *
 * Resolving the *other* participant's name needs a member lookup the chat
 * surface does not have — there is no display-name join anywhere on it, which is
 * why the thread also falls back to `Member <id-prefix>`. Until that lands
 * (#1000) this at least avoids showing the uuid: a generated name degrades to a
 * readable placeholder, and any DM a chapter actually titled keeps its title.
 */
export function displayChannelName(channel: ChannelSummary): string {
  if (!isDirectChannel(channel)) return channel.name;
  if (/^dm-[0-9a-f-]{36,}$/i.test(channel.name)) return "Direct message";
  if (/^group-dm-\d+$/.test(channel.name)) return "Group message";
  return channel.name;
}

/** `channel_id` → counts, so a row lookup is O(1) rather than a scan per row. */
export function indexUnread(
  rows: { channel_id: string; unread_count: number; mention_count: number }[],
): Record<string, { unread: number; mentions: number }> {
  const index: Record<string, { unread: number; mentions: number }> = {};
  for (const row of rows) {
    index[row.channel_id] = {
      unread: row.unread_count,
      mentions: row.mention_count,
    };
  }
  return index;
}
