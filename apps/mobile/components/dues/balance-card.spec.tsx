/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider, tint } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentFallbackApplied: false,
    accentPrimary: "#F4CB63",
    accentOnPrimary: "#2B2009",
    logoUrl: null,
    chapterName: "Tau Nu",
  }),
}));

import { BalanceCard } from "./balance-card";
import { InvoiceHistoryRow } from "./invoice-row";
import type { InvoiceRow } from "@/lib/dues/invoices";

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => ({ ...acc, ...flatten(entry) }),
      {},
    );
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Text" as unknown as React.ComponentType)
    .flatMap((node) =>
      React.Children.toArray(node.props.children).filter(
        (child): child is string => typeof child === "string",
      ),
    );
}

const baseProps = {
  label: "Fall 2026 dues",
  amountCents: 42500,
  due: { state: "upcoming" as const, label: "Due Sep 15" },
  payLabel: "Pay now",
  disabledReason: null,
  footnote: null,
  isPaying: false,
  onPay: () => {},
};

describe("BalanceCard", () => {
  it("renders the drawn two-tier amount and the due chip", () => {
    const rendered = texts(render(<BalanceCard {...baseProps} />));
    expect(rendered).toContain("$425");
    expect(rendered).toContain(".00");
    expect(rendered).toContain("Due Sep 15");
    expect(rendered).toContain("Pay now");
  });

  it("paints a past-due chip destructive, not amber", () => {
    // foundations.md §5 assigns "overdue" to the destructive role; a late bill
    // reading the same as an upcoming one is the confusion the palette exists
    // to prevent.
    const tree = render(
      <BalanceCard
        {...baseProps}
        due={{ state: "past-due", label: "Past due Sep 15" }}
      />,
    );
    const chip = tree.root
      .findAllByType("View" as unknown as React.ComponentType)
      .map((node) => flatten(node.props.style))
      .find((style) => style.height === 24);
    expect(chip?.backgroundColor).toBe(
      tint(signetDarkTokens.color.semantic.destructive),
    );
  });

  it("disables the CTA and names the blocker instead of hiding it", () => {
    // §5 rule 4: disable, don't hide, for a recoverable state — and never ship
    // a disabled control with no explanation.
    const reason = "Paying in the app needs the installed Frapp build.";
    const tree = render(
      <BalanceCard {...baseProps} disabledReason={reason} />,
    );
    const button = tree.root.findByType(
      "Pressable" as unknown as React.ComponentType,
    );
    expect(button.props.disabled).toBe(true);
    // Wired to the control, not just placed near it.
    expect(button.props.accessibilityHint).toBe(reason);
    expect(texts(tree)).toContain(reason);
  });

  it("hides the CTA entirely when there is nothing to pay", () => {
    const tree = render(
      <BalanceCard {...baseProps} payLabel={null} due={null} />,
    );
    expect(
      tree.root.findAllByType("Pressable" as unknown as React.ComponentType),
    ).toHaveLength(0);
  });

  it("says which invoice a tap pays when several are open", () => {
    const footnote = "Pays Fall 2026 dues — $425.00 of your balance.";
    const tree = render(<BalanceCard {...baseProps} footnote={footnote} />);
    expect(texts(tree)).toContain(footnote);
    expect(
      tree.root.findByType("Pressable" as unknown as React.ComponentType).props
        .disabled,
    ).toBe(false);
  });

  it("lets the blocker win over the footnote", () => {
    const tree = render(
      <BalanceCard
        {...baseProps}
        disabledReason="Blocked"
        footnote="Pays the first invoice."
      />,
    );
    expect(texts(tree)).toContain("Blocked");
    expect(texts(tree)).not.toContain("Pays the first invoice.");
  });

  it("shows the CTA busy while the sheet is opening", () => {
    const tree = render(<BalanceCard {...baseProps} isPaying />);
    expect(texts(tree)).toContain("Opening…");
    expect(
      tree.root.findByType("Pressable" as unknown as React.ComponentType).props
        .disabled,
    ).toBe(true);
  });
});

function invoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv-1",
    userId: "u-1",
    title: "Spring 2026 dues",
    description: null,
    amountCents: 42500,
    status: "PAID",
    dueDate: "2026-02-01",
    paidAt: "2026-02-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("InvoiceHistoryRow", () => {
  it("renders a settled invoice with the success chip", () => {
    const tree = render(<InvoiceHistoryRow invoice={invoice()} isLast />);
    expect(texts(tree)).toContain("Spring 2026 dues");
    expect(texts(tree)).toContain("Paid");
    const chip = tree.root
      .findAllByType("View" as unknown as React.ComponentType)
      .map((node) => flatten(node.props.style))
      .find((style) => style.height === 24);
    expect(chip?.backgroundColor).toBe(
      tint(signetDarkTokens.color.semantic.success),
    );
  });

  it("never paints a void invoice as paid", () => {
    // A cancelled invoice in green tells a member they settled something
    // nobody collected.
    const tree = render(
      <InvoiceHistoryRow invoice={invoice({ status: "VOID" })} isLast />,
    );
    expect(texts(tree)).toContain("Void");
    expect(texts(tree)).not.toContain("Paid");
  });
});
