import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRACES_SAMPLE_RATE,
  formatSampleRateWarning,
  parseSampleRate,
  parseTracesSampleRate,
} from "./sample-rate";

describe("parseSampleRate", () => {
  it.each([
    { raw: undefined, reason: "missing", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "", reason: "empty", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "   ", reason: "empty", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "0,1", reason: "malformed", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "10%", reason: "malformed", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "not-a-number", reason: "malformed", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "NaN", reason: "malformed", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "Infinity", reason: "malformed", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "-0.1", reason: "out_of_range", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "1.1", reason: "out_of_range", value: DEFAULT_TRACES_SAMPLE_RATE },
    { raw: "2", reason: "out_of_range", value: DEFAULT_TRACES_SAMPLE_RATE },
  ] as const)("falls back when raw is $raw ($reason)", ({ raw, reason, value }) => {
    const result = parseSampleRate(raw);
    expect(result.reason).toBe(reason);
    expect(result.value).toBe(value);
    expect(Number.isFinite(result.value)).toBe(true);
  });

  it.each(["0", "0.0", "0.1", "0.25", "1", "1.0", "1.000"] as const)(
    "accepts in-range value %s",
    (raw) => {
      const result = parseSampleRate(raw);
      expect(result.reason).toBe("ok");
      expect(result.value).toBe(Number(raw));
      expect(result.value).toBeGreaterThanOrEqual(0);
      expect(result.value).toBeLessThanOrEqual(1);
    },
  );

  it("trims surrounding whitespace on a valid rate", () => {
    expect(parseSampleRate("  0.5  ")).toEqual({
      value: 0.5,
      raw: "  0.5  ",
      reason: "ok",
    });
  });

  it("uses the caller fallback when it is itself a legal rate", () => {
    expect(parseSampleRate(undefined, 0).value).toBe(0);
    expect(parseSampleRate("nope", 0).value).toBe(0);
  });

  it("does not produce NaN when the caller fallback is itself illegal", () => {
    const result = parseSampleRate("nope", Number.NaN);
    expect(Number.isFinite(result.value)).toBe(true);
    expect(result.value).toBe(DEFAULT_TRACES_SAMPLE_RATE);
  });
});

describe("formatSampleRateWarning", () => {
  it("is silent for a valid parse and for an unset variable", () => {
    expect(
      formatSampleRateWarning("SENTRY_TRACES_SAMPLE_RATE", parseSampleRate("0.1")),
    ).toBeUndefined();
    expect(
      formatSampleRateWarning("SENTRY_TRACES_SAMPLE_RATE", parseSampleRate(undefined)),
    ).toBeUndefined();
  });

  it("names the reason without echoing the raw value", () => {
    const warning = formatSampleRateWarning(
      "SENTRY_TRACES_SAMPLE_RATE",
      parseSampleRate("10%"),
    );
    expect(warning).toBe(
      "SENTRY_TRACES_SAMPLE_RATE is malformed; falling back to 0.1",
    );
    expect(warning).not.toContain("10%");
  });
});

describe("parseTracesSampleRate", () => {
  it("warns on empty-but-set and malformed values, not on missing", () => {
    const warn = vi.fn();
    expect(
      parseTracesSampleRate(undefined, {
        envName: "SENTRY_TRACES_SAMPLE_RATE",
        warn,
      }),
    ).toBe(0.1);
    expect(warn).not.toHaveBeenCalled();

    expect(
      parseTracesSampleRate("", {
        envName: "SENTRY_TRACES_SAMPLE_RATE",
        warn,
      }),
    ).toBe(0.1);
    expect(warn).toHaveBeenCalledWith(
      "SENTRY_TRACES_SAMPLE_RATE is empty; falling back to 0.1",
    );

    warn.mockClear();
    expect(
      parseTracesSampleRate("0,1", {
        envName: "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
        warn,
      }),
    ).toBe(0.1);
    expect(warn).toHaveBeenCalledWith(
      "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE is malformed; falling back to 0.1",
    );
  });

  it("returns a finite rate for every fixture, including malformed", () => {
    for (const raw of [undefined, "", " ", "0,1", "10%", "-1", "2", "0.25"]) {
      const value = parseTracesSampleRate(raw, {
        envName: "SENTRY_TRACES_SAMPLE_RATE",
        warn: () => undefined,
      });
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
