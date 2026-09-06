import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { INFISICAL_ENV_SLUGS } from "../../check-env-slugs.mjs";

// Pins the second and third cutover of stage 4's composite-action work (#1382):
// the Infisical preamble+injection (15 call sites across 6 workflows) and the
// Supabase CLI version pin (4 sites).
//
// Why this file has teeth beyond "the copies stayed gone": most of the eleven
// Infisical call sites never run on a pull request.
//
//   * ONE runs on every same-repo PR -- `migration-drift` in
//     migration-drift-gate.yml, the only injection with no step-level `if:`.
//     That is what proves the MECHANISM per PR: a composite-nested
//     `secrets-action` still exports to the calling job.
//   * TWO more, in that same workflow (`migration-replay`, `migration-order`),
//     are step-gated on `steps.touched.outputs.run == 'true'`, so they run only
//     on a PR that touches `supabase/migrations/`.
//   * TWO are `workflow_run`, firing after merge (deploy-api.yml).
//   * The remaining SIX are scheduled or dispatch-only, two of them on the
//     production deploy path, which no PR ever exercises.
//
// So CI can prove the mechanism but not the TRANSCRIPTION, and this file has to:
// that all eleven were converted, that none was left hand-written, that each
// still passes what it used to pass, and that each still asks for the
// environment its job actually needs.
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

