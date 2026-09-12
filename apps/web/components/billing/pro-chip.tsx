import { cn } from "@/lib/utils";

/**
 * The **PRO** marker, board `4b`.
 *
 * Board `4b` draws two kinds of locked row and gives them different markers: a
 * lock glyph for "in the plan, switched off by an officer", and this chip for
 * "not in plan". `4d` then reuses it down the plan matrix's paid rows, which is
 * the only surface in this lane that renders one — the nav's copy is `4b`, and
 * the nav belongs to lane 2.
 *
 * **Geometry is the board's, and it is not the `Badge` primitive's.** `4b` draws
 * 18px tall, radius 5, 10.5/700 tracked out 0.04em, outline only with no fill.
 * `Badge` is 28/8/12.5 with a fill on every kind. Reaching for `Badge` here and
 * overriding five classes would leave a chip that silently follows §5's badge
 * recipe the next time §5 moves, which is the opposite of what a marker at half
 * a badge's height wants. So this is its own recipe, in one module, for the
 * reason `chat/chip.ts` gives about its own: the eleventh and twelfth copies of
 * a class string are how two chips quietly become different chips.
 *
 * 18, 5, 10.5 and 0.04em are all off the Tailwind scales and are arbitrary
 * values here, exactly as `CHIP`'s 26 and 9 are.
 *
 * **The paints are `--accent-*`, and that is the decision most worth stating.**
 * The board writes the chip as `#6B5A24` border on `#DDB844` text, which under
 * the demo tenant is its `--accent-border` and its mark gold at once — the trap
 * [`tokens.md`](../../../../spec/ui/web-greenfield/tokens.md) §L-01 names, where
 * the house seed and the house gold coincide and make the fixed Ask family look
 * identical to the retinting accent family. Two readings follow from that, and
 * only one is allowed:
 *
 * - `--gold-ask-*`, the fixed family, would freeze this chip gold on every
 *   chapter. That is the merge the ask lock forbids in the other direction, and
 *   it would spend Ask's tokens on something that is not Ask.
 * - `--accent-*` retints per chapter, which is what product UI is supposed to
 *   do — the same call lane 4 made for `/documents`' file-row icon tile, and
 *   recorded in [`deletion-checklist.md`](../../../../spec/ui/web-greenfield/deletion-checklist.md)
 *   §8.
 *
 * So: accent, and `--gold-ask-*` is not imported here or anywhere in this lane.
 *
 * **It is not a status, which is why it may take the accent at all.**
 * `status-contrast.spec.ts` measures that an accent badge is indistinguishable
 * from a *status* badge under a green- or red-accented chapter, and
 * `writing.md` §5's rule is that status colour is never decorative. PRO states
 * an entitlement — whether a module needs the subscription — not how something
 * is going, and the matrix's own status column beside it is the semantic
 * `--success` dot. Do not reach for this chip to mean "at risk".
 */
export function ProChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-[5px] border px-1.5",
        "text-[10.5px] font-bold uppercase leading-none tracking-[0.04em]",
        "border-accent-border text-accent-text",
        className,
      )}
    >
      Pro
    </span>
  );
}
