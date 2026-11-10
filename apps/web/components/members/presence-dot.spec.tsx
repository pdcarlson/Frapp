import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AvatarPresenceDot,
  CustomStatusLine,
  PresenceGlyph,
} from "./presence-dot";

describe("AvatarPresenceDot", () => {
  it("renders nothing while presence is unknown", () => {
    const { container } = render(<AvatarPresenceDot status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  // #3845: DND differs from Online by shape, not only by hue.
  it("draws DND's dark bar, and no bar on any other status", () => {
    const { container, rerender } = render(<AvatarPresenceDot status="dnd" />);
    const dot = container.querySelector("[data-presence='dnd']")!;
    expect(dot).toHaveClass("bg-destructive");
    expect(dot.querySelector(".bg-destructive-foreground")).not.toBeNull();

    for (const status of ["online", "idle", "invisible", "offline"] as const) {
      rerender(<AvatarPresenceDot status={status} />);
      expect(
        container.querySelector(".bg-destructive-foreground"),
        status,
      ).toBeNull();
    }
  });

  it("is decorative, so its caller names the status", () => {
    const { container } = render(<AvatarPresenceDot status="dnd" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("PresenceGlyph", () => {
  it("draws the same shape, without the avatar ring", () => {
    const { container } = render(<PresenceGlyph status="dnd" />);
    const dot = container.querySelector("[data-presence='dnd']")!;
    expect(dot.className).not.toMatch(/\bring-2\b/);
    expect(dot.querySelector(".bg-destructive-foreground")).not.toBeNull();
  });
});

describe("CustomStatusLine", () => {
  it("renders the line, or nothing without one", () => {
    const { container, rerender } = render(<CustomStatusLine line="Out" />);
    expect(container).toHaveTextContent("Out");
    rerender(<CustomStatusLine line={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