/** A job key: two-space indent, optionally quoted, optional trailing comment. */
const JOB_KEY_RE = /^ {2}["']?([A-Za-z0-9_-]+)["']?:\s*(#.*)?$/;

// Anything that repoints the workspace at a different commit. Deliberately
// broad and it must STAY broad: unlike `usesLocal`, a miss here fails OPEN.
// `git checkout` alone was not enough — `git switch --detach "$DEPLOY_SHA"` is
// a one-word modernization that silently disarmed the guard in testing.
const WORKSPACE_REWRITE_RE =
  /\bgit\s+(checkout|switch|worktree)\b|\bgit\s+reset\s+--hard\b/;

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

  it("agrees with the version SECRETS_MANAGEMENT.md quotes", () => {
    // That doc names `Infisical/secrets-action@v1.0.12` in prose — a second,
    // hand-maintained copy of a version that now lives in one place. Same
    // treatment as scripts/db-backup.sh's deliberate duplicate: keep the copy
    // (a reader debugging a 401 wants the version in front of them) and let a
    // test, rather than a habit, keep it equal.
    const pin = infisicalAction.match(/uses:\s*Infisical\/secrets-action@(\S+)/)?.[1];
    assert.ok(pin, "the action must pin a secrets-action version");
    const doc = readFileSync(
      join(REPO, "docs", "internal", "environment", "SECRETS_MANAGEMENT.md"),
      "utf8",
    );
    const quoted = [...doc.matchAll(/Infisical\/secrets-action@(\S+?)`/g)].map((m) => m[1]);
    assert.ok(quoted.length > 0, "SECRETS_MANAGEMENT.md no longer quotes the version");
    for (const v of quoted) {
      assert.equal(
        v,
        pin,
        `SECRETS_MANAGEMENT.md quotes Infisical/secrets-action@${v} but the action pins ` +
          `@${pin} — bump both together`,
      );
    }
  });

  it("defaults `on-missing-credentials` to `error`", () => {
    // Ten of the eleven call sites pass nothing and rely entirely on this
    // default. Nothing asserted it, so flipping it to `warn` made every site —
    // deploy-production's `prod` injection included — continue past absent
    // credentials into `supabase db push`, with the suite green. The shell
    // branch test below could not see it: the branch shape is untouched by a
    // change to the default that feeds it.
    assert.match(
      infisicalAction,
      /on-missing-credentials:[\s\S]*?\n\s+default:\s*["']?error["']?\s*$/m,
      "the default must be `error`; only staging-conformance opts into `warn`, " +
        "explicitly, at its call site",
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

  it("keeps the 'credentials are present' diagnostics off the missing path", () => {
    // The whole point of this preflight is telling an ABSENT credential apart
    // from a REJECTED one (#696/#763). In the inline originals `exit 1` made
    // that structural — nothing after the check ran unless the credentials
    // existed. The warn path removed that guarantee, and an unconditional
    // trailing echo then asserts "a 401 means rejected, not missing" three
    // lines after warning that it IS missing — at staging-conformance, the one
    // call site whose entire job is reporting which of the two it was.
    //
    // So both trailing diagnostics must sit in the `else` of the MISSING test.
    // Asserted structurally, since the shell is not executed here.
    // Block-scoped, not offset-based. Slicing at the first `else` and asking
    // whether the text appears "after" it accepted a diagnostic moved OUTSIDE
    // the `if` entirely — one line past the closing `fi`, unconditional again,
    // which is the exact regression this test exists for. Confirmed by
    // mutation. So: find the `if`, find its matching `fi` by indentation, and
    // require each diagnostic to live between the `else` and that `fi`.
    const run = infisicalAction.slice(infisicalAction.indexOf('MISSING=""'));
    const lines = run.split("\n");
    const ifAt = lines.findIndex((l) => /^ {8}if \[ -n "\$MISSING" \]; then$/.test(l));
    assert.ok(ifAt >= 0, "the missing-credentials test must be an 8-space-indented if");
    const elseAt = lines.findIndex((l, i) => i > ifAt && /^ {8}else$/.test(l));
    const fiAt = lines.findIndex((l, i) => i > ifAt && /^ {8}fi$/.test(l));
    assert.ok(elseAt > ifAt, "it must have an else branch");
    assert.ok(fiAt > elseAt, "it must be closed by an fi at the same indent");

    const elseBranch = lines.slice(elseAt + 1, fiAt).join("\n");
    const everywhereElse = [
      ...lines.slice(0, elseAt + 1),
      ...lines.slice(fiAt),
    ].join("\n");

    for (const [what, needle] of [
      ["the whitespace warning", "contains whitespace"],
      ["the 'a 401 means rejected' line", "Preflight complete"],
    ]) {
      assert.ok(
        elseBranch.includes(needle),
        `${what} must live in the else branch — it describes a credential that IS present`,
      );
      assert.ok(
        !everywhereElse.includes(needle),
        `${what} is also reachable when a credential is MISSING (outside the else), ` +
          `so a run would warn the credential is absent and then state it is present`,
      );
    }
  });

  it("is a composite action", () => {
    assert.match(infisicalAction, /using:\s*composite/);
  });
});

describe("composite action manifests", () => {
  it("carries no template expression above `runs:`", () => {
    // The runner evaluates an action manifest as a template, and the metadata
    // above `runs:` — `name`, `description`, and every `inputs.*.description` —
    // is evaluated with almost no contexts available. A `${…}` naming `inputs`
    // or `secrets` there is not inert prose: the manifest FAILS TO LOAD, with
    // "Unrecognized named-value: 'inputs'", and every job calling the action
    // dies before its first step.
    //
    // This is invisible to YAML parsing — the file is perfectly valid YAML —
    // and it shipped, because describing the expression is the natural way to
    // document the input. CI caught it; nothing local did. Hence this check.
    const OPEN = "$" + "{{";
    for (const { name, text } of otherActions) {
      if (!text) continue;
      const runsAt = text.search(/^runs:/m);
      assert.ok(runsAt > 0, `${name}/action.yml has no top-level runs: key`);
      const metadata = text.slice(0, runsAt);
      const line = metadata.slice(0, metadata.indexOf(OPEN)).split("\n").length;
      assert.ok(
        !metadata.includes(OPEN),
        `${name}/action.yml line ~${line}: a template expression appears in the ` +
          `action's metadata (above \`runs:\`). The runner evaluates it there and the ` +
          `manifest will fail to load. Describe it in words, or move it under \`runs:\`.`,
      );
    }
  });
});

