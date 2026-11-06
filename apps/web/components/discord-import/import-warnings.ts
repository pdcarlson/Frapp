/**
 * An import's warnings, grouped by reason in plain words.
 *
 * The worker writes one sentence per thing that didn't come over, and the job
 * row keeps the newest `MAX_WARNINGS` of them. A finished import with ten
 * warnings should read as three reasons, not ten lines, so each sentence is
 * matched to a reason here. The patterns are the worker's own wording
 * (`discord-export-worker.service.ts`, `discord-import-worker.service.ts`),
 * old spellings included, so an import that finished before the wording
 * changed still groups. Anything unmatched is listed under "Other" as written,
 * cut to a readable length.
 */

/** As the API keeps them on the job row. Mirrors the API's `MAX_WARNINGS`. */
export const KEPT_WARNINGS = 50;

const MAX_LINE = 160;

interface Reason {
  key: string;
  title: string;
  matches: RegExp;
}

const REASONS: Reason[] = [
  {
    key: "type",
    title: "File types Frapp doesn't store",
    matches: /file type (Frapp doesn't store|the archive does not accept)/,
  },
  {
    key: "untyped",
    title: "Files with no type Frapp could tell",
    matches: /no file type Frapp could tell/,
  },
  {
    key: "size",
    title: "Files too large to store",
    matches: /larger than the archive accepts/,
  },
  {
    key: "gone",
    title: "Files Discord no longer has",
    matches: /no longer available from Discord/,
  },
  {
    key: "storage",
    title: "Files storage couldn't take",
    matches: /^(Storage couldn't take|Could not import attachment)/,
  },
  {
    key: "channel",
    title: "Channels the bot could no longer read",
    matches: /no longer readable in Discord/,
  },
  // The upload path's own reasons.
  {
    key: "missing",
    title: "Files missing from the upload",
    matches: /wasn't in the upload|^No uploaded file for attachment/,
  },
  {
    key: "part",
    title: "Export files Frapp couldn't read",
    matches:
      /^Export file "|^Uploaded export part is missing|limit for one export part|^\S+\.json: /,
  },
  {
    key: "unmapped",
    title: "Channels with no place chosen",
    matches: /had no place chosen in Frapp|^No mapping for #/,
  },
  {
    key: "message",
    title: "Messages with no id or time",
    matches: /no id or (time|timestamp)/,
  },
];

export interface WarningGroup {
  key: string;
  title: string;
  /** One line per warning: the file or channel it names, else the sentence. */
  items: string[];
}

/** The quoted file name or `#channel` a warning names, if it names one. */
function subject(warning: string): string | null {
  const quoted = /"([^"]+)"/.exec(warning);
  if (quoted?.[1]) return quoted[1];
  const channel = /^#\S+/.exec(warning);
  if (channel?.[0]) return channel[0];
  // The older upload wording named its file or channel after a colon.
  const named =
    /^(?:No uploaded file for attachment|Uploaded export part is missing): (.+)$/.exec(
      warning,
    ) ??
    /^No mapping for (#[^;]+);/.exec(warning) ??
    /^(\S+\.json): /.exec(warning);
  return named?.[1] ?? null;
}

function readable(warning: string): string {
  const flat = warning.replace(/\s+/g, " ").trim();
  return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE - 1)}…` : flat;
}

export function groupWarnings(warnings: readonly string[]): WarningGroup[] {
  const groups = new Map<string, WarningGroup>();
  for (const warning of warnings) {
    const reason = REASONS.find((candidate) => candidate.matches.test(warning));
    const key = reason?.key ?? "other";
    const group = groups.get(key) ?? {
      key,
      title: reason?.title ?? "Other",
      items: [],
    };
    group.items.push((reason && subject(warning)) || readable(warning));
    groups.set(key, group);
  }
  // In the order the reasons are listed, with Other last.
  const order = [...REASONS.map((reason) => reason.key), "other"];
  return [...groups.values()].sort(
    (a, b) => order.indexOf(a.key) - order.indexOf(b.key),
  );
}
