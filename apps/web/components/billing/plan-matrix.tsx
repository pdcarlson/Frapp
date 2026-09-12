import { MODULE_CATALOG } from "@repo/org-archetypes";
import { DASHBOARD_NAV_ITEMS } from "@/components/layout/nav-config";
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
 * A server component: it reads frozen constants and holds no state.
 */

/**
 * The paid modules this product actually ships a surface for.
 *
 * **`tier === "paid"` alone is the wrong filter, and the first cut of this file
 * used it.** `MODULE_CATALOG` is the master plan's catalog, not a manifest of
 * what is built: twenty entries carry `tier: "paid"`, and seven of them —
 * `academics`, `philanthropy`, `risk`, `lines`, `networking`, `standards`,
 * `serviceFirst` — have no controller, no route, no nav row and no
 * `@RequireModule` anywhere in the repo. They are archetype flavour flags.
 * Listing them under a heading reading "What the subscription unlocks", with a
 * semantic `--success` dot and the words "Included", sells a president seven
 * capabilities that do not exist — which is the same invention this lane
 * refused one block up, when it omitted `4d`'s price and seat count rather
 * than placeholder them.
 *
 * So the filter is "does a member have somewhere to go", and the maintained
 * answer to that in `apps/web` is `nav-config.ts`: a module key on a nav item
 * is a surface, and this app owns and updates that file. Deriving beats a
 * hand-kept list, which would drift the first time a module shipped.
 *
 * Two deliberate adjustments to what the nav alone would produce:
 *
 * - **`dues` is added.** Its surface is this page's own invoice list rather
 *   than a nav row of its own, so the nav cannot see it — but invoice writes
 *   are genuinely subscription-gated (the `SubscriptionNotice` on this very
 *   screen is that gate), and `4d` draws a "Dues and invoices (Stripe)" row.
 *   Omitting it would understate what the subscription buys, on the page that
 *   sells it.
 * - **`billing` can never appear**, and would be actively self-contradicting
 *   if it did. `BillingController` is class-level `@SubscriptionExempt()`
 *   precisely so the chapter can reach the screen that ungates it
 *   (`design-system/README.md` §5 rule 3), and the `/billing` nav row
 *   correspondingly carries no `module` key. A "Billing — not included in
 *   Free" row would tell an `incomplete` president that the page they are
 *   standing on is locked behind the purchase they are making from it. The
 *   nav derivation already excludes it; the test pins that it stays excluded.
 *
 * `rush` and `onboarding` fall out for the honest reason: the API gates `rush`
 * but `apps/web` ships no route for it, so on this surface the subscription
 * unlocks nothing a member can see.
 */
const SHIPPED_PAID_KEYS = new Set<string>([
  ...DASHBOARD_NAV_ITEMS.flatMap((item) => (item.module ? [item.module] : [])),
  "dues",
]);

const FREE_MODULES = MODULE_CATALOG.filter((entry) => entry.tier === "free");
const PAID_MODULES = MODULE_CATALOG.filter(
  (entry) => entry.tier === "paid" && SHIPPED_PAID_KEYS.has(entry.key),
);

/**
 * The board's `●` and `–`.
 *
 * `--success` for included, and that is a status rather than decoration: the
 * cell answers "does this chapter get it". The absent cell is **not** a second
 * semantic hue — a red dash would read as something having gone wrong — and it
 * is not `--disabled` either, which the first cut of this file used on
 * foundations §5's "present but not available" reading. That token is
 * `#57534C`, which measures **2.45:1** on `--background` and 2.28:1 on
 * `--surface-1`, under the 4.5:1 text minimum `design-system/README.md` §6
 * sets as a release gate. WCAG's inactive-control exemption does not cover it:
 * this is informational content, not a disabled control. `--muted-foreground`
 * is the adjacent role that clears it, at 7.47:1 and 6.95:1.
 *
 * **The glyph is `aria-hidden` and the accessible text names its column.** A
 * screen reader announcing "black circle" twenty times tells the listener
 * nothing, which is why the words are there — but "Included" alone was worse
 * than nothing: this block is `<div>`s in a grid, with no table semantics and
 * no header association, so a linear read of a paid row produced
 * "Events · Pro · Not included · Included", whose most natural parse is the
 * exact inverse of the fact. Naming the column in the cell is what makes each
 * row self-describing, and it is cheaper than retrofitting table semantics
 * onto a layout `4d` draws with none.
 */
function Cell({ included, column }: { included: boolean; column: string }) {
  return (
    <span
      className={
        included
          ? "text-center text-success"
          : "text-center text-muted-foreground"
      }
    >
      <span aria-hidden="true">{included ? "●" : "–"}</span>
      <span className="sr-only">
        {included ? `Included in ${column}` : `Not included in ${column}`}
      </span>
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
          specifies.

          **That costs header association, and `Cell` pays for it rather than
          this comment waving it away.** An earlier draft of this block claimed
          the header carried `role="row"` semantics; it does not, there is no
          `role` attribute in this file, and the claim was the reason the cells
          were left announcing a bare "Included". Each cell now names its own
          column in its visually hidden text, so a row reads
          "Events, Pro, not included in Free, included in Pro" with no header
          to remember. The visible header row stays a visual label.
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
          <Cell included column="Free" />
          <Cell included column="Pro" />
        </div>

        {PAID_MODULES.map((entry) => (
          <div key={entry.key} className={ROW_CLASS}>
            <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{entry.label}</span>
              <ProChip />
            </span>
            <Cell included={false} column="Free" />
            <Cell included column="Pro" />
          </div>
        ))}
      </div>
    </section>
  );
}
