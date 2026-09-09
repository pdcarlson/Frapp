/**
 * Discord reaction totals stored on an imported message's `payload`.
 *
 * The importer writes `{ emoji, name, count }` and drops per-reactor
 * attribution — there is nobody in `users` to attach a click to. This module
 * only *reads* that summary; it must not invent identities or mint live
 * `chat_message_actions` rows. Cap matches `MAX_SUMMARISED_REACTIONS` in
 * `apps/api/src/domain/utils/discord-export.ts` so a client cannot draw more
 * chips than the writer stored.
 */

/** Matches `MAX_SUMMARISED_REACTIONS` on the importer. */
export const MAX_IMPORTED_REACTION_CHIPS = 20;

export interface ImportedReaction {
  emoji: string;
  name: string | null;
  count: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reaction totals to draw under an imported archive row. Empty for every
 * other kind, so a live message cannot spoof the strip by stuffing
 * `payload.reactions`.
 */
export function selectImportedReactions(
  kind: string | undefined,
  payload: Record<string, unknown> | null | undefined,
): ImportedReaction[] {
  if (kind !== "imported" || !payload) return [];
  const raw = payload.reactions;
  if (!Array.isArray(raw)) return [];

  const out: ImportedReaction[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_IMPORTED_REACTION_CHIPS) break;
    const rec = asRecord(entry);
    if (!rec) continue;
    const emoji = typeof rec.emoji === "string" ? rec.emoji.trim() : "";
    const name =
      typeof rec.name === "string" && rec.name.trim().length > 0
        ? rec.name.trim()
        : null;
    const count =
      typeof rec.count === "number" && Number.isFinite(rec.count)
        ? rec.count
        : 0;
    if (!emoji || count <= 0) continue;
    out.push({ emoji, name, count });
  }
  return out;
}

/**
 * What the chip shows. Unicode pictographs pass through; a custom Discord
 * emoji is a name with no image in v1 (`--media` files are not referenced),
 * so wrap it as `:name:` rather than rendering it as prose.
 */
export function importedReactionGlyph(reaction: ImportedReaction): string {
  if (/\p{Extended_Pictographic}/u.test(reaction.emoji)) {
    return reaction.emoji;
  }
  const token = (reaction.name ?? reaction.emoji).replaceAll(":", "");
  return token.length > 0 ? `:${token}:` : reaction.emoji;
}
