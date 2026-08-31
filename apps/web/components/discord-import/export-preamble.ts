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

import { parseExportPreamble as parseDiscordExportPreamble } from "@repo/validation";

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
 * The actual scanner (finding the structural `"messages"` key rather than the
 * first occurrence of the text, which breaks on a channel or category
 * literally named `messages`) lives in `@repo/validation`, shared with the
 * API worker's copy — this is just the wizard's flattened view of the same
 * `{guild, channel}` header.
 */
export function parseExportPreamble(head: string): ExportPreamble | null {
  const parsed = parseDiscordExportPreamble(head);
  const channelId = parsed?.channel.id;
  if (!channelId) return null;
  return {
    guildName: parsed.guild.name,
    channelId,
    channelName: parsed.channel.name ?? channelId,
    category: parsed.channel.category,
  };
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
