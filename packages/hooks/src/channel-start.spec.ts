import { describe, expect, it } from "vitest";
import { channelDescription, channelStartCopy } from "./channel-start";

describe("channelStartCopy", () => {
  it("welcomes a public channel and carries its description", () => {
    expect(
      channelStartCopy({
        type: "PUBLIC",
        name: "general",
        description: "  The whole chapter.  ",
      }),
    ).toEqual({
      title: "Welcome to #general",
      startLine: "This is the start of #general.",
      description: "The whole chapter.",
    });
  });

  it("names a private or role-gated channel as private", () => {
    for (const type of ["PRIVATE", "ROLE_GATED"] as const) {
      expect(channelStartCopy({ type, name: "cabinet" }).startLine).toBe(
        "This is the start of the private #cabinet channel.",
      );
    }
  });

  it("shows no description line for a blank description", () => {
    expect(
      channelStartCopy({ type: "PUBLIC", name: "x", description: "   " })
        .description,
    ).toBeNull();
    expect(channelDescription(null)).toBeNull();
    expect(channelDescription(undefined)).toBeNull();
  });

  it("starts a DM with the other member and never shows a description", () => {
    expect(
      channelStartCopy({ type: "DM", name: "Sam Lee", description: "x" }),
    ).toEqual({
      title: "Sam Lee",
      startLine: "This is the start of your conversation with Sam Lee.",
      description: null,
    });
  });

  it("starts a group DM without naming one member", () => {
    expect(
      channelStartCopy({ type: "GROUP_DM", name: "Sam, Alex" }).startLine,
    ).toBe("This is the start of your group conversation.");
  });

  it("never draws an em dash", () => {
    const all = (["PUBLIC", "PRIVATE", "ROLE_GATED", "DM", "GROUP_DM"] as const)
      .map((type) => channelStartCopy({ type, name: "n", description: "d" }))
      .flatMap((copy) => [copy.title, copy.startLine]);
    for (const line of all) expect(line).not.toContain("—");
  });
});
