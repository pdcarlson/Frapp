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
 * Find the structural `"messages"` KEY, not the first occurrence of the text.
 *
 * `indexOf('"messages"')` is wrong in a way that only shows up on real data: a
 * guild with a channel or category literally named `messages` puts
 * `"name":"messages"` in the preamble, the cut lands mid-object, and the parse
 * fails — so that channel silently disappears from the mapping grid and the
 * worker later skips its entire history with a warning nobody reads.
 *
 * A key is a quoted string followed by a colon, at nesting depth 1, outside any
 * string. Kept in step with `findMessagesKey` in
 * `apps/api/src/domain/utils/discord-export.ts`, which is the authority — this
 * copy only decides what the mapping grid shows.
 */
function findMessagesKey(input: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      if (depth === 1 && input.startsWith('"messages"', i)) {
        if (/^\s*:/.test(input.slice(i + '"messages"'.length))) return i;
      }
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return -1;
}

/** Parse the header out of a truncated export. */
export function parseExportPreamble(head: string): ExportPreamble | null {
  const guildStart = head.indexOf('"guild"');
  if (guildStart === -1) return null;

  const messagesKey = findMessagesKey(head);
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
