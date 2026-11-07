import { describe, expect, it } from "vitest";
import { keyFromLabel } from "./key-from-label";

describe("keyFromLabel", () => {
  it("slugs the name", () => {
    expect(keyFromLabel("Pledge Educator", [])).toBe("pledge_educator");
    expect(keyFromLabel("  Risk & Safety Chair ", [])).toBe(
      "risk_safety_chair",
    );
    expect(keyFromLabel("Café Rep", [])).toBe("cafe_rep");
  });

  it("numbers a key the chapter already uses", () => {
    expect(
      keyFromLabel("Pledge Educator", ["pledge_educator", "pledge_educator_2"]),
    ).toBe("pledge_educator_3");
  });

  it("falls back when the name has no letters or digits", () => {
    expect(keyFromLabel("!!!", [])).toBe("role");
  });

  it("stays inside the API's length cap", () => {
    const key = keyFromLabel("x".repeat(200), ["x".repeat(60)]);
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key).toMatch(/^[a-z0-9_]+$/);
  });
});
