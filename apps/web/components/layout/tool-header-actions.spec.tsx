import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ToolHeaderActions,
  ToolHeaderSlot,
} from "@/components/layout/tool-header-actions";

function width(wide: boolean) {
  const listeners: (() => void)[] = [];
  const query = {
    matches: wide,
    addEventListener: (_: string, listener: () => void) =>
      listeners.push(listener),
    removeEventListener: () => undefined,
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    set(next: boolean) {
      query.matches = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("ToolHeaderActions", () => {
  it("puts the page's action in its header, beside the X, while the header shows", () => {
    width(true);
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

  it("moves the same button, not a new one, when the width crosses the line", () => {
    const view = width(true);
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const { container } = render(
      <ToolHeaderSlot.Provider value={slot}>
        <ToolHeaderActions>
          <input aria-label="Hours" defaultValue="" />
        </ToolHeaderActions>
      </ToolHeaderSlot.Provider>,
    );
    const field = screen.getByLabelText("Hours") as HTMLInputElement;
    field.value = "3";
    view.set(false);
    expect(container.contains(field)).toBe(true);
    expect(screen.getByLabelText("Hours")).toBe(field);
    expect(field.value).toBe("3");
    slot.remove();
  });

  it("keeps it in the page's action row without a header", () => {
    width(true);
    const { container } = render(
      <ToolHeaderActions>
        <button type="button">New minutes</button>
      </ToolHeaderActions>,
    );
    expect(container.contains(screen.getByRole("button"))).toBe(true);
  });
});
