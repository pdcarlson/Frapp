import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PageActions,
  PageHeaderSlotProvider,
} from "@/components/layout/page-actions";
import { NewButton, newLabel } from "@/components/ui/new-button";

/** The shell's wiring: a header slot, and the page under it. */
function Shell({
  headerShown,
  children,
}: {
  headerShown: boolean;
  children: React.ReactNode;
}) {
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  return (
    <>
      <div data-testid="header">
        <div ref={setSlot} />
      </div>
      <div data-testid="page">
        <PageHeaderSlotProvider slot={headerShown ? slot : null}>
          {children}
        </PageHeaderSlotProvider>
      </div>
    </>
  );
}

describe("PageActions", () => {
  it("renders into the page header when the header shows (Paul, 2026-11-19)", () => {
    render(
      <Shell headerShown>
        <PageActions>
          <NewButton thing="minutes" />
        </PageActions>
      </Shell>,
    );
    const button = within(screen.getByTestId("header")).getByRole("button", {
      name: "New minutes",
    });
    expect(button).toBeInTheDocument();
    expect(
      within(screen.getByTestId("page")).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("stays a row at the top of the page when there is no page header", () => {
    render(
      <Shell headerShown={false}>
        <PageActions>
          <NewButton thing="event" />
        </PageActions>
      </Shell>,
    );
    expect(
      within(screen.getByTestId("page")).getByRole("button", {
        name: "New event",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("header")).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("renders inline outside the shell", () => {
    render(
      <PageActions>
        <NewButton thing="task" />
      </PageActions>,
    );
    expect(screen.getByRole("button", { name: "New task" })).toHaveAttribute(
      "class",
      expect.stringContaining("text-primary"),
    );
  });
});

describe("NewButton", () => {
  it("is always New and the thing it makes", () => {
    expect(newLabel("study zone")).toBe("New study zone");
  });
});