describe("Infisical call sites", () => {
  const callSites = workflows.filter((w) => USES_INFISICAL.test(w.text) ||
    codeLines(w.text).some((l) => USES_INFISICAL.test(l)));

  it("injects the expected environment in each expected job", () => {
    // Every call site named by FILE, JOB and SLUG rather than counted.
    //
    // A bare total of 11 plus a set of filenames let two real regressions
    // through, both confirmed by mutation:
    //
    //   * moving a site between jobs in one file — deleting `deploy-staging`'s
    //     injection and duplicating one into `migrate-staging` keeps the total
    //     at 11 and the filename set identical, while the staging API deploy
    //     loses every secret it needs;
    //   * swapping a slug — `deploy-production.yml` asking for `staging`
    //     type-checks as "a legal slug at a legal site", and the only path to
    //     production then migrates the staging database.
    //
    // Neither is a counting error, so no count catches them. This is the
    // roster the cutover actually has to preserve.
    const EXPECTED = [
      ["check-migration-drift.yml", "check-drift", "staging"],
      ["check-migration-drift.yml", "check-drift", "prod"],
      ["db-backup.yml", "backup-staging", "staging"],
      ["db-backup.yml", "backup-staging-storage", "staging"],
      // The production backup jobs inject TWO environments, in this order:
      // `staging` carries the offsite bucket (`BACKUP_S3_*` live only there),
      // `prod` carries the source and overrides every shared name. The
      // db-offsite-backup / storage-offsite-backup actions then assert the
      // injected ref against .github/environments.json before linking, so a
      // reordering here can only fail the job, never mislabel a dump (#1435).
      ["db-backup.yml", "backup-production", "staging"],
      ["db-backup.yml", "backup-production", "prod"],
      ["db-backup.yml", "backup-production-storage", "staging"],
      ["db-backup.yml", "backup-production-storage", "prod"],
      ["deploy-api.yml", "migrate-staging", "staging"],
      ["deploy-api.yml", "deploy-staging", "staging"],
      ["deploy-production.yml", "deploy", "prod"],
      ["migration-drift-gate.yml", "migration-drift", "staging"],
      ["migration-drift-gate.yml", "migration-replay", "prod"],
      ["migration-drift-gate.yml", "migration-order", "prod"],
      ["staging-conformance.yml", "conformance", "staging"],
    ];

    const actual = [];
    for (const { name, text } of workflows) {
      const lines = linesOf(text).map((l) => (/^\s*#/.test(l) ? "" : l));
      let job = null;
      lines.forEach((line, i) => {
        const m = line.match(JOB_KEY_RE);
        if (m && i > 3) job = m[1];
        if (!USES_INFISICAL.test(line)) return;
        const slug = lines
          .slice(i, i + 8)
          .join("\n")
          .match(/^\s+env-slug:\s*"([a-z]+)"\s*$/m)?.[1];
        actual.push([name, job, slug]);
      });
    }

    assert.deepEqual(
      actual.map((r) => r.join(" / ")).sort(),
      EXPECTED.map((r) => r.join(" / ")).sort(),
      "the Infisical call-site roster changed. Each entry is file / job / slug; " +
        "update this list deliberately if a site legitimately moved.",
    );
    assert.equal(actual.length, 15);
  });

  it("leaves no hand-written injection or preflight anywhere", () => {
    // The cutover half. `AGENTS.md` § Tech debt protocol: a shared helper
    // standing beside surviving copies is a net loss, not progress.
    for (const { name, text } of [...workflows, ...otherActions]) {
      if (name === "infisical-secrets") continue; // the action itself
      // Case-INSENSITIVE: GitHub resolves `uses: owner/repo` case-insensitively,
      // so `infisical/secrets-action` is the same action and must not slip past.
      assert.ok(
        !/infisical\/secrets-action/i.test(text),
        `${name} hand-writes Infisical/secrets-action; call ./.github/actions/infisical-secrets instead`,
      );
      // Matched on the preflight's SHAPE, not on one exact step name. Anchoring
      // on `- name: Verify Infisical credentials` let a copy back in simply by
      // being called something else; this line is the part a copy cannot omit
      // and still be the check.
      assert.ok(
        !/MISSING INFISICAL_MACHINE_IDENTITY_ID/.test(text),
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
      // Quote-tolerant. YAML makes `warn` and `"warn"` the same value, and every
      // other input at these call sites IS quoted (`env-slug: "staging"`,
      // `method: "universal"`), so the quoted spelling is the likely one. The
      // bare-word-only form failed OPEN: a second site could pass
      // `on-missing-credentials: "warn"` — a production deploy proceeding past
      // absent credentials into `supabase db push` — with this suite green.
      const uses = codeLines(text).some((l) =>
        /on-missing-credentials:\s*["']?warn["']?\s*(#.*)?$/.test(l),
      );
      if (name === "staging-conformance.yml") {
        assert.ok(uses, "staging-conformance.yml must keep on-missing-credentials: warn");
        // codeLines again, for the same reason as above: this file's own comment
        // explains the continue-on-error, and reading raw text let that prose
        // satisfy the assertion after the real key was deleted.
        assert.ok(
          codeLines(text).some((l) => /continue-on-error:\s*true/.test(l)),
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
    // Sibling composite actions included, matching the Infisical rule above and
    // what .github/actions/README.md states ("in a workflow OR in another
    // composite action"). Scanning workflows alone would let a future
    // .github/actions/<x> hand-write its own pinned setup-cli, and the
    // production apply would then run a different CLI build than the
    // migration-replay rehearsal — both green.
    for (const { name, text } of [...workflows, ...otherActions]) {
      if (name === "supabase-cli") continue; // the action itself
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
    // Three in workflows; the fourth moved into the db-offsite-backup composite
    // when db-backup.yml's dump sequence was extracted (#1435), which is why the
    // sibling actions are counted here too — a call site that migrates into a
    // composite is still a call site.
    const total = [...workflows, ...otherActions]
      .filter(({ name }) => name !== "supabase-cli")
      .reduce((n, w) => n + countMatching(w.text, USES_SUPABASE), 0);
    assert.equal(total, 4);
  });

  it("agrees with db-backup.sh's fallback pin", () => {
    // scripts/db-backup.sh keeps its own `npx supabase@<version>` fallback for
    // local runs where nothing is on PATH. That is a legitimate second copy --
    // teaching the backup script to parse YAML would add a failure mode to the
    // one script that produces this project's only restorable backup -- but an
    // UNCHECKED second copy is how the two silently diverge.
    //
    // The drift that matters is #1421's restore rehearsal: it is run by hand,
    // usually with no CLI on PATH, so it would exercise the stale fallback
    // against dumps CI produced with the bumped pin -- validating a code path
    // the backup never used. Asserting equality here means a bump has to move
    // both, and the failure names the file to change.
    const script = readFileSync(join(REPO, "scripts", "db-backup.sh"), "utf8");
    const fallback = script.match(/SUPABASE_CLI_VERSION="\$\{SUPABASE_CLI_VERSION:-([^}]+)\}"/)?.[1];
    assert.ok(fallback, "scripts/db-backup.sh no longer declares a fallback CLI version");
    assert.equal(
      fallback,
      pinnedVersion,
      "scripts/db-backup.sh's fallback Supabase CLI version has drifted from the pin in " +
        ".github/actions/supabase-cli/action.yml — bump both together",
    );
    // …and the command must actually USE that variable. Checking the
    // declaration alone let the two diverge with the assertion satisfied:
    // hardcoding `supabase@2.70.0` on the invocation line leaves the declared
    // fallback equal to the pin and completely ignored.
    assert.match(
      script,
      /SUPABASE="npx --yes supabase@\$\{SUPABASE_CLI_VERSION\}"/,
      "db-backup.sh must invoke the CLI through $SUPABASE_CLI_VERSION, not a literal — " +
        "otherwise the checked declaration is dead and the real version is unpinned",
    );
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
      let workspaceMoved = null;
      lines.forEach((line, i) => {
        // Job boundary. Tolerates a quoted id and a trailing comment: the
        // stricter `/^ {2}[a-z0-9_-]+:\s*$/` never matched `deploy-prod: # note`
        // or `"deploy-prod":`, so one job's checkout leaked into the next and
        // the guard passed over a job that had none — the exact bug it exists
        // to catch. The sibling turbo guard already handles both spellings.
        if (JOB_KEY_RE.test(line) && i > 3) {
          checkedOut = false;
          workspaceMoved = null;
        }
        if (/uses:\s*actions\/checkout@/.test(line)) {
          // The FIRST checkout in a job establishes the workspace. A LATER one
          // moves it, and must be treated exactly like `git checkout --detach`
          // — otherwise rewriting the detach as `actions/checkout` with
          // `ref: ${{ inputs.sha }}` both re-breaks the rollback path and
          // clears the flag that would have caught it. Confirmed by mutation.
          if (checkedOut) workspaceMoved = i + 1;
          else checkedOut = true;
        }
        // A step that rewrites the tree invalidates every LATER local action in
        // the job, because `uses: ./…` resolves from the workspace at
        // step-execution time. deploy-production.yml detaches to the deployed
        // SHA, so calling a local action after that point loads it from THAT
        // commit: deploying anything older than the action fails with "Can't
        // find 'action.yml'" — the rollback path — and deploying anything newer
        // silently uses that commit's copy of the CLI pin. A checkout earlier
        // in the job is necessary but NOT sufficient, which is why this is
        // tracked separately.
        if (WORKSPACE_REWRITE_RE.test(line) && checkedOut) {
          workspaceMoved = i + 1;
        }
        if (USES_INFISICAL.test(line) || USES_SUPABASE.test(line)) {
          assert.ok(
            checkedOut,
            `${name}:${i + 1} calls a local composite action with no actions/checkout ` +
              `earlier in the same job — the action file will not be on disk`,
          );
          assert.equal(
            workspaceMoved,
            null,
            `${name}:${i + 1} calls a local composite action AFTER the workspace was ` +
              `rewritten at line ${workspaceMoved} — it would load the action from that ` +
              `tree, not the trusted ref. Move the action call before the checkout.`,
          );
        }
      });
    }
  });
});
