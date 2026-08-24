import { describe, expect, it } from "vitest";
import { formatBytes } from "./bytes";

describe("formatBytes", () => {
  it("keeps small sizes in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
  });

  it("steps up at 1024, not 1000", () => {
    // The label has to agree with MAX_UPLOAD_LABEL ("25 MB") in
    // `@repo/validation`, whose MAX_UPLOAD_BYTES is 25 * 1024 * 1024.
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("shows one decimal only when it carries information", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2 MB");
  });

  it("stops at the largest unit it knows", () => {
    expect(formatBytes(3 * 1024 ** 4)).toBe("3 TB");
    expect(formatBytes(2048 * 1024 ** 4)).toBe("2048 TB");
  });

  it("renders an unusable number as unknown rather than NaN", () => {
    // byte_size is nullable on backfilled attachment rows, so callers already
    // have an unknown case; a bad number lands in the same place.
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
