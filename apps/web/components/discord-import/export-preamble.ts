/**
 * Read a DiscordChatExporter export's header without loading the file.
 *
 * A partition can be megabytes and a chapter's export can be hundreds of them,
 * so the channel-mapping step is built from each file's first 64 KB rather than
 * from its contents. `File.slice()` reads only that range off disk.
 *
 * This is a **hint**, not a decision. The server re-reads the real preamble from
 * the bytes it is importing and keys the mapping on the channel id it read
 * there — so a wrong or tampered value here cannot redirect a Discord channel's
 * history into a Signet channel the admin did not choose.
 */

export const PREAMBLE_READ_BYTES = 64 * 1024;

export interface ExportPreamble {
  guildName: string | null;
  channelId: string;
  channelName: string;
  category: string | null;
}

/**
 * Parse the header out of a truncated export.
 *
 * Cuts at the `"messages"` key and closes the object. The cut is anchored after
 * the channel object rather than on the first occurrence, because `"messages"`
 * appears legitimately inside `channel.topic` — a chapter whose #general topic
 * says "read the pinned messages" would otherwise be unparseable.
 */
export function parseExportPreamble(head: string): ExportPreamble | null {
  const guildStart = head.indexOf('"guild"');
  if (guildStart === -1) return null;

  const messagesKey = head.indexOf('"messages"', guildStart);
  const truncated =
    messagesKey === -1
      ? head
      : `${head.slice(0, messagesKey).replace(/,\s*$/, "")}}`;

  try {
    const parsed = JSON.parse(truncated) as {
      guild?: { name?: string | null };
      channel?: { id?: string; name?: string; category?: string | null };
    };
    const channelId = parsed.channel?.id;
    if (!channelId) return null;
    return {
      guildName: parsed.guild?.name ?? null,
      channelId,
      channelName: parsed.channel?.name ?? channelId,
      category: parsed.channel?.category ?? null,
    };
  } catch {
    return null;
  }
}

/** True when a file sits in a DCE `_Files` media folder. */
export function isMediaFile(relativePath: string): boolean {
  return /_Files\//.test(relativePath);
}

/**
 * Strip the export's own root folder off a browser-supplied relative path.
 *
 * `webkitRelativePath` is always prefixed with the folder the admin picked, and
 * that name is theirs, not the export's. Dropping it keeps the manifest key
 * equal to the path DCE writes into the JSON — which is the whole point of the
 * key.
 */
export function toExportRelativePath(webkitRelativePath: string): string {
  const slash = webkitRelativePath.indexOf("/");
  return slash === -1
    ? webkitRelativePath
    : webkitRelativePath.slice(slash + 1);
}
