/**
 * Parse a telemetry sample rate from an environment string.
 *
 * Every rate is a number in `[0, 1]`. `Number(env ?? "0.1")` is not that:
 * a typo, an empty-but-set variable, or a secret-manager placeholder yields
 * `NaN`, and the Sentry SDK treats `NaN` as "tracing on" (#904 leftover
 * surface, #2040).
 *
 * Missing (unset) falls back silently — that is the documented default.
 * Empty, non-numeric, non-finite, or out-of-range values also fall back,
 * and {@link formatSampleRateWarning} is what callers log at boot.
 */

/** Documented default for Sentry traces. Mobile uses this as a literal. */
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

export type SampleRateParseReason =
  | "ok"
  | "missing"
  | "empty"
  | "malformed"
  | "out_of_range";

export interface SampleRateParseResult {
  value: number;
  raw: string | undefined;
  reason: SampleRateParseReason;
}

/**
 * Parse `raw` as a sample rate in `[0, 1]`.
 *
 * `fallback` must itself be a finite number in `[0, 1]`; it is a programming
 * constant, not an env value. A bad fallback is clamped to
 * {@link DEFAULT_TRACES_SAMPLE_RATE} rather than producing `NaN`.
 */
export function parseSampleRate(
  raw: string | undefined,
  fallback: number = DEFAULT_TRACES_SAMPLE_RATE,
): SampleRateParseResult {
  const safeFallback = finiteRate(fallback) ?? DEFAULT_TRACES_SAMPLE_RATE;

  if (raw === undefined) {
    return { value: safeFallback, raw, reason: "missing" };
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    return { value: safeFallback, raw, reason: "empty" };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { value: safeFallback, raw, reason: "malformed" };
  }
  if (parsed < 0 || parsed > 1) {
    return { value: safeFallback, raw, reason: "out_of_range" };
  }

  return { value: parsed, raw, reason: "ok" };
}

/**
 * Boot-log line when an env value was set but unusable. `undefined` when
 * nothing should be logged (valid parse, or the variable was simply unset).
 *
 * The raw value is not interpolated — a mis-set secret-manager placeholder
 * should not be echoed into logs.
 */
export function formatSampleRateWarning(
  envName: string,
  result: SampleRateParseResult,
): string | undefined {
  if (result.reason === "ok" || result.reason === "missing") return undefined;
  return `${envName} is ${result.reason}; falling back to ${result.value}`;
}

/**
 * Parse and optionally warn. Convenience for the three options builders so
 * they cannot forget the log half of the contract.
 */
export function parseTracesSampleRate(
  raw: string | undefined,
  options: {
    envName: string;
    fallback?: number;
    warn?: (message: string) => void;
  },
): number {
  const result = parseSampleRate(raw, options.fallback);
  const warning = formatSampleRateWarning(options.envName, result);
  if (warning) (options.warn ?? defaultWarn)(warning);
  return result.value;
}

function finiteRate(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function defaultWarn(message: string): void {
  // `console` is not in `lib: ["es2022"]` (this package is DOM-free).
  const warn = (globalThis as { console?: { warn?: (msg: string) => void } })
    .console?.warn;
  warn?.(message);
}
