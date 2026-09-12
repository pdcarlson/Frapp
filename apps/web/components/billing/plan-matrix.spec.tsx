import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MODULE_CATALOG } from "@repo/org-archetypes";
import { PlanMatrix } from "./plan-matrix";
import { ProChip } from "./pro-chip";

/**
 * The matrix is only worth anything if it is the catalog.
 *
 * Board `4d` note 3 says "rows read from the module catalog", and the board's
 * own rows describe a two-tier product this codebase does not have. The
 * failure mode this file exists to catch is someone transcribing those rows
 * back in: a price list for a Starter plan nobody can buy, telling a chapter
 * it has Events when `MODULE_CATALOG` marks Events `tier: "paid"`.
 */

const PAID = MODULE_CATALOG.filter((entry) => entry.tier === "paid");
const FREE = MODULE_CATALOG.filter((entry) => entry.tier === "free");

describe("PlanMatrix", () => {
  it("lists every paid module from the catalog, by its catalog label", () => {
    render(<PlanMatrix />);

    for (const entry of PAID) {
      expect(
        screen.getByText(entry.label),
        `${entry.key} is missing from the matrix`,
      ).toBeInTheDocument();
    }
  });

  it("groups the free tier onto one row, as the board groups a shared verdict", () => {
    render(<PlanMatrix />);

    const grouped = FREE.map((entry) => entry.label).join(", ");
    expect(screen.getByText(grouped)).toBeInTheDocument();
  });

  it("marks every paid row with the PRO chip and nothing else with it", () => {
    render(<PlanMatrix />);

    expect(screen.getAllByText("Pro")).toHaveLength(
      // One per paid row, plus the column header.
      PAID.length + 1,
    );
  });

  it("says Included or Not included in words, not only as a glyph", () => {
    // A screen reader announcing "black circle" fifty times answers nothing.
    render(<PlanMatrix />);

    // Free tier: one row, included in both columns. Paid: excluded from Free,
    // included in Pro.
    expect(screen.getAllByText("Not included")).toHaveLength(PAID.length);
    expect(screen.getAllByText("Included")).toHaveLength(PAID.length + 2);
  });

  it("invents no tier the product does not sell", () => {
    // `4d` draws Starter at "$3 per member / month" with an "Upgrade to Pro"
    // primary. There is one subscription here and no price in any contract the
    // client can read.
    const { container } = render(<PlanMatrix />);

    expect(screen.queryByText(/starter/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/upgrade to pro/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$\d/);
  });

  it("keeps the board's column shape: what you have now, and what the tier adds", () => {
    render(<PlanMatrix />);

    const header = screen.getByText("Module").parentElement!;
    expect(within(header).getByText("Free")).toBeInTheDocument();
    expect(within(header).getByText("Pro")).toBeInTheDocument();
  });
});

describe("ProChip", () => {
  it("takes the retinting accent family, never the fixed Ask gold", () => {
    // The lock, restated as a test because it is the one a greenfield lane is
    // most likely to break by accident. `--gold-ask-*` is fixed and belongs to
    // Ask; the board's chip is gold only because the demo tenant's seed is the
    // house gold. Product UI retints.
    const { container } = render(<ProChip />);
    const chip = container.firstElementChild as HTMLElement;

    expect(chip.className).toContain("border-accent-border");
    expect(chip.className).toContain("text-accent-text");
    expect(chip.className).not.toContain("gold-ask");
  });

  it("draws 4b's geometry and not the Badge primitive's", () => {
    // 18/5/10.5 outline, against `Badge`'s 28/8/12.5 filled. Reaching for
    // `Badge` and overriding five classes leaves a chip that silently follows
    // §5's badge recipe the next time §5 moves.
    const { container } = render(<ProChip />);
    const chip = container.firstElementChild as HTMLElement;

    expect(chip.className).toContain("h-[18px]");
    expect(chip.className).toContain("rounded-[5px]");
    expect(chip.className).toContain("text-[10.5px]");
    expect(chip.className).toContain("tracking-[0.04em]");
  });
});
