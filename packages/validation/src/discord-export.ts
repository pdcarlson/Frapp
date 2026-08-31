/**
 * Read the `{guild, channel}` header off a DiscordChatExporter (DCE) JSON
 * export part.
 *
 * Shared between the web import wizard (against the first 64 KB of a file, to
 * build the channel-mapping step without uploading anything) and the API
 * worker (against the real part it is about to import). **The worker's use is
 * the authoritative one** — the wizard sends the channel ids it read
 * client-side, but the import keys every message on the id the worker reads
 * itself, from the bytes actually being parsed, so a client that lied about
 * which channel a part belongs to cannot redirect a Discord channel's history
 * into a Signet channel the admin did not choose. This module only supplies
 * the parser both sides use; the trust boundary is enforced by which call site
 * is treated as authoritative, not by anything here.
 *
 * This used to be implemented twice, once per workspace, with the same
 * `findMessagesKey` depth-tracking scanner. Both copies shared a bug: cutting
 * on the first literal occurrence of `"messages"` breaks on a guild with a
 * channel or category actually named `messages` — the truncation lands inside
 * `"name":"messages"`, the parse fails, and the channel silently vanishes from
 * whichever side is calling. Both copies needed the same fix, which is the
 * reason this lives in one place now.
 */

export interface DiscordExportPreamble {
  guild: { id: string | null; name: string | null };
  channel: {
    id: string | null;
    name: string | null;
    category: string | null;
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Find the structural `"messages"` KEY, not the first occurrence of the text.
 *
 * A key is a quoted string followed by optional whitespace and a colon, at
 * nesting depth 1, outside any string. Tracking depth and string state is
 * enough here; the preamble has no escapes worth a full parser.
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
      // A key only counts at the top level of the root object, and only when a
      // colon follows the closing quote.
      if (depth === 1 && input.startsWith('"messages"', i)) {
        const after = input.slice(i + '"messages"'.length).match(/^\s*:/);
        if (after) return i;
      }
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return -1;
}

export function parseExportPreamble(
  input: string,
): DiscordExportPreamble | null {
  const guildStart = input.indexOf('"guild"');
  if (guildStart === -1) return null;

  // Truncate at the messages array and close the object, so a 400 MB file can
  // be described from its first few KB.
  const messagesKey = findMessagesKey(input);
  const head =
    messagesKey === -1
      ? input
      : `${input.slice(0, messagesKey).replace(/,\s*$/, "")}}`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(head);
  } catch {
    return null;
  }

  const root = asRecord(parsed);
  const guild = asRecord(root?.guild);
  const channel = asRecord(root?.channel);
  if (!channel) return null;

  return {
    guild: { id: asString(guild?.id), name: asString(guild?.name) },
    channel: {
      id: asString(channel.id),
      name: asString(channel.name),
      category: asString(channel.category),
    },
  };
}
