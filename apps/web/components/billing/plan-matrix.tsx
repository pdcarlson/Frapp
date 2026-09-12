import { MODULE_CATALOG } from "@repo/org-archetypes";
import { EYEBROW } from "@/components/ui/typography";
import { ProChip } from "@/components/billing/pro-chip";

/**
 * What the subscription unlocks, board `4d`.
 *
 * **Rows come from `MODULE_CATALOG`, which is what the board asks for.** `4d`
 * note 3 reads "the single source for the PRO chips in nav (`4b`). Rows read
 * from the module catalog." So this reads ours — and ours does not say what
 * the board's says.
 *
 * `4d` draws a two-tier product: a **Starter** column holding "Chat, Ask,
 * Directory, Documents", "Events, Tasks, Points, Polls" and "Dues and invoices
 * (Stripe)", and a **Pro** column adding Backwork, study zones, reports and
 * Discord import. In this codebase `MODULE_CATALOG` splits `tier: "free"` from
 * `tier: "paid"`, and the split lands in a different place: five modules are
 * free (chat, members, announcements, audit log, chapter settings) and the
 * other twenty are paid, Events, Tasks, Points, Polls, Documents and Dues
 * among them. There is no Starter tier and no second subscription to buy; a
 * chapter either holds the one subscription or it does not.
 *
 * Transcribing the board's rows would therefore have printed a price list for
 * a product that does not exist, and told a Starter chapter it had Events. The
 * columns are the two states a chapter can actually be in, which is the same
 * shape the board draws — what you have now, and what the paid tier adds.
 *
 * **Grouping follows the board's own rule rather than inventing one.** `4d`
 * groups modules that share a verdict onto one row ("Events, Tasks, Points,
 * Polls" is four modules and one row) and gives every PRO row a line of its
 * own, because each is a distinct thing the chapter is being sold. Same here:
 * the free tier is one row, and each paid module is its own.
 *
 * Geometry is `4d`'s: radius 14 on the block, a 36px header, 40px rows,
 * top-border dividers, no zebra and no per-row fill — the table rule
 * [`deletion-checklist.md`](../../../../spec/ui/web-greenfield/deletion-checklist.md)
 * §9 already derived `/members` from.
 *
 * A server component: it reads a frozen constant and holds no state.
 */

const FREE_MODULES = MODULE_CATALOG.filter((entry) => entry.tier === "free");
const PAID_MODULES = MODULE_CATALOG.filter((entry) => entry.tier === "paid");

/**
 * The board's `●` and `–`.
 *
 * `--success` for included, and that is a status rather than decoration: the
 * cell answers "does this chapter get it". The absent cell takes `--disabled`,
 * the role foundations §5 gives to "present but not available", instead of a
 * second semantic hue — a red dash would read as something having gone wrong.
 *
 * The glyph is `aria-hidden` and the real answer is the visually hidden word
 * beside it, because a screen reader announcing "black circle" in a table of
 * fifty cells tells the listener nothing.
 */
function Cell({ included }: { included: boolean }) {
  return (
    <span
      className={
        included
          ? "text-center text-success"
          : "text-center text-disabled"
      }
    >
      <span aria-hidden="true">{included ? "●" : "–"}</span>
      <span className="sr-only">{included ? "Included" : "Not included"}</span>
    </span>
  );
}

const ROW_CLASS =
  "grid min-h-10 grid-cols-[1fr_72px_72px] items-center gap-2 border-t border-border px-4 py-1.5 sm:grid-cols-[1fr_120px_120px]";

export function PlanMatrix() {
  return (
    <section aria-labelledby="plan-matrix-heading" className="space-y-2">
      <h2
        id="plan-matrix-heading"
        className={`${EYEBROW} text-muted-foreground`}
      >
        What the subscription unlocks
      </h2>
      <div className="overflow-hidden rounded-lg border border-border">
        {/*
          A grid of rows rather than a `<table>`, matching the list grammar the
          flattened routes already use: `4d` draws no row rules, no zebra and no
          cell borders, and the only thing a `<table>` would add here is a
          layout algorithm that fights the fixed column widths the board
          specifies. The header is a row with `role="row"` semantics carried by
          the visible labels; each data row states its own verdict in words via
          `Cell`, so the columns do not have to be associated by header to be
          understood.
        */}
        <div
          className={`grid min-h-9 grid-cols-[1fr_72px_72px] items-center gap-2 bg-surface-1 px-4 text-[12.5px] font-semibold text-muted-foreground sm:grid-cols-[1fr_120px_120px]`}
        >
          <span>Module</span>
          <span className="text-center">Free</span>
          <span className="text-center text-accent-text">Pro</span>
        </div>

        <div className={ROW_CLASS}>
          <span className="min-w-0 text-sm">
            {FREE_MODULES.map((entry) => entry.label).join(", ")}
          </span>
          <Cell included />
          <Cell included />
        </div>

        {PAID_MODULES.map((entry) => (
          <div key={entry.key} className={ROW_CLASS}>
            <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{entry.label}</span>
              <ProChip />
            </span>
            <Cell included={false} />
            <Cell included />
          </div>
        ))}
      </div>
    </section>
  );
}
