// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReleaseNoteEntry } from "@/components/whats-new/release-note-entry";

describe("ReleaseNoteEntry", () => {
  it("lists the lines for both first, then Web and Mobile under subheadings", () => {
    const { container } = render(
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
    expect(
      screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent),
    ).toEqual(["Web", "Mobile"]);
    expect(
      [...container.querySelectorAll("h4, li")].map((el) => el.textContent),
    ).toEqual(["Both.", "Web", "Web one.", "Web two.", "Mobile", "Phone."]);
  });

  it("shows an entry from before the split as one list with no subheadings", () => {
    render(
      <ReleaseNoteEntry
        idPrefix="t"
        note={{ date: "2026-11-07", title: "Old", changes: ["A.", "B."] }}
      />,
    );
    expect(screen.queryAllByRole("heading", { level: 4 })).toEqual([]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("bolds the lines the latest deploy brought, under a caption saying so", () => {
    render(
      <ReleaseNoteEntry
        idPrefix="t"
        fresh={["Web two."]}
        note={{
          date: "2026-11-16",
          title: "A title",
          changes: ["Both."],
          web: ["Web one.", "Web two."],
        }}
      />,
    );
    screen.getByText("Lines in bold came with your latest update.");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.className.includes("font-semibold"))).toEqual([
      false,
      false,
      true,
    ]);
    expect(items[2]?.textContent).toBe("New: Web two.");
  });

  it("marks nothing when every line of the entry is new", () => {
    render(
      <ReleaseNoteEntry
        idPrefix="t"
        fresh={["A.", "B."]}
        note={{ date: "2026-11-16", title: "New", changes: ["A.", "B."] }}
      />,
    );
    expect(
      screen.queryByText("Lines in bold came with your latest update."),
    ).toBeNull();
    for (const li of screen.getAllByRole("listitem")) {
      expect(li.className).not.toContain("font-semibold");
    }
  });
});
