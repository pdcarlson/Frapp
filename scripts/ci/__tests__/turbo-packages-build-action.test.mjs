import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pins the cutover half of stage 4's composite-action extraction (#1382).
//
// The `.turbo` cache key from ADR-15 lever (A) used to be written out verbatim in
// all eight of its call sites in `ci.yml` -- one producer (`actions/cache`) and
// seven consumers (`actions/cache/restore`). The reason that mattered is not the
// magnitude of the loss but its silence: a drifted key degrades the cache (see
// the action's own comment for why `restore-keys` makes it a stale hit rather
// than a cold rebuild) and nothing goes red, because a cache miss is not an
// error.
//
// The extraction is only worth anything if the copies stay gone AND the new
// single point of failure is itself pinned. An earlier draft of this file
// asserted only the first half -- so renaming the action's `save` input would
// have left `packages-build` silently taking the read-only branch, never writing
// `.turbo`, with all six tests green. Both halves are asserted now.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOWS = join(REPO, ".github", "workflows");
const ACTIONS = join(REPO, ".github", "actions");
const ACTION_DIR = "turbo-packages-build";
const ACTION = join(ACTIONS, ACTION_DIR, "action.yml");

// Tolerates every legal spelling of the same step: the name-less `- uses:`
// form, a quoted path, and a trailing comment. A stricter regex here is not
// "safer" -- it silently fails OPEN on the negative assertions, so a
// `- uses: ./...` added to `clean-checkout-typecheck` would disarm the
// cold-build canary with the suite still green.
const USES_RE =
  /^\s*(-\s+)?uses:\s*["']?\.\/\.github\/actions\/turbo-packages-build["']?\s*(#.*)?$/;

// `turbo build` is Turborepo's documented shorthand for `turbo run build`, and
// the flag may be separated by a line continuation inside a `run: |` block, so
// neither the `run ` nor a single space can be required. Quote-tolerant too:
// `--filter='./packages/*'`, `--filter="./packages/*"` and `--filter=./packages/*`
// are one instruction to bash.
const BUILD_CMD_RE = /turbo\s+(run\s+)?build[\s\S]{0,40}?--filter[=\s]['"]?\.\/packages\/\*/;

/** `save:` lines in a block, as `{ line, value }` with comments and quotes stripped. */
function saveValues(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*-?\s*save:\s*(.*)$/);
    if (!m) continue;
    const value = m[1]
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
    out.push({ line, value });
  }
  return out;
}

/**
 * Whether a `save:` value selects the write branch.
 *
 * Deliberately case-insensitive: YAML resolves `TRUE` and `True` to boolean
 * true, GitHub stringifies action inputs, and GitHub's `==` compares strings
 * case-insensitively -- so `save: TRUE` reaches `inputs.save == 'true'` as
 * true down either path. A case-sensitive check would let a second cache
 * WRITER through while still counting one producer.
 */
const isTruthySave = (value) => value.toLowerCase() === "true";

