/**
 * Slash-command argument parsers (Chunk 05).
 *
 * Pure helpers: no React, no framework imports, no I/O. Each parser returns a
 * discriminated union so callers (composer dispatch, NestJS heavy-command RPC,
 * mobile parity in Chunk 11) handle the failure case explicitly. Numeric
 * arguments go through `parseNumericArg` so the master-plan input-handling
 * rule (no NaN propagation) holds.
 */

/** Result of a successful parse for `/poll`. */
export interface PollArgs {
  question: string;
  options: string[];
  /** Optional close-after window in minutes. Defaults to 24h. */
  closesInMinutes: number;
}

/** Result of a successful parse for `/announce`. */
export interface AnnounceArgs {
  message: string;
}

/** Result of a successful parse for `/points`. */
export interface PointsArgs {
  /** `grant` adds points (MANUAL), `deduct` removes them (FINE). */
  action: "grant" | "deduct";
  /** Member token with the leading `@` stripped. Resolved to a user id at dispatch. */
  memberToken: string;
  /** Positive magnitude; the dispatcher applies the sign from `action`. */
  amount: number;
  reason: string;
  /** grant → MANUAL (reward), deduct → FINE (penalty). Matches `point_transactions.category`. */
  category: "MANUAL" | "FINE";
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const POLL_DEFAULT_CLOSE_MINUTES = 60 * 24;

/**
 * Tokenizer that respects double-quoted spans. `'Foo "bar baz" qux'` →
 * `['Foo', 'bar baz', 'qux']`. Unterminated quotes return `null` so the
 * caller can surface a precise error instead of silently dropping the tail.
 */
export function tokenizeQuotedArgs(input: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && input[i] === " ") i++;
    if (i >= input.length) break;
    if (input[i] === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) return null;
      tokens.push(input.slice(i + 1, end));
      i = end + 1;
    } else {
      let end = i;
      while (end < input.length && input[end] !== " ") end++;
      tokens.push(input.slice(i, end));
      i = end;
    }
  }
  return tokens;
}

/**
 * Parse `/poll "Question" Option1 Option2 [...]`. Question must be quoted (the
 * common "Friday or Saturday" case has internal whitespace). Two options
 * minimum. Optional trailing `closes=<minutes>` token; non-finite values fall
 * back to the default.
 */
export function parsePollArgs(args: string): ParseResult<PollArgs> {
  const tokens = tokenizeQuotedArgs(args.trim());
  if (tokens === null) {
    return { ok: false, error: "Unterminated quote in /poll arguments" };
  }
  if (tokens.length === 0) {
    return {
      ok: false,
      error: 'Usage: /poll "Question" Option1 Option2 [...]',
    };
  }
  const question = tokens[0]!.trim();
  if (question.length === 0) {
    return { ok: false, error: "Poll question cannot be empty" };
  }

  let closesInMinutes = POLL_DEFAULT_CLOSE_MINUTES;
  const rawOptions: string[] = [];
  for (const token of tokens.slice(1)) {
    if (token.startsWith("closes=")) {
      const parsed = parseNumericArg(token.slice("closes=".length));
      if (parsed !== null && parsed > 0) closesInMinutes = parsed;
      continue;
    }
    const trimmed = token.trim();
    if (trimmed.length > 0) rawOptions.push(trimmed);
  }

  // Dedup case-insensitively while preserving original casing.
  const seen = new Set<string>();
  const options: string[] = [];
  for (const opt of rawOptions) {
    const key = opt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(opt);
  }

  if (options.length < 2) {
    return { ok: false, error: "Polls need at least two distinct options" };
  }
  if (options.length > 10) {
    return { ok: false, error: "Polls support up to 10 options" };
  }

  return {
    ok: true,
    value: { question, options, closesInMinutes },
  };
}

/** Parse `/announce <message>` — anything non-empty passes. */
export function parseAnnounceArgs(args: string): ParseResult<AnnounceArgs> {
  const message = args.trim();
  if (message.length === 0) {
    return { ok: false, error: "Announcement cannot be empty" };
  }
  if (message.length > 4000) {
    return { ok: false, error: "Announcement is too long (max 4000 chars)" };
  }
  return { ok: true, value: { message } };
}

const POINTS_MAX_REASON_LENGTH = 500;
const POINTS_USAGE =
  "Usage: /points grant|deduct @member <amount> for <reason>";

/**
 * Parse `/points grant|deduct @member <amount> for <reason>`. The member token
 * (leading `@` stripped) is resolved to a user id at dispatch — the parser is
 * grammar-only and never touches the directory. Amount is a positive whole
 * number; the sign is applied from `action` downstream (grant → +/MANUAL,
 * deduct → −/FINE). The reason is everything after the literal `for`.
 */
export function parsePointsArgs(args: string): ParseResult<PointsArgs> {
  const tokens = tokenizeQuotedArgs(args.trim());
  if (tokens === null) {
    return { ok: false, error: "Unterminated quote in /points arguments" };
  }
  if (tokens.length === 0) {
    return { ok: false, error: POINTS_USAGE };
  }

  const action = tokens[0]!.toLowerCase();
  if (action !== "grant" && action !== "deduct") {
    return {
      ok: false,
      error: `Unknown /points action "${tokens[0]}". ${POINTS_USAGE}`,
    };
  }

  const memberRaw = tokens[1];
  if (!memberRaw || !memberRaw.startsWith("@") || memberRaw.length < 2) {
    return { ok: false, error: `Name a member with @. ${POINTS_USAGE}` };
  }
  const memberToken = memberRaw.slice(1);

  const amount = parseNumericArg(tokens[2]);
  if (amount === null || !Number.isInteger(amount) || amount <= 0) {
    return {
      ok: false,
      error: "Amount must be a positive whole number of points",
    };
  }

  if (!tokens[3] || tokens[3].toLowerCase() !== "for") {
    return { ok: false, error: `Add a reason after "for". ${POINTS_USAGE}` };
  }

  const reason = tokens.slice(4).join(" ").trim();
  if (reason.length === 0) {
    return { ok: false, error: "A reason is required for point adjustments" };
  }
  if (reason.length > POINTS_MAX_REASON_LENGTH) {
    return {
      ok: false,
      error: `Reason is too long (max ${POINTS_MAX_REASON_LENGTH} chars)`,
    };
  }

  return {
    ok: true,
    value: {
      action,
      memberToken,
      amount,
      reason,
      category: action === "grant" ? "MANUAL" : "FINE",
    },
  };
}

/**
 * Guard-parses a numeric slash argument. Returns `null` for anything that
 * isn't a finite number so callers never propagate `NaN` (master-plan
 * input-handling rule). Re-exported here for parser internals; the public
 * entry point lives in `./index.ts`.
 */
function parseNumericArg(token: string | undefined | null): number | null {
  if (token == null) return null;
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
