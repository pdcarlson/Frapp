import { describe, expect, it } from "vitest";
import { jumpToLatestLabel, zoneFor } from "./jump-to-latest";

describe("zoneFor", () => {
  // A 600px screen, following arrivals within 16px of the newest message.
  const at = (distance: number) => zoneFor(distance, 600, 16);

  it("is newest up to and including the follow threshold", () => {
    expect(at(0)).toBe("newest");
    expect(at(16)).toBe("newest");
  });

  it("is near past the threshold and up to one screen back", () => {
    expect(at(17)).toBe("near");
    expect(at(600)).toBe("near");
  });

  it("is away more than one screen back", () => {
    expect(at(601)).toBe("away");
  });
});

describe("jumpToLatestLabel", () => {
  it("says when something new landed below", () => {
    expect(jumpToLatestLabel(false)).toBe("Jump to latest");
    expect(jumpToLatestLabel(true)).toBe("New messages. Jump to latest");
  });
});
