import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ToolHeaderActions,
  ToolHeaderSlot,
} from "@/components/layout/tool-header-actions";

describe("ToolHeaderActions", () => {
  it("puts the page's action in its header, beside the X, while the header shows", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    render(
      <ToolHeaderSlot.Provider value={slot}>
        <ToolHeaderActions>
          <button type="button">New minutes</button>
        </ToolHeaderActions>
      </ToolHeaderSlot.Provider>,
    );
    expect(slot.textContent).toBe("New minutes");
    slot.remove();
  });

  it("keeps it in the page's action row without a header", () => {
    const { container } = render(
      <ToolHeaderActions>
        <button type="button">New minutes</button>
      </ToolHeaderActions>,
    );
    expect(container.contains(screen.getByRole("button"))).toBe(true);
  });
});
