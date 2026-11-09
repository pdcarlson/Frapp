// The shipped-builds registry, `apps/mobile/store/shipped-builds.json`: its
// parse, the comparison of two versions of it, and the record job's append.
//
// Dependency-free on purpose (no `child_process`, no `fs`, no npm package):
// `pr-base-sync.mjs` imports it while holding the base-sync App token, and that
// script's import graph must shell out nowhere (docs/ci-cd/pr-babysitting.md
// § Why the App is safe on a public repo). Every reader of the registry parses
// it here, so a rule added once holds for all of them (#3783).
//
// What the registry is for, and when an entry may go:
// apps/mobile/store/README.md § Shipped builds and the API contract.

export const REGISTRY_PATH = "apps/mobile/store/shipped-builds.json";

const PLATFORMS = new Set(["ios", "android"]);
const ENTRY_KEYS = new Set(["platform", "version", "build", "sha", "recorded", "note"]);

/**
 * Every key repeated inside one JSON object, with the line it is repeated on.
 *
 * `JSON.parse` keeps the last value of a repeated key and says nothing, so a
 * merge that splices two entries' fields into one object (#3783: `5df56abc`
 * put the iOS 0.10.0 (11) entry's fields into the 0.10.1 (12) object) parses
 * as one valid entry and silently drops the other build from every gate. Call
 * it on text `JSON.parse` has already accepted: it is a scanner, not a parser.
 *
 * @returns {Array<{ key: string, line: number }>}
 */
export function findRepeatedKeys(text) {
  const repeats = [];
  const stack = [];
  let line = 1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\n") {
      line += 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const top = stack.at(-1);
      if (top?.keys && top.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1));
        if (top.keys.has(key)) repeats.push({ key, line });
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j;
    } else if (c === "{") {
      stack.push({ keys: new Set(), expectKey: true });
    } else if (c === "[") {
      stack.push({ keys: null });
    } else if (c === "}" || c === "]") {
      stack.pop();
    } else if (c === ",") {
      const top = stack.at(-1);
      if (top?.keys) top.expectKey = true;
    }
  }
  return repeats;
}

/** The `<platform>/<version>+<build>` id an entry is known by. */
export const entryId = (entry) => `${entry.platform}/${entry.version}+${entry.build}`;

const TOP_KEYS = new Set(["builds", "dropped"]);
const DROPPED_KEYS = new Set([...ENTRY_KEYS, "dropped", "reason"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Every problem with one entry of `builds` or `dropped`, located by `at`. */
function entryProblems(entry, at, keys) {
  const problems = [];
  for (const key of Object.keys(entry)) {
    if (!keys.has(key)) problems.push(`${at} has an unknown key \`${key}\``);
  }
  if (!PLATFORMS.has(entry.platform)) {
    problems.push(`${at}.platform must be "ios" or "android"`);
  }
  if (typeof entry.version !== "string" || !/^\d+\.\d+\.\d+$/.test(entry.version)) {
    problems.push(`${at}.version must be the store version, e.g. "1.0.0"`);
  }
  if (typeof entry.build !== "string" || !/^[1-9]\d*$/.test(entry.build)) {
    problems.push(`${at}.build must be the native build number as a string, e.g. "12"`);
  }
  if (typeof entry.sha !== "string" || !/^[0-9a-f]{40}$/.test(entry.sha)) {
    problems.push(`${at}.sha must be the full 40-character commit SHA the build was made from`);
  }
  if (typeof entry.recorded !== "string" || !DATE_RE.test(entry.recorded)) {
    problems.push(`${at}.recorded must be the date it was recorded, e.g. "2026-10-01"`);
  }
  if (entry.note !== undefined && typeof entry.note !== "string") {
    problems.push(`${at}.note must be a string when present`);
  }
  return problems;
}

/**
 * Parse and validate the shipped-builds registry.
 *
 * Strict on purpose. A typo'd key (`commit` for `sha`) or a short SHA that
 * parsed as "no builds" would turn a blocking gate into one that compares
 * against nothing, so every problem is an error rather than a skip. That
 * includes a key repeated inside one object, which `JSON.parse` would
 * otherwise resolve by quietly dropping a value (`findRepeatedKeys`).
 *
 * `dropped` (optional) holds entries retired from `builds`: each keeps its
 * fields and adds the date it was dropped and why. Nothing compares against
 * them; they exist so a drop is a reviewed, recorded move that
 * `compareRegistries` can tell apart from an entry a merge lost.
 *
 * @returns {{ builds: object[], dropped: object[] }}
 * @throws {Error} listing every problem found
 */
export function parseRegistry(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON: ${error.message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("the top level must be an object with a `builds` array");
  }
  if (!Array.isArray(data.builds)) {
    throw new Error("`builds` must be an array (empty when nothing has shipped)");
  }

  const problems = findRepeatedKeys(text).map(
    ({ key, line }) =>
      `line ${line} repeats the key \`${key}\` inside one object, so JSON keeps only its last value ` +
      "and loses the other (a bad merge splices two entries into one this way)",
  );
  for (const key of Object.keys(data)) {
    if (!TOP_KEYS.has(key)) problems.push(`the top level has an unknown key \`${key}\``);
  }
  const dropped = data.dropped ?? [];
  if (!Array.isArray(dropped)) problems.push("`dropped` must be an array when present");

  const seen = new Set();
  const check = (entry, at, keys) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${at} must be an object`);
      return;
    }
    problems.push(...entryProblems(entry, at, keys));
    const id = entryId(entry);
    if (seen.has(id)) problems.push(`${at} repeats ${id}`);
    seen.add(id);
  };
  data.builds.forEach((entry, i) => check(entry, `builds[${i}]`, ENTRY_KEYS));
  if (Array.isArray(dropped)) {
    dropped.forEach((entry, i) => {
      const at = `dropped[${i}]`;
      check(entry, at, DROPPED_KEYS);
      if (entry === null || typeof entry !== "object") return;
      if (typeof entry.dropped !== "string" || !DATE_RE.test(entry.dropped)) {
        problems.push(`${at}.dropped must be the date it was dropped, e.g. "2026-12-01"`);
      }
      if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
        problems.push(
          `${at}.reason must say why: production's minimum for the platform and the date it went live, ` +
            "or the run whose upload never reached the store",
        );
      }
    });
  }

  if (problems.length > 0) throw new Error(problems.join("\n"));
  return { builds: data.builds, dropped: Array.isArray(dropped) ? dropped : [] };
}

