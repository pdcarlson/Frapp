import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { INFISICAL_ENV_SLUGS } from "../../check-env-slugs.mjs";

// Pins the second and third cutover of stage 4's composite-action work (#1382):
// the Infisical preamble+injection (11 call sites across 6 workflows) and the
// Supabase CLI version pin (4 sites).
//
// Why this file has teeth beyond "the copies stayed gone": only ONE of the
// eleven Infisical call sites runs on a pull request at all -- `migration-drift`
// in migration-drift-gate.yml, the one injection with no step-level `if:`. The
// other ten live in scheduled or dispatch-only workflows, two of them on the
// production deploy path. So CI proves the MECHANISM (a composite-nested
// `secrets-action` still exports to the calling job) and this file has to prove
// the TRANSCRIPTION -- that all eleven were converted, that none was left
// hand-written, and that each still passes what it used to pass.
//
// The one that would hurt most is asserted first: `check-env-slugs.mjs` finds
// Infisical environment names by scanning for the literal `env-slug: "<slug>"`
// in `.github/workflows` and `.github/actions`. Inside the action the value is
// `${{ inputs.env-slug }}`, which that scan cannot match -- by design, because
// the real literals survive as the `with:` values at the call sites. Rename the
// action's input and all eleven literals leave the gate's reach at once: it
// then scans zero bytes and passes. That is the vacuous green its own section 0
// exists to refuse, and nothing else in the repo would notice.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOWS = join(REPO, ".github", "workflows");
const ACTIONS = join(REPO, ".github", "actions");

const INFISICAL_ACTION = join(ACTIONS, "infisical-secrets", "action.yml");
const SUPABASE_ACTION = join(ACTIONS, "supabase-cli", "action.yml");

const infisicalAction = readFileSync(INFISICAL_ACTION, "utf8");
const supabaseAction = readFileSync(SUPABASE_ACTION, "utf8");

