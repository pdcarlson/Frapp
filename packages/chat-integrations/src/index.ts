/**
 * Chat-integrations registry.
 *
 * This package holds the slash-command catalog, the input parsers, and the
 * payload shapes. `apps/web` and `@repo/chat-core` are the dependents. Rich
 * renderers themselves live in the apps (they're framework-bound — React for
 * web, Expo for mobile). Only web's read the contract declared here: mobile
 * cannot depend on this package at all (its `require` condition points at an
 * unbuilt `dist/`, #989), so its card components redeclare the wire shapes off
 * `@repo/chat-core`. A wire change therefore has to be carried to both.
 *
 * Chunk 04 shipped the catalog scaffold (all commands `implemented: false`);
 * Chunk 05 flips `/poll` and `/announce` to `implemented: true` and adds the
 * dispatch + parsers below.
 */

// Re-exports without the `.js` extension because the package is consumed via
// bundler (Turbopack in dev, tsc in build) and the dev path resolves
// extensionless TS imports. The tsconfig sets `moduleResolution: "Bundler"`
// so the build matches.
//
// #236 moved the other built packages to NodeNext so their `require` condition
// serves real CommonJS. This one is deliberately left behind: switching it
// means `.js` specifiers, and Turbopack cannot resolve `./parsers.js` against
// `parsers.ts`, so `npm run build -w apps/web` fails outright. Its emitted dist
// is not loadable by Node — but nothing loads it that way, since `apps/api`
// does not depend on this package at all. Fixing that properly means a dual
// build, which is its own change.
export * from "./parsers";
export * from "./payloads";

/**
 * A slash command the user can invoke from the composer. `requiredModule` ties
 * the command to a `chapters.enabled_modules` key; the UI hides commands whose
 * module is disabled. `null` means always available (e.g. announcements is a
 * free, always-on module).
 */