const IDENTITY = ["platform", "version", "build", "sha", "recorded"];

/** The identity fields `a` and `b` disagree on, as `field: a → b`. */
function identityChanges(a, b, fields = IDENTITY) {
  return fields.filter((f) => a[f] !== b[f]).map((f) => `${f}: ${a[f]} → ${b[f]}`);
}

/**
 * What the head registry lost or rewrote relative to the base branch's.
 *
 * A record PR adds entries and nothing else, and an entry leaves `builds`
 * only by moving to `dropped` (README § Shipped builds and the API contract).
 * Anything else a PR does to an entry already on the base branch (removes it,
 * changes its SHA, version, build or date) is what a bad conflict resolution
 * looks like, and it passes every other check: the file is valid, and the
 * contract gate simply compares against fewer builds. A `note` or a `reason`
 * may be edited.
 *
 * @param {{ builds: object[], dropped: object[] }} base
 * @param {{ builds: object[], dropped: object[] }} head
 * @returns {string[]} one problem per entry, empty when the head keeps the base
 */
export function compareRegistries(base, head) {
  const headBuilds = new Map(head.builds.map((e) => [entryId(e), e]));
  const headDropped = new Map(head.dropped.map((e) => [entryId(e), e]));
  const problems = [];
  for (const entry of base.builds) {
    const id = entryId(entry);
    const kept = headBuilds.get(id) ?? headDropped.get(id);
    if (!kept) {
      problems.push(
        `${id} (${entry.sha.slice(0, 12)}) is in \`builds\` on the base branch and missing here. ` +
          "Restore it, or move it to `dropped` with the date and the reason.",
      );
      continue;
    }
    const changes = identityChanges(entry, kept);
    if (changes.length > 0) {
      problems.push(`${id} differs from the base branch's entry (${changes.join("; ")}). Restore the base's values.`);
    }
  }
  for (const entry of base.dropped) {
    const id = entryId(entry);
    const kept = headDropped.get(id) ?? headBuilds.get(id);
    if (!kept) {
      problems.push(`${id} is in \`dropped\` on the base branch and missing here. Restore it: \`dropped\` is the record of every drop.`);
      continue;
    }
    // Back in `builds` is allowed (it only adds protection); still in `dropped`
    // must keep its date.
    const fields = headDropped.has(id) ? [...IDENTITY, "dropped"] : IDENTITY;
    const changes = identityChanges(entry, kept, fields);
    if (changes.length > 0) {
      problems.push(`${id} differs from the base branch's entry (${changes.join("; ")}). Restore the base's values.`);
    }
  }
  return problems;
}

/**
 * Whether two entries are the same entry: the same keys with the same values,
 * `note`, `dropped` and `reason` included.
 */
export function sameEntry(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

/**
 * The registry with `entries` appended, as file text, and which entries were
 * new. An entry already listed (a re-run after the PR merged), in `builds` or
 * in `dropped`, is not added again. Everything else in the file, `dropped`
 * included, is kept as it was. Throws when the current file or the result
 * fails `parseRegistry`.
 */
export function mergeRegistry(text, entries) {
  const { builds, dropped } = parseRegistry(text);
  const listed = new Set([...builds, ...dropped].map(entryId));
  const added = entries.filter((e) => !listed.has(entryId(e)));
  // Spread first, so `builds` keeps its place and a `dropped` list survives.
  const merged = { ...JSON.parse(text), builds: [...builds, ...added] };
  const next = `${JSON.stringify(merged, null, 2)}\n`;
  parseRegistry(next);
  return { text: next, added };
}
