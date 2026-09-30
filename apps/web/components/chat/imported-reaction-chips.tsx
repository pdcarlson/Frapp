import { CHIP } from "./chip";
import { cn } from "@/lib/utils";
import {
  importedReactionGlyph,
  type ImportedReaction,
} from "./imported-reactions";

/**
 * Read-only reaction totals from an imported Discord archive.
 *
 * Same 26px chip geometry as {@link ReactionChips} (`components.md` §11), but
 * these are `<span>`s: there is nobody to attribute a click to, so they must
 * not be buttons and must not call `onReact`.
 */
export function ImportedReactionChips({
  reactions,
}: {
  reactions: ImportedReaction[];
}) {
  if (reactions.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {reactions.map((reaction) => {
        const glyph = importedReactionGlyph(reaction);
        return (
          <span
            key={`${reaction.emoji}:${reaction.name ?? ""}`}
            className={cn(CHIP.base, CHIP.neutral, "pointer-events-none gap-1")}
            aria-label={`${glyph} reaction, ${reaction.count}. From the imported archive; not clickable.`}
          >
            <span aria-hidden="true">{glyph}</span>
            <span aria-hidden="true" className="tabular-nums">
              {reaction.count}
            </span>
          </span>
        );
      })}
    </div>
  );
}
