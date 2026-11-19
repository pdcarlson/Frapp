import { describe, expect, it } from "vitest";
import { guessMeetingType } from "./meeting-copy";

describe("guessMeetingType", () => {
  it("files a meeting by what its name says", () => {
    expect(guessMeetingType("Exec meeting")).toBe("exec");
    expect(guessMeetingType("E-board")).toBe("exec");
    expect(guessMeetingType("Social committee")).toBe("committee");
    expect(guessMeetingType("Chapter meeting")).toBe("chapter");
    expect(guessMeetingType("Sunday GM")).toBe("chapter");
    expect(guessMeetingType("General meeting")).toBe("chapter");
    expect(guessMeetingType("General Body Meeting")).toBe("chapter");
    expect(guessMeetingType("GBM")).toBe("chapter");
  });

  it("leaves a name that says no type as Other, never Chapter", () => {
    expect(guessMeetingType("Ben Cunningham Meeting")).toBe("other");
    expect(guessMeetingType("Weekly meeting")).toBe("other");
    expect(guessMeetingType("")).toBe("other");
    expect(guessMeetingType("Team BM retro")).toBe("other");
  });
});
