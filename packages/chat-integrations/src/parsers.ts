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