/** `{ name, text }` for every workflow file. */
const workflows = readdirSync(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((name) => ({ name, text: readFileSync(join(WORKFLOWS, name), "utf8") }));

/** Every composite action's YAML, so a copy cannot hide in a sibling action. */
const otherActions = readdirSync(ACTIONS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({
    name: e.name,
    text: existsSync(join(ACTIONS, e.name, "action.yml"))
      ? readFileSync(join(ACTIONS, e.name, "action.yml"), "utf8")
      : "",
  }));

// Tolerates every legal spelling of the same step: the name-less `- uses:` form,
// a quoted path, and a trailing comment. A stricter regex is not "safer" here --
// these drive NEGATIVE assertions ("nobody hand-writes this"), and a regex that
// is too tight fails OPEN, letting the copy it exists to forbid back in with the
// suite still green. This is the failure the turbo guard shipped with and had to
// fix in review; it is not repeated here.
const usesLocal = (slug) =>
  new RegExp(`^\\s*(-\\s+)?uses:\\s*["']?\\./\\.github/actions/${slug}["']?\\s*(#.*)?$`);

const USES_INFISICAL = usesLocal("infisical-secrets");
const USES_SUPABASE = usesLocal("supabase-cli");

const linesOf = (text) => text.split("\n");
const countMatching = (text, re) => linesOf(text).filter((l) => re.test(l)).length;

/** Non-comment lines only, so a mention in prose cannot satisfy or trip an assertion. */
const codeLines = (text) =>
  linesOf(text).filter((l) => !/^\s*#/.test(l));

describe("infisical-secrets composite action", () => {
  it("declares an input named exactly `env-slug`", () => {
    // Load-bearing for check-env-slugs.mjs § 3 -- see this file's header.
    assert.match(
      infisicalAction,
      /^ {2}env-slug:$/m,
      "the input must be named `env-slug`: check-env-slugs.mjs matches the literal " +
        "`env-slug: \"<slug>\"` at the call sites, and renaming this input moves all " +
        "eleven slugs out of that gate's reach while it keeps exiting 0.",
    );
  });

  it("passes every input the hand-written call sites used to pass", () => {
    // The extraction is only lossless if the constants the call sites carried
    // are still carried. `include-imports: true` in particular was written at
    // all eleven sites and is NOT the action's default.
    for (const [key, value] of [
      ["method", '"universal"'],
      ["project-slug", '"frapp-live-ej-ls"'],
      ["secret-path", '"/"'],
      ["include-imports", "true"],
    ]) {
      assert.match(
        infisicalAction,
        new RegExp(`^\\s+${key}:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"),
        `the action must still pass ${key}: ${value}`,
      );
    }
    assert.match(
      infisicalAction,
      /uses:\s*Infisical\/secrets-action@v1\.0\.12/,
      "the pinned third-party action version must not drift silently",
    );
  });

  it("fails closed when `on-missing-credentials` is anything but `warn`", () => {
    // A typo in the input must not downgrade a hard gate to a warning at ten
    // call sites that expect it to fail. Asserting the shape of the branch,
    // since the shell itself is not executed here.
    assert.match(
      infisicalAction,
      /if \[ "\$ON_MISSING" = "warn" \]; then/,
      "the warn branch must be an equality test against the literal `warn`, " +
        "so any other value (including a typo) takes the error branch",
    );
    const errorBranch = infisicalAction.slice(infisicalAction.indexOf('= "warn" ]; then'));
    assert.match(errorBranch, /else\n\s+echo "::error::\$DETAIL"\n\s+exit 1/);
  });

  it("is a composite action", () => {
    assert.match(infisicalAction, /using:\s*composite/);
  });
});

describe("Infisical call sites", () => {
  const callSites = workflows.filter((w) => USES_INFISICAL.test(w.text) ||
    codeLines(w.text).some((l) => USES_INFISICAL.test(l)));

  it("covers all 11 sites across the 6 workflows that need secrets", () => {
    const total = workflows.reduce(
      (n, w) => n + countMatching(w.text, USES_INFISICAL),
      0,
    );
    assert.equal(
      total,
      11,
      "expected 11 Infisical call sites. If a workflow legitimately gained or " +
        "lost one, update this number deliberately -- it is here so a site " +
        "silently disappearing shows up as a failure rather than as nothing.",
    );
    assert.deepEqual(
      callSites.map((w) => w.name).sort(),
      [
        "check-migration-drift.yml",
        "db-backup.yml",
        "deploy-api.yml",
        "deploy-production.yml",
        "migration-drift-gate.yml",
        "staging-conformance.yml",
      ],
    );
  });

  it("leaves no hand-written injection or preflight anywhere", () => {
    // The cutover half. `AGENTS.md` § Tech debt protocol: a shared helper
    // standing beside surviving copies is a net loss, not progress.
    for (const { name, text } of [...workflows, ...otherActions]) {
      if (name === "infisical-secrets") continue; // the action itself
      assert.ok(
        !/Infisical\/secrets-action/.test(text),
        `${name} hand-writes Infisical/secrets-action; call ./.github/actions/infisical-secrets instead`,
      );
      assert.ok(
        !/- name: Verify Infisical credentials/.test(text),
        `${name} hand-writes the credential preflight; the action bundles it`,
      );
    }
  });

  it("passes a quoted literal slug at every site, so the env-slug gate can read it", () => {
    // If a call site ever passed `env-slug: ${{ ... }}`, check-env-slugs.mjs
    // would stop seeing that slug -- silently, since an unmatched line is
    // indistinguishable from a file with no slugs in it.
    for (const { name, text } of workflows) {
      // Comment lines are dropped before the window is taken: a commented-out
      // `# env-slug: "staging"` sitting near a call site would otherwise satisfy
      // this, which is the same prose-satisfies-assertion hole the warn check
      // had. Positional line numbers are kept for the failure message.
      const lines = linesOf(text).map((l) => (/^\s*#/.test(l) ? "" : l));
      lines.forEach((line, i) => {
        if (!USES_INFISICAL.test(line)) return;
        const window = lines.slice(i, i + 8).join("\n");
        const m = window.match(/^\s+env-slug:\s*(.+)$/m);
        assert.ok(m, `${name}:${i + 1} calls the action without an env-slug`);
        const value = m[1].trim();
        assert.match(
          value,
          /^"(staging|prod)"$/,
          `${name}:${i + 1} must pass a QUOTED LITERAL slug (got ${value}). ` +
            `An expression here is invisible to check-env-slugs.mjs.`,
        );
        assert.ok(
          INFISICAL_ENV_SLUGS.includes(value.replaceAll('"', "")),
          `${name}:${i + 1} names an Infisical environment that does not exist`,
        );
      });
    }
  });

  it("only staging-conformance downgrades a missing credential to a warning", () => {
    // Every other site fails closed on a missing credential, and must keep
    // doing so. staging-conformance is the deliberate exception: it exists to
    // REPORT credential drift, so it needs the run to continue -- see its own
    // comment and the input's.
    for (const { name, text } of workflows) {
      // Non-comment lines ONLY. staging-conformance.yml's own comment explains
      // why it passes `on-missing-credentials: warn`, and reading raw text let
      // that prose satisfy this assertion -- deleting the real input left the
      // suite green. Caught by mutation-checking this file, not by review.
      const uses = codeLines(text).some((l) => /on-missing-credentials:\s*warn/.test(l));
      if (name === "staging-conformance.yml") {
        assert.ok(uses, "staging-conformance.yml must keep on-missing-credentials: warn");
        assert.match(
          text,
          /continue-on-error:\s*true/,
          "…and its continue-on-error, which covers the injection half",
        );
      } else {
        assert.ok(
          !uses,
          `${name} must fail closed on a missing Infisical credential`,
        );
      }
    }
  });
});

/** The single pinned CLI version, read from the action so it is written once. */
const pinnedVersion = supabaseAction.match(/^\s+version:\s*(\S+)\s*$/m)?.[1];

describe("supabase-cli composite action", () => {
  it("pins exactly one version, in one place", () => {
    assert.ok(pinnedVersion, "the action must declare a version");
    const pins = codeLines(supabaseAction).filter((l) => /^\s+version:/.test(l));
    assert.equal(pins.length, 1, "the action must declare exactly one version");
    assert.match(pins[0], /version:\s*\d+\.\d+\.\d+\s*$/, "the pin must be exact");
  });

  it("takes no inputs, so the pin cannot be overridden per call site", () => {
    // A `version:` input would put four copies back and defeat the point: the
    // production apply and the migration-replay rehearsal must run the SAME CLI
    // build, and drift between them fails silently -- both go green.
    assert.ok(
      !/^inputs:/m.test(supabaseAction),
      "supabase-cli must not accept inputs; change the pin here, for everybody",
    );
  });

  it("leaves no literal CLI version or hand-written setup step in any workflow", () => {
    for (const { name, text } of workflows) {
      assert.ok(
        !/supabase\/setup-cli@/.test(text),
        `${name} hand-writes supabase/setup-cli; call ./.github/actions/supabase-cli`,
      );
      // The pinned version string itself, read from the action rather than
      // written here twice. Comments are included on purpose: a comment naming
      // the version is a copy that goes stale the moment the pin moves, which
      // is how the "same CLI code path" premise quietly stops being true. Two
      // such comments existed and were repointed at the action.
      //
      // Matching the exact pin rather than "any x.y.z on a line mentioning
      // supabase" is deliberate -- the loose form matches `127.0.0.1` in
      // `NEXT_PUBLIC_SUPABASE_URL` and fails on a healthy tree.
      assert.ok(
        !text.includes(pinnedVersion),
        `${name} names the Supabase CLI version ${pinnedVersion}; the pin lives in ` +
          `.github/actions/supabase-cli and must exist exactly once`,
      );
    }
  });

  it("is called at all 4 sites", () => {
    const total = workflows.reduce((n, w) => n + countMatching(w.text, USES_SUPABASE), 0);
    assert.equal(total, 4);
  });
});

describe("local actions resolve at every call site", () => {
  it("every job calling a local action checks out first", () => {
    // `uses: ./…` resolves against the runner workspace, so without an earlier
    // actions/checkout in the SAME job the step fails with "Can't find
    // 'action.yml'". deploy-api.yml's deploy-staging job had no checkout at all
    // -- it only curls a deploy hook -- and gained one for exactly this reason.
    // That job runs on workflow_run after merge, so no PR would have caught it.
    for (const { name, text } of workflows) {
      // Comments blanked for the same reason as above: a commented-out
      // `# uses: actions/checkout@v4` must not satisfy the requirement for a
      // real one.
      const lines = linesOf(text).map((l) => (/^\s*#/.test(l) ? "" : l));
      let checkedOut = false;
      lines.forEach((line, i) => {
        if (/^  [a-z0-9_-]+:\s*$/.test(line) && i > 3) checkedOut = false;
        if (/uses:\s*actions\/checkout@/.test(line)) checkedOut = true;
        if (USES_INFISICAL.test(line) || USES_SUPABASE.test(line)) {
          assert.ok(
            checkedOut,
            `${name}:${i + 1} calls a local composite action with no actions/checkout ` +
              `earlier in the same job — the action file will not be on disk`,
          );
        }
      });
    }
  });
});
