import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PREVIEW_ROWS, SidebarPreview } from "./sidebar-preview";

describe("SidebarPreview", () => {
  it("draws nothing when the import makes no channel", () => {
    const { container } = render(<SidebarPreview sections={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists a section's first rows, then says how many more it holds", () => {
    const channels = Array.from({ length: PREVIEW_ROWS + 3 }, (_, index) => ({
      name: `channel-${index}`,
      locked: index === 0,
    }));
    render(
      <SidebarPreview
        sections={[
          { key: "group:rush", group: "Rush", existing: false, channels },
        ]}
      />,
    );
    const rows = within(screen.getByRole("list", { name: "Rush" }))
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(rows).toHaveLength(PREVIEW_ROWS + 1);
    // Marked as the sidebar marks a private channel, and said for a reader.
    expect(rows[0]).toBe("Private: channel-0");
    expect(rows[1]).toBe("#channel-1");
    expect(rows.at(-1)).toBe("and 3 more");
  });

  it("heads the channels in no group as the sidebar does", () => {
    render(
      <SidebarPreview
        sections={[
          {
            key: "none",
            group: null,
            existing: false,
            channels: [{ name: "general", locked: false }],
          },
        ]}
      />,
    );
    expect(screen.getByRole("list", { name: "Channels" })).toBeInTheDocument();
  });
});
