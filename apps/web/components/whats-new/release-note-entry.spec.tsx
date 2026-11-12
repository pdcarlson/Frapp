// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReleaseNoteEntry } from "@/components/whats-new/release-note-entry";

const lines = () => screen.getAllByRole("listitem").map((li) => li.textContent);

describe("ReleaseNoteEntry", () => {
  it("switches a split entry between Both, Web and Phone, opening on Web", async () => {
    render(
      <ReleaseNoteEntry
        idPrefix="t"
        note={{
          date: "2026-11-12",
          title: "A title",
          changes: ["Both."],
          web: ["Web one.", "Web two."],
          phone: ["Phone."],
        }}
      />,
    );
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Both 1",
      "Web 2",
      "Phone 1",
    ]);
    expect(screen.getByRole("radio", { name: "Web 2" })).toBeChecked();
    expect(lines()).toEqual(["Web one.", "Web two."]);
    await userEvent.click(screen.getByRole("radio", { name: "Phone 1" }));
    expect(lines()).toEqual(["Phone."]);
    await userEvent.click(screen.getByRole("radio", { name: "Both 1" }));
    expect(lines()).toEqual(["Both."]);
  });

  it("opens on the first place when there are no web lines", () => {
    render(
      <ReleaseNoteEntry
        idPrefix="t"
        note={{
          date: "2026-11-12",
          title: "t",
          changes: ["Both."],
          phone: ["P."],
        }}
      />,
    );
    expect(screen.getByRole("radio", { name: "Both 1" })).toBeChecked();
    expect(lines()).toEqual(["Both."]);
  });

  it("names the one place of an entry with only that place, with no switch", () => {
    render(
      <ReleaseNoteEntry
        idPrefix="t"
        note={{ date: "2026-11-12", title: "t", changes: [], phone: ["P."] }}
      />,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("On your phone")).toBeInTheDocument();
    expect(lines()).toEqual(["P."]);
  });

  it("shows an entry from before the split as one list with no switch", () => {
    render(
      <ReleaseNoteEntry
        idPrefix="t"
        note={{ date: "2026-11-07", title: "Old", changes: ["A.", "B."] }}
      />,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(lines()).toEqual(["A.", "B."]);
  });
});