export interface SlashCommand {
  /** Invocation token without the leading slash, e.g. "event". */
  name: string;
  /**
   * Palette label when it differs from `name`. Rush renders the chapter's
   * recruitment vocabulary (`intake`, `recruitment`, …) here; dispatch still
   * keys on canonical `name: "rush"`.
   */
  displayName?: string;
  /** One-line description shown in the palette. */
  description: string;
  /** Hint text for the argument string, e.g. "<title> <date>". */
  usage?: string;
  /**
   * `enabled_modules` key that gates this command, or `null` for always-on.
   * Resolve against `useOrgConfig().isModuleEnabled` in the UI.
   */
  requiredModule: string | null;
  /**
   * Whether a renderer/dispatch exists. Always `false` in Chunk 04 — the
   * palette surfaces these but invoking one shows an "Available in Chunk 05"
   * toast rather than executing.
   */
  implemented: boolean;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = Object.freeze([
  {
    name: "event",
    description: "Create an event with an interactive card",
    usage: '"<name>" <YYYY-MM-DD> <HH:MM>-<HH:MM> [location] [points=<n>]',
    requiredModule: "events",
    implemented: true,
  },
  {
    name: "task",
    description: "Create a task card and assign it",
    usage: '"<title>" @assignee <YYYY-MM-DD> [points]',
    requiredModule: "tasks",
    implemented: true,
  },
  {
    name: "poll",
    description: "Start a poll",
    usage: '"<question>" <option> <option> …',
    requiredModule: "polls",
    implemented: true,
  },
  {
    name: "dues",
    description: "Dues reminders and balances",
    usage: "remind overdue",
    requiredModule: "dues",
    implemented: false,
  },
  {
    name: "points",
    description: "Grant or deduct member points",
    usage: "grant|deduct @member <amount> for <reason>",
    requiredModule: "points",
    implemented: true,
  },
  {
    name: "hours",
    description: "Log service hours",
    usage: "log <duration> <description>",
    requiredModule: "hours",
    implemented: true,
  },
  {
    name: "rush",
    description: "Add a candidate, vote, or extend a bid",
    usage: "add @candidate | vote <candidate-id> | bid @candidate",
    requiredModule: "rush",
    implemented: true,
  },
  {
    name: "announce",
    description: "Post an announcement",
    usage: "<message>",
    requiredModule: null,
    implemented: true,
  },
]);

/** Vocab aliases that dispatch as the canonical `rush` command. */
export const RUSH_COMMAND_ALIASES = [
  "recruitment",
  "intake",
  "induction",
] as const;

/**
 * Slash token for the chapter's recruitment vocabulary. `"Intake"` →
 * `"intake"`; empty / punctuation-only falls back to `"rush"`.
 */
export function recruitmentCommandSlug(label?: string | null): string {
  const slug = (label ?? "rush")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "rush";
}

export function isRushCommandToken(
  token: string,
  recruitment?: string | null,
): boolean {
  const needle = token.trim().toLowerCase();
  if (needle === "rush") return true;
  if ((RUSH_COMMAND_ALIASES as readonly string[]).includes(needle)) {
    return true;
  }
  return needle === recruitmentCommandSlug(recruitment);
}

/**
 * Guarded lookup by command name. Returns `undefined` for unknown names so
 * callers handle the missing case explicitly (no bare map subscript).
 * Rush also matches {@link RUSH_COMMAND_ALIASES} and the chapter vocab slug.
 */
export function getSlashCommand(
  name: string,
  options?: { recruitment?: string },
): SlashCommand | undefined {
  const needle = name.trim().toLowerCase();
  const found = SLASH_COMMANDS.find((command) => command.name === needle);
  const command =
    found ??
    (isRushCommandToken(needle, options?.recruitment)
      ? SLASH_COMMANDS.find((entry) => entry.name === "rush")
      : undefined);
  if (!command) return undefined;
  if (command.name !== "rush") return command;
  const chapterSlug = recruitmentCommandSlug(options?.recruitment);
  const displayName =
    needle !== "rush"
      ? needle
      : chapterSlug !== "rush"
        ? chapterSlug
        : undefined;
  return displayName ? { ...command, displayName } : command;
}

/**
 * Filters the command catalog for the palette. `query` is the text typed after
 * the slash; an empty query returns everything. Commands whose module is
 * disabled are excluded via the supplied predicate (wire it to
 * `useOrgConfig().isModuleEnabled`). Commands with no `requiredModule` are
 * always included.
 *
 * Pass `options.recruitment` so the rush row matches and displays the chapter's
 * vocabulary token (`/intake`, `/recruitment`, …) without changing `name`.
 */
export function filterSlashCommands(
  query: string,
  isModuleEnabled: (moduleKey: string) => boolean,
  options?: { recruitment?: string },
): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  const displayName = recruitmentCommandSlug(options?.recruitment);
  return SLASH_COMMANDS.filter((command) => {
    if (command.requiredModule && !isModuleEnabled(command.requiredModule)) {
      return false;
    }
    if (needle.length === 0) return true;
    if (command.name === "rush") {
      return (
        command.name.includes(needle) ||
        displayName.includes(needle) ||
        (RUSH_COMMAND_ALIASES as readonly string[]).some((alias) =>
          alias.includes(needle),
        ) ||
        command.description.toLowerCase().includes(needle)
      );
    }
    return (
      command.name.includes(needle) ||
      command.description.toLowerCase().includes(needle)
    );
  }).map((command) =>
    command.name === "rush" && displayName !== "rush"
      ? { ...command, displayName }
      : command,
  );
}

/** Result of parsing composer text for a slash command. */
export interface ParsedSlashInput {
  /** True when the text begins with a slash. */
  isSlash: boolean;
  /** Command name (without slash), or `null` when no command token is present. */
  command: string | null;
  /** Everything after the command token, trimmed. */
  args: string;
  /** The original input. */
  raw: string;
}

const SLASH_PATTERN = /^\/([A-Za-z][\w-]*)?\s*([\s\S]*)$/;

/**
 * Parses composer text. `/event Formal 8pm` → `{ isSlash:true, command:"event",
 * args:"Formal 8pm" }`. A lone `/` opens the palette with `command:null`. Plain
 * text → `{ isSlash:false, command:null, args:<text> }` and is sent as
 * `kind:"text"`.
 */
export function parseSlashInput(raw: string): ParsedSlashInput {
  if (!raw.startsWith("/")) {
    return { isSlash: false, command: null, args: raw, raw };
  }
  const match = SLASH_PATTERN.exec(raw);
  if (!match) {
    return { isSlash: true, command: null, args: "", raw };
  }
  const command = match[1] ? match[1].toLowerCase() : null;
  return { isSlash: true, command, args: (match[2] ?? "").trim(), raw };
}

/**
 * Guard-parses a numeric slash argument. Returns `null` for anything that
 * isn't a finite number so callers never propagate `NaN` (master-plan
 * input-handling rule). Chunk 05 commands that take counts/amounts use this.
 */
export function parseNumericArg(
  token: string | undefined | null,
): number | null {
  if (token == null) return null;
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
