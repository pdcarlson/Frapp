import { describe, expect, it } from "vitest";
import { localClock, localIsoDate } from "./local-date";

// The package's tests run in America/Los_Angeles (vitest.config.ts), so an
// evening there is already the next day in UTC.
describe("localIsoDate", () => {
  it("reads the local day, not the UTC one", () => {
    const evening = new Date("2026-10-01T03:00:00Z"); // 20:00 PDT on Sep 30
    expect(evening.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(localIsoDate(evening)).toBe("2026-09-30");
  });

  it("pads the month and day", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("localClock", () => {
  it("reads the time of day in the runtime's zone, zero-padded on the 24-hour clock", () => {
    expect(localClock(new Date(2026, 10, 13, 18, 0))).toBe("18:00");
    expect(localClock(new Date(2026, 10, 13, 7, 5))).toBe("07:05");
  });
});