/** `{ name, text }` for every YAML file under a directory tree. */
function yamlFilesUnder(root, rel = "") {
  const dir = join(root, rel);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const name = rel ? `${rel}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...yamlFilesUnder(root, name));
    else if (/\.ya?ml$/.test(entry)) out.push({ name, text: readFileSync(full, "utf8") });
  }
  return out;
}

/**
 * Every YAML file that must NOT hand-write the cache key or the build command:
 * all workflows, plus every composite action except the canonical one. The
 * second half matters because this change established `.github/actions/` as a
 * pattern, so the next copy of the block is likelier to land there than in a
 * workflow.
 */
function guardedFiles() {
  return [
    ...yamlFilesUnder(WORKFLOWS).map((f) => ({ ...f, name: `.github/workflows/${f.name}` })),
    ...yamlFilesUnder(ACTIONS)
      .filter((f) => !f.name.startsWith(`${ACTION_DIR}/`))
      .map((f) => ({ ...f, name: `.github/actions/${f.name}` })),
  ];
}

/**
 * Lines of one `  <jobId>:` block in a workflow, comments stripped.
 *
 * Comments are stripped for two independent reasons. Neither has ever produced
 * a wrong result on this repo's actual `ci.yml` -- both are latent, and were
 * demonstrated by mutating the file rather than observed in the committed
 * state. They are guarded anyway because each fails silently and toward
 * "green": a job's explanatory comment block sits ABOVE its header and so
 * lands inside the PREVIOUS job's slice, where a comment naming the action
 * would read as that job using it; and the next-job regex must tolerate an
 * inline comment on a header (`  foo: # bar`) or the block bleeds into the
 * following job.
 */
function jobBlock(text, jobId) {
  const lines = text.split("\n");
  const key = (l) => l.replace(/\s+$/, "");
  // Quotes are permitted because `"api-tests":` is valid YAML for the same job
  // id. Without them the header is invisible, the previous job's block bleeds
  // through it, and a consumer gets reported as violating the cold-build guard
  // using its neighbour's `uses:` line.
  const isHeader = (l) => /^ {2}["']?[a-zA-Z0-9_-]+["']?:(\s*#.*)?$/.test(key(l));
  const start = lines.findIndex(
    (l) =>
      key(l)
        .replace(/\s*#.*$/, "")
        .replace(/^( {2})["'](.+)["']:$/, "$1$2:") === `  ${jobId}:`,
  );
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeader(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start, end)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** Jobs that must build shared packages through the action. */
const CONSUMERS = [
  "lint-and-typecheck",
  "api-tests",
  "web-tests",
  "api-contract-check",
  "dependency-cruiser",
  "mobile-validate",
  "web-responsive-floor",
];
const PRODUCER = "packages-build";

// Both carry an in-file comment saying a build/cache step silently disarms them:
// `clean-checkout-typecheck` reproduces a bare install on a cold machine, and
// `web-production-build` builds under a production prune. Prebuilt `dist/` on
// disk hides the failure each exists to surface, and a one-line `uses:` is now
// by far the easiest way to add one by accident.
const MUST_NOT_USE = ["clean-checkout-typecheck", "web-production-build"];

describe("turbo-packages-build composite action", () => {
  const ci = () => readFileSync(join(WORKFLOWS, "ci.yml"), "utf8");
  const action = () => readFileSync(ACTION, "utf8");

  it("exists and is a composite action", () => {
    assert.ok(existsSync(ACTION), `${ACTION} is missing`);
    assert.match(action(), /using:\s*composite/, "action must declare `using: composite`");
  });

  // Without this the guard is pointed only at the place the key LEFT, not the
  // place it went -- so editing a hashFiles glob, or dropping the prefix, would
  // pass green while silently changing what every job restores.
  it("still single-sources the exact cache key", () => {
    const text = action();
    // Asserted on the key EXPRESSION rather than on a surrounding `key:` or
    // `echo key=`, so the assertion survives a change to how the action plumbs
    // the value through while still failing if the value itself moves.
    assert.ok(
      text.includes(
        "turbo-pkgbuild-${{ runner.os }}-${{ hashFiles('package-lock.json', " +
          "'turbo.json', 'packages/**/src/**', 'packages/**/package.json', " +
          "'packages/**/tsconfig.json') }}",
      ),
      "the cache key changed -- every previously saved entry stops matching. If that " +
        "is intended, update this assertion deliberately rather than letting it drift.",
    );
    assert.match(
      text,
      /restore-key=turbo-pkgbuild-\$\{\{ runner\.os \}\}-/,
      "the `turbo-pkgbuild-<os>-` restore-keys prefix is what keeps a drifted exact " +
        "key a stale hit instead of a cold rebuild",
    );
  });

  // A rename here is not a hard error at runtime: GitHub emits a non-fatal
  // `Warning: Unexpected input(s) 'save'`, `inputs.save` goes unset, and the
  // producer silently takes the read-only branch -- so `.turbo` is never written
  // and every job rebuilds, forever, with CI green.
  it("still honours the `save` input on both branches", () => {
    const text = action();
    assert.match(text, /^ {2}save:$/m, "the `save` input must keep its name");
    assert.match(text, /if:\s*inputs\.save == 'true'/, "the write branch must be gated on it");
    assert.match(text, /if:\s*inputs\.save != 'true'/, "the read branch must be gated on it");
    assert.match(text, /uses:\s*actions\/cache@v4/, "the producer branch must save the cache");
    assert.match(
      text,
      /uses:\s*actions\/cache\/restore@v4/,
      "consumers must use the restore-only action, which has no post hook to race the producer",
    );
  });

  it("is the only place the turbo cache key is written", () => {
    const offenders = guardedFiles()
      .filter((f) => f.text.includes("turbo-pkgbuild"))
      .map((f) => f.name);
    assert.deepEqual(
      offenders,
      [],
      "the `turbo-pkgbuild-` cache key belongs only in " +
        ".github/actions/turbo-packages-build/action.yml",
    );
  });

  it("is the only place packages/* is built", () => {
    const offenders = guardedFiles()
      .filter((f) => BUILD_CMD_RE.test(f.text))
      .map((f) => f.name);
    assert.deepEqual(
      offenders,
      [],
      "build `packages/*` through ./.github/actions/turbo-packages-build, not a hand-written step",
    );
  });

  it("has exactly one producer, and it is packages-build", () => {
    const text = ci();
    const saves = saveValues(text);
    // A block scalar (`save: >-` / `save: |`) folds to a value this line-based
    // scan cannot see, so it is refused outright rather than mis-parsed: `>-`
    // yields exactly "true" and would select the write branch invisibly.
    const blockScalars = saves.filter((s) => /^[>|]/.test(s.value));
    assert.deepEqual(
      blockScalars.map((s) => s.line.trim()),
      [],
      "spell `save` inline (`save: \"true\"`), not as a block scalar -- a folded value " +
        "still selects the write branch but is invisible to this guard",
    );
    assert.equal(
      saves.filter((s) => isTruthySave(s.value)).length,
      1,
      "exactly one job may pass a truthy `save` -- a second writer races the first " +
        "for the same cache key",
    );
    const producer = jobBlock(text, PRODUCER);
    assert.ok(producer, `ci.yml must still define a \`${PRODUCER}\` job`);
    assert.ok(
      saveValues(producer).some((s) => isTruthySave(s.value)),
      `${PRODUCER} is the job that writes the cache`,
    );
  });

  it("is used by every job that needs prebuilt packages", () => {
    const text = ci();
    // `web-responsive-floor` is the one ADR-15's original text omitted, which is
    // how its consumer count went stale at six. Listed explicitly so the same
    // drift cannot recur unnoticed.
    for (const jobId of [PRODUCER, ...CONSUMERS]) {
      const block = jobBlock(text, jobId);
      assert.ok(block, `ci.yml must still define a \`${jobId}\` job`);
      assert.ok(
        block.split("\n").some((l) => USES_RE.test(l)),
        `${jobId} must build packages through the shared action`,
      );
    }
  });

  it("stays out of the two jobs that exist to catch a cold build", () => {
    const text = ci();
    for (const jobId of MUST_NOT_USE) {
      const block = jobBlock(text, jobId);
      assert.ok(block, `ci.yml must still define a \`${jobId}\` job`);
      assert.ok(
        !block.split("\n").some((l) => USES_RE.test(l)),
        `${jobId} must NOT use the shared build action -- it exists to fail when ` +
          "shared packages cannot build from a cold tree",
      );
    }
  });

  // A job gated on `changes.web` that builds packages must have the action in
  // that filter, or a PR touching only the action skips it -- and both gated
  // jobs are REQUIRED checks, which report Success when skipped.
  it("is a path-filter input for the gated jobs that use it", () => {
    const text = ci();
    const gated = CONSUMERS.filter((j) => {
      const block = jobBlock(text, j);
      return block && block.includes("needs.changes.outputs.web");
    });
    assert.ok(gated.length > 0, "expected at least one web-gated consumer");
    // Sliced to the `web:` filter specifically. Regexing the whole file would
    // pass just as happily with the entry sitting under `pglite:`, which
    // restores the exact hole this assertion exists to hold shut.
    const lines = text.split("\n");
    const start = lines.findIndex((l) => /^ {12}web:\s*$/.test(l));
    assert.ok(start !== -1, "ci.yml must still define a `web:` paths-filter");
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^ {12}\S/.test(lines[i])) {
        end = i;
        break;
      }
    }
    const webFilter = lines.slice(start, end).join("\n");
    assert.match(
      webFilter,
      /^\s*- ["']?\.github\/actions\/\*\*["']?\s*$/m,
      `${gated.join(", ")} are gated on changes.web and build through the action, so ` +
        "'.github/actions/**' must be in the WEB filter or a PR editing only the action " +
        "skips required checks that report Success when skipped",
    );
  });
});
