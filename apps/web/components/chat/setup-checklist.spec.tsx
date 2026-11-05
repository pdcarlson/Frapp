import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SetupChecklist } from "@repo/hooks";

const { state } = vi.hoisted(() => ({
  state: {
    checklist: null as SetupChecklist | null,
    hide: (() => {}) as () => void,
  },
}));

vi.mock("@repo/hooks", () => ({
  useChapterSetupChecklist: () => ({
    checklist: state.checklist,
    hide: state.hide,
  }),
}));

const {
  HIDE_SETUP_CHECKLIST_LABEL,
  SETUP_CHECKLIST_HREF,
  SetupChecklistSection,
} = await import("./setup-checklist");

const TWO_OF_FIVE: SetupChecklist = {
  doneCount: 2,
  lines: [
    { key: "invite", label: "Invite members", done: true },
    { key: "event", label: "Schedule the first event", done: true },
    { key: "study-zone", label: "Add a study zone", done: false },
    { key: "document", label: "Upload the bylaws", done: false },
    { key: "dues", label: "Send the first dues", done: false },
  ],
};

beforeEach(() => {
  state.checklist = null;
  state.hide = vi.fn();
});

describe("SetupChecklistSection", () => {
  it("draws nothing when there is nothing to set up", () => {
    const { container } = render(<SetupChecklistSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the list and how far along it is", () => {
    state.checklist = TWO_OF_FIVE;
    render(<SetupChecklistSection />);
    const region = screen.getByRole("region", { name: "Set up your chapter" });
    expect(within(region).getByText("2 of 5")).toBeInTheDocument();
  });

  it("links each line to the screen where it gets done", () => {
    state.checklist = TWO_OF_FIVE;
    render(<SetupChecklistSection />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/members",
      "/events",
      "/geofences",
      "/documents",
      "/billing",
    ]);
    expect(SETUP_CHECKLIST_HREF["study-zone"]).toBe("/geofences");
  });

  it("tells a screen reader which lines are done", () => {
    state.checklist = TWO_OF_FIVE;
    render(<SetupChecklistSection />);
    expect(
      screen.getByRole("link", { name: "Invite members, done" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add a study zone" }),
    ).toBeInTheDocument();
  });

  it("draws lines on the Row step: 32 on a mouse, 44 on touch", () => {
    // foundations.md §9. The row is hand-rolled, so the primitives'
    // touch-floor spec does not cover it.
    state.checklist = TWO_OF_FIVE;
    render(<SetupChecklistSection />);
    const row = screen.getByRole("link", { name: "Add a study zone" });
    expect(row.className.split(" ")).toEqual(
      expect.arrayContaining(["min-h-8", "pointer-coarse:min-h-11"]),
    );
    const hide = screen.getByRole("button", {
      name: HIDE_SETUP_CHECKLIST_LABEL,
    });
    expect(hide.className.split(" ")).toContain("pointer-coarse:size-11");
  });

  it("hides from an icon button with its own label", () => {
    state.checklist = TWO_OF_FIVE;
    render(<SetupChecklistSection />);
    fireEvent.click(
      screen.getByRole("button", { name: HIDE_SETUP_CHECKLIST_LABEL }),
    );
    expect(state.hide).toHaveBeenCalledTimes(1);
  });
});
