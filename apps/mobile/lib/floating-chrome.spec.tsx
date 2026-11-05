import { describe, expect, it } from "vitest";
import { floatingTabBarBottom, floatingTabBarTop } from "./floating-chrome";

describe("floatingTabBarBottom", () => {
  it("tucks 8pt into a home indicator or gesture bar", () => {
    expect(floatingTabBarBottom(34)).toBe(26);
    expect(floatingTabBarBottom(24)).toBe(16);
  });

  it("keeps 12pt off the edge with no inset", () => {
    expect(floatingTabBarBottom(0)).toBe(12);
  });

  it("sits wholly above Android's three-button bar", () => {
    expect(floatingTabBarBottom(48)).toBeGreaterThan(48);
  });

  it("measures the bar's top as its bottom plus the drawn 62pt", () => {
    expect(floatingTabBarTop(34)).toBe(26 + 62);
  });
});
