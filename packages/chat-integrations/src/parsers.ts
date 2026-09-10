/**
 * Slash-command argument parsers (Chunk 05).
 *
 * Pure helpers: no React, no framework imports, no I/O. Each parser returns a
 * discriminated union so callers (composer dispatch, NestJS heavy-command RPC,
 * mobile parity in Chunk 11) handle the failure case explicitly. Numeric
 * arguments go through `parseNumericArg` so the master-plan input-handling
 * rule (no NaN propagation) holds.
 */

import {
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
} from "@repo/validation";

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

/** Result of a successful parse for `/task`. */
export interface TaskArgs {
  title: string;
  /** Assignee token with the leading `@` stripped. Resolved to a user id at dispatch. */
  assigneeToken: string;
  /** Due date as `YYYY-MM-DD` (validated calendar date). */
  dueDate: string;
  /** Optional points awarded on confirmed completion; `null` when omitted. */
  pointReward: number | null;
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

/** Result of a successful parse for `/hours log`. */
export interface HoursArgs {
  /** Duration in whole minutes (≥ 1), matching `CreateServiceEntryDto`. */
  durationMinutes: number;
  description: string;
}

/** Result of a successful parse for `/event`. */
export interface EventArgs {
  name: string;
  /** Event date as `YYYY-MM-DD` (validated calendar date). */
  date: string;
  /** Start clock time as `H:MM`/`HH:MM` (24-hour). */
  startTime: string;
  /** End clock time as `H:MM`/`HH:MM` (24-hour); strictly after `startTime`, same day. */
  endTime: string;
  /** Free-text location, or `null` when omitted. */
  location: string | null;
  /** Point value awarded on check-in; `null` when omitted (server applies its default of 10). */
  pointValue: number | null;
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
  if (reason.length > POINTS_REASON_MAX_LENGTH) {
    return {
      ok: false,
      error: `Reason is too long (max ${POINTS_REASON_MAX_LENGTH} chars)`,
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

const TASK_MAX_TITLE_LENGTH = 255;
const TASK_USAGE = 'Usage: /task "<title>" @assignee <YYYY-MM-DD> [points]';

/**
 * Validates a `YYYY-MM-DD` token as a real calendar date (rejects `2026-02-30`,
 * `2026-13-01`, and non-date junk). Returns the normalized string on success or
 * `null` so the caller surfaces a precise error rather than passing `NaN`
 * downstream (the NestJS `@IsDateString` would 400, but failing in the parser
 * keeps the slash UX local).
 */
function parseIsoDate(token: string | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip guard: `Date` is lenient (2026-02-30 → Mar 2), so reject any
  // token that doesn't survive a UTC round-trip back to the same string.
  if (parsed.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

/**
 * Parse `/task "<title>" @assignee <YYYY-MM-DD> [points]`. The title is quoted
 * because chapter task titles routinely contain spaces (same rationale as
 * `/poll`). The assignee token (leading `@` stripped) is resolved to a user id
 * at dispatch — the parser is grammar-only and never touches the directory. The
 * due date is required (the backend `due_date` is non-null) and validated as a
 * real calendar date. Points are optional and, when present, a non-negative
 * whole number.
 */
export function parseTaskArgs(args: string): ParseResult<TaskArgs> {
  const tokens = tokenizeQuotedArgs(args.trim());
  if (tokens === null) {
    return { ok: false, error: "Unterminated quote in /task arguments" };
  }
  if (tokens.length === 0) {
    return { ok: false, error: TASK_USAGE };
  }

  const title = tokens[0]!.trim();
  if (title.length === 0) {
    return { ok: false, error: "Task title cannot be empty" };
  }
  if (title.length > TASK_MAX_TITLE_LENGTH) {
    return {
      ok: false,
      error: `Task title is too long (max ${TASK_MAX_TITLE_LENGTH} chars)`,
    };
  }

  const assigneeRaw = tokens[1];
  if (!assigneeRaw || !assigneeRaw.startsWith("@") || assigneeRaw.length < 2) {
    return { ok: false, error: `Name an assignee with @. ${TASK_USAGE}` };
  }
  const assigneeToken = assigneeRaw.slice(1);

  const dueDate = parseIsoDate(tokens[2]);
  if (dueDate === null) {
    return { ok: false, error: "Add a due date as YYYY-MM-DD" };
  }

  let pointReward: number | null = null;
  if (tokens[3] != null && tokens[3].trim().length > 0) {
    const parsed = parseNumericArg(tokens[3]);
    if (parsed === null || !Number.isInteger(parsed) || parsed < 0) {
      return {
        ok: false,
        error: "Point reward must be a non-negative whole number",
      };
    }
    pointReward = parsed;
  }

  return {
    ok: true,
    value: { title, assigneeToken, dueDate, pointReward },
  };
}

const EVENT_MAX_NAME_LENGTH = 255;
const EVENT_USAGE =
  'Usage: /event "<name>" <YYYY-MM-DD> <HH:MM>-<HH:MM> [location] [points=<n>]';

/**
 * Validates an `H:MM`/`HH:MM` 24-hour clock token and returns minutes since
 * midnight, or `null` for anything malformed (so the caller surfaces a precise
 * error instead of propagating `NaN`).
 */
function parseClockMinutes(token: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(token.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Parse a `<HH:MM>-<HH:MM>` 24-hour range. Returns the two clock strings on
 * success, or `null` when malformed or when end is not strictly after start.
 * Same-day only — cross-midnight events go through the dashboard. The local
 * date+time → ISO conversion happens at dispatch (the client knows the
 * timezone), keeping this parser pure.
 */
function parseTimeRange(
  token: string | undefined,
): { startTime: string; endTime: string } | null {
  if (!token) return null;
  const parts = token.split("-");
  if (parts.length !== 2) return null;
  const startRaw = parts[0]!.trim();
  const endRaw = parts[1]!.trim();
  const startMinutes = parseClockMinutes(startRaw);
  const endMinutes = parseClockMinutes(endRaw);
  if (startMinutes === null || endMinutes === null) return null;
  if (endMinutes <= startMinutes) return null;
  return { startTime: startRaw, endTime: endRaw };
}

/**
 * Parse `/event "<name>" <YYYY-MM-DD> <HH:MM>-<HH:MM> [location] [points=<n>]`.
 * The name is quoted because event names routinely contain spaces (same
 * rationale as `/poll`/`/task`). The date is validated as a real calendar date;
 * the time range is a 24-hour `HH:MM-HH:MM` whose end must be after its start on
 * the same day. Trailing tokens mirror `/poll`'s `closes=` idiom: a `points=<n>`
 * token sets the point value (non-negative whole number; omitted → the backend
 * default of 10), and every other trailing token joins as the free-text
 * location. `is_mandatory`, recurrence, and role-targeting are dashboard-only —
 * the slash command creates a single, simple event.
 */
export function parseEventArgs(args: string): ParseResult<EventArgs> {
  const tokens = tokenizeQuotedArgs(args.trim());
  if (tokens === null) {
    return { ok: false, error: "Unterminated quote in /event arguments" };
  }
  if (tokens.length === 0) {
    return { ok: false, error: EVENT_USAGE };
  }

  const name = tokens[0]!.trim();
  if (name.length === 0) {
    return { ok: false, error: "Event name cannot be empty" };
  }
  if (name.length > EVENT_MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Event name is too long (max ${EVENT_MAX_NAME_LENGTH} chars)`,
    };
  }

  const date = parseIsoDate(tokens[1]);
  if (date === null) {
    return { ok: false, error: "Add an event date as YYYY-MM-DD" };
  }

  const range = parseTimeRange(tokens[2]);
  if (range === null) {
    return {
      ok: false,
      error: "Add a time range as HH:MM-HH:MM (end after start, same day)",
    };
  }

  let pointValue: number | null = null;
  const locationParts: string[] = [];
  for (const token of tokens.slice(3)) {
    if (token.toLowerCase().startsWith("points=")) {
      const parsed = parseNumericArg(token.slice("points=".length));
      if (parsed === null || !Number.isInteger(parsed) || parsed < 0) {
        return {
          ok: false,
          error: "Point value must be a non-negative whole number",
        };
      }
      pointValue = parsed;
      continue;
    }
    const trimmed = token.trim();
    if (trimmed.length > 0) locationParts.push(trimmed);
  }
  const location = locationParts.length > 0 ? locationParts.join(" ") : null;

  return {
    ok: true,
    value: {
      name,
      date,
      startTime: range.startTime,
      endTime: range.endTime,
      location,
      pointValue,
    },
  };
}

const HOURS_DESCRIPTION_MAX = 2000;
const HOURS_USAGE = "Usage: /hours log <duration> <description>";

/**
 * Parse a duration token into whole minutes.
 *
 * Accepted forms:
 * - `2h` / `2.5h` — hours (fractional hours round to the nearest minute)
 * - `90m` / `90min` — minutes
 * - a bare number — hours, matching the catalog hint `log <amount>`
 *
 * Returns `null` for anything that is not a finite positive duration so
 * callers never propagate `NaN`. Values above {@link POINTS_ADJUSTMENT_MAX}
 * minutes (the same ceiling as `CreateServiceEntryDto`) are `null` too.
 */
function parseDurationToMinutes(token: string | undefined): number | null {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  let minutes: number | null = null;
  const hourMatch = /^(\d+(?:\.\d+)?)h$/.exec(t);
  if (hourMatch) {
    minutes = Math.round(Number(hourMatch[1]) * 60);
  } else {
    const minMatch = /^(\d+(?:\.\d+)?)(?:m|min)$/.exec(t);
    if (minMatch) {
      minutes = Math.round(Number(minMatch[1]));
    } else if (/^\d+(?:\.\d+)?$/.test(t)) {
      minutes = Math.round(Number(t) * 60);
    }
  }
  if (
    minutes === null ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > POINTS_ADJUSTMENT_MAX
  ) {
    return null;
  }
  return minutes;
}

/**
 * Parse `/hours log <duration> <description>`. The only implemented action is
 * `log`; `/hours review` is dashboard-only and is not a slash surface. Duration
 * accepts `2h`, `90m`/`90min`, or a bare number of hours. Description is
 * everything after the duration (quoted spans allowed, same tokenizer as
 * `/poll`). Date is not parsed here — dispatch stamps today's local
 * `YYYY-MM-DD`. Chat cannot attach proof; when `wf_hours_receipt` is on, the
 * API 400s and that is the correct UX.
 */
export function parseHoursArgs(args: string): ParseResult<HoursArgs> {
  const tokens = tokenizeQuotedArgs(args.trim());
  if (tokens === null) {
    return { ok: false, error: "Unterminated quote in /hours arguments" };
  }
  if (tokens.length === 0) {
    return { ok: false, error: HOURS_USAGE };
  }

  const action = tokens[0]!.toLowerCase();
  if (action !== "log") {
    return {
      ok: false,
      error: `Unknown /hours action "${tokens[0]}". ${HOURS_USAGE}`,
    };
  }

  const durationMinutes = parseDurationToMinutes(tokens[1]);
  if (durationMinutes === null) {
    return {
      ok: false,
      error:
        "Duration must be a positive amount (e.g. 2h, 90m, or 2 for two hours)",
    };
  }

  const description = tokens.slice(2).join(" ").trim();
  if (description.length === 0) {
    return { ok: false, error: "A description of the service is required" };
  }
  if (description.length > HOURS_DESCRIPTION_MAX) {
    return {
      ok: false,
      error: `Description is too long (max ${HOURS_DESCRIPTION_MAX} chars)`,
    };
  }

  return { ok: true, value: { durationMinutes, description } };
}

const RUSH_DISPLAY_NAME_MAX = 200;
const RUSH_USAGE = "Usage: add @candidate | vote <candidate-id> | bid @candidate";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Result of a successful parse for `/rush` (and vocab aliases). */
export type RushArgs =
  | { action: "add"; displayName: string }
  | { action: "vote"; candidateId?: string; candidateToken?: string }
  | { action: "bid"; candidateToken: string };

function stripMention(token: string): string {
  return token.startsWith("@") ? token.slice(1).trim() : token.trim();
}

/**
 * Parse `/<vocab> add|vote|bid`. Member-facing errors omit the hardcoded
 * `/rush` token so a chapter that says "intake" is not toasted "rush".
 *
 * - `add` takes `@Name`, a quoted name, or the rest of the line.
 * - `vote` takes a candidate UUID, or a name token resolved at dispatch.
 * - `bid` takes `@Name` or a UUID (resolved at dispatch when not a UUID).
 */
export function parseRushArgs(args: string): ParseResult<RushArgs> {
  const tokens = tokenizeQuotedArgs(args.trim());
  if (tokens === null) {
    return { ok: false, error: "Unterminated quote in arguments" };
  }
  if (tokens.length === 0) {
    return { ok: false, error: RUSH_USAGE };
  }

  const action = tokens[0]!.toLowerCase();
  if (action === "add") {
    const displayName = stripMention(tokens.slice(1).join(" ").trim());
    if (displayName.length === 0) {
      return { ok: false, error: "A candidate name is required. " + RUSH_USAGE };
    }
    if (displayName.length > RUSH_DISPLAY_NAME_MAX) {
      return {
        ok: false,
        error: `Candidate name is too long (max ${RUSH_DISPLAY_NAME_MAX} chars)`,
      };
    }
    return { ok: true, value: { action: "add", displayName } };
  }

  if (action === "vote") {
    const rest = tokens.slice(1).join(" ").trim();
    const token = stripMention(rest);
    if (token.length === 0) {
      return {
        ok: false,
        error: "A candidate id or name is required. " + RUSH_USAGE,
      };
    }
    if (UUID_RE.test(token)) {
      return { ok: true, value: { action: "vote", candidateId: token } };
    }
    return { ok: true, value: { action: "vote", candidateToken: token } };
  }

  if (action === "bid") {
    const rest = tokens.slice(1).join(" ").trim();
    const candidateToken = stripMention(rest);
    if (candidateToken.length === 0) {
      return {
        ok: false,
        error: "A candidate name or id is required. " + RUSH_USAGE,
      };
    }
    return { ok: true, value: { action: "bid", candidateToken } };
  }

  return {
    ok: false,
    error: `Unknown action "${tokens[0]}". ${RUSH_USAGE}`,
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
