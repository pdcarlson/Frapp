import { render, screen } from "@testing-library/react";
import { memberAvatarTint } from "@repo/hooks";
import { describe, expect, it } from "vitest";

import { Avatar, AvatarFallback } from "./avatar";

describe("AvatarFallback", () => {
  it("draws the neutral circle without a tint", () => {
    render(
      <Avatar>
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    );
    const fallback = screen.getByText("JD");
    expect(fallback.className).toContain("bg-popover");
    expect(fallback.className).toContain("text-muted-foreground");
    expect(fallback.style.backgroundColor).toBe("");
    expect(fallback.getAttribute("data-avatar-tint")).toBeNull();
  });

  it("paints style A from a member's tint: the 14% fill and the full hue (#3860)", () => {
    const tint = memberAvatarTint("#F2994A");
    render(
      <Avatar>
        <AvatarFallback tint={tint}>JD</AvatarFallback>
      </Avatar>,
    );
    const fallback = screen.getByText("JD");
    // #43362B and #F2994A, as the browser serializes them.
    expect(fallback.style.backgroundColor).toBe("rgb(67, 54, 43)");
    expect(fallback.style.color).toBe("rgb(242, 153, 74)");
    expect(fallback.getAttribute("data-avatar-tint")).toBe("#F2994A");
  });
});
