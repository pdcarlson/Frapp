import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { INFISICAL_ENV_SLUGS } from "../../check-env-slugs.mjs";
import { readSupabaseCliPin } from "../lib/supabase-cli-pin.mjs";
import { workflowFiles } from "./helpers/workflow-yaml.mjs";

// Pins the second and third cutover of stage 4's composite-action work (#1382):
// the Infisical preamble+injection (14 call sites across 6 workflows since #2805;
// the roster below names each) and the
// Supabase CLI version pin (3 sites).
//
// Why this file has teeth beyond "the copies stayed gone": NONE of the
// Infisical call sites runs on a pull request, and none may (#2518). A
// same-repository PR runs its own branch's workflow, so a credential a PR job
// could read is one every branch could read. The three that used to run on
// PRs, in migration-drift-gate.yml, now read a published snapshot instead, and
// `workflow-secrets-scope.test.mjs` keeps every `secrets.*` out of PR jobs.
//
//   * ONE runs after merge, in `_deploy.yml` (since #2804), the shared job
//     `deploy-staging.yml` calls on `workflow_run` (it replaced deploy-api.yml's
//     two and deploy-vercel-staging.yml's one in #2803), and so does the
//     snapshot publisher (migration-snapshot.yml), which
//     proves the MECHANISM after every staging deploy: a composite-nested
//     `secrets-action` still exports to the calling job.
//   * The rest are scheduled or dispatch-only. Production's deploy is
//     `_deploy.yml`'s `prod` site, reached only by `deploy-production.yml`'s
//     dispatch (#2805).
//
// So no PR can prove the mechanism or the TRANSCRIPTION, and this file has to:
// that all eleven original were converted, that none was left hand-written, that each
// still passes what it used to pass, and that each still asks for the
// environment its job actually needs.
//
// The one that would hurt most is asserted first: `check-env-slugs.mjs` finds
// Infisical environment names by scanning for the literal `env-slug: "<slug>"`
// in `.github/workflows` and `.github/actions`. Inside the action the value is
// `${{ inputs.env-slug }}`, which that scan cannot match -- by design, because
// the real literals survive as the `with:` values at the call sites. Rename the
// action's input and all fourteen literals leave the gate's reach at once: it
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
const workflows = workflowFiles()
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
        "fourteen slugs out of that gate's reach while it keeps exiting 0.",
    );
  });

  it("passes every input the hand-written call sites used to pass", () => {
    // The extraction is only lossless if the constants the call sites carried
    // are still carried. `include-imports: true` in particular was written at
    // every site (sixteen at the time; fourteen after #2518, fifteen since #2583, sixteen since #2672,
    // fourteen since #2803 merged the three staging deploy injections into one) and is NOT the
    // action's default.
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
      /uses:\s*Infisical\/secrets-action@a663da43e1541832614bfd9dcf9ab67381ea2b98 # v1\.0\.12$/m,
      "the pinned third-party action commit (#2647) must not drift silently",
    );
  });

  it("agrees with the version SECRETS_MANAGEMENT.md quotes", () => {
    // That doc names `Infisical/secrets-action@v1.0.12` in prose — a second,
    // hand-maintained copy of a version that now lives in one place. Same
    // treatment as scripts/db-backup.sh's deliberate duplicate: keep the copy
    // (a reader debugging a 401 wants the version in front of them) and let a
    // test, rather than a habit, keep it equal.
    // The version is the pin's trailing comment; the ref itself is a commit SHA.
    const pin = infisicalAction.match(/uses:\s*Infisical\/secrets-action@[0-9a-f]{40} # (\S+)/)?.[1];
    assert.ok(pin, "the action must pin a secrets-action commit with its version in a comment");
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
    // Most of the fourteen call sites pass nothing and rely entirely on this
    // default. Nothing asserted it, so flipping it to `warn` made every site —
    // deploy-production's `prod` injection included — continue past absent
    // credentials into `supabase db push`, with the suite green. The shell
    // branch test below could not see it: the branch shape is untouched by a
    // change to the default that feeds it.
    assert.match(
      infisicalAction,
      /on-missing-credentials:[\s\S]*?\n\s+default:\s*["']?error["']?\s*$/m,
      "the default must be `error`; only the conformance watchdogs opt into `warn`, " +
        "explicitly, at their call sites",
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
      // `prod` carries the source and overrides every shared name. Empty
      // `BACKUP_S3_*` in `prod` are restored (`preserve-nonempty`) so they
      // cannot wipe the destination. The db-offsite-backup /
      // storage-offsite-backup actions then assert the injected ref against
      // .github/environments.json before linking, so a reordering here can
      // only fail the job, never mislabel a dump (#1435).
      ["db-backup.yml", "backup-production", "staging"],
      ["db-backup.yml", "backup-production", "prod"],
      ["db-backup.yml", "backup-production-storage", "staging"],
      ["db-backup.yml", "backup-production-storage", "prod"],
      // One injection for the whole staging deploy since #2803: the migration,
      // the API deploy and the web and landing builds all read it. The job
      // hands each build only its app's keys; the rest of the store stays out
      // of the Vercel CLI (`lib/vercel-build-env.mjs`, #834 option b, #2672).
      // In `_deploy.yml` since #2804, the job both deploy workflows call: one
      // step per environment, each with a literal slug and named by
      // `inputs.environment` (#2805). Production's slug is `prod`.
      ["_deploy.yml", "deploy", "staging"],
      ["_deploy.yml", "deploy", "prod"],
      // The migration gates on pull_request read the published snapshot and
      // inject nothing (#2518). This is the read that publishes it, in the
      // `automation` environment (main-only, #2583). It injects both, because
      // each environment's Supabase token reads only its own project.
      ["migration-snapshot.yml", "publish", "staging"],
      ["migration-snapshot.yml", "publish", "prod"],
      ["staging-conformance.yml", "conformance", "staging"],
      ["production-auth-conformance.yml", "auth-conformance", "prod"],
      // The quota watch reads both projects, in the `automation` environment,
      // with each environment's own read-only token (#2531).
      ["supabase-quota.yml", "quota", "staging"],
      ["supabase-quota.yml", "quota", "prod"],
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
    assert.equal(actual.length, 16);
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

  it("only the conformance watchdogs downgrade a missing credential to a warning", () => {
    // Every other site fails closed on a missing credential, and must keep
    // doing so. The two conformance watchdogs are the deliberate exception:
    // they exist to REPORT credential drift, so they need the run to continue
    // -- see their own comments and the input's.
    const warnOnMissing = new Set([
      "staging-conformance.yml",
      "production-auth-conformance.yml",
    ]);
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
      if (warnOnMissing.has(name)) {
        assert.ok(uses, `${name} must keep on-missing-credentials: warn`);
        // codeLines again, for the same reason as above: this file's own comment
        // explains the continue-on-error, and reading raw text let that prose
        // satisfy the assertion after the real key was deleted.
        assert.ok(
          codeLines(text).some((l) => /continue-on-error:\s*true/.test(l)),
          `${name} must keep continue-on-error, which covers the injection half`,
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
    // The reader run-migration.mjs and check-migration-replay.mjs fall back on.
    assert.equal(readSupabaseCliPin(), pinnedVersion);
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

  it("is called at all 3 sites", () => {
    // Two in workflows; the third moved into the db-offsite-backup composite
    // when db-backup.yml's dump sequence was extracted (#1435), which is why the
    // sibling actions are counted here too — a call site that migrates into a
    // composite is still a call site. Production's deploy and staging's share
    // one since #2805, in `_deploy.yml`.
    const total = [...workflows, ...otherActions]
      .filter(({ name }) => name !== "supabase-cli")
      .reduce((n, w) => n + countMatching(w.text, USES_SUPABASE), 0);
    assert.equal(total, 3);
  });

  // The shell scripts that run the CLI outside CI keep their own copy of the version. Each is a
  // legitimate second copy, and the reasons differ:
  //
  //   scripts/db-backup.sh          teaching the backup script to parse YAML would add a failure
  //                                 mode to the one script that produces this project's only
  //                                 offsite backup;
  //   scripts/lib/supabase-cli.sh   the resolver the sandbox and laptop bootstraps and
  //                                 db-restore-rehearsal.sh share, where an empty parse would
  //                                 install `latest` silently (#723).
  //
  // But an UNCHECKED second copy is how they silently diverge, and the divergence that matters
  // is real: #1421's restore rehearsal is run by hand, usually with no CLI on PATH, so a stale
  // fallback would exercise a code path the backup never used, and a stale bootstrap pin is the
  // three-way skew #723 closed. Asserting equality here means a bump has to move every copy,
  // and the failure names the file to change.
  //
  // Each copy is also checked for USE, not just declaration. Checking the declaration alone let
  // the two diverge with the assertion satisfied: hardcoding `supabase@2.70.0` on the invocation
  // line leaves the declared fallback equal to the pin and completely ignored.
  for (const { file, declared, used } of [
    {
      file: "scripts/db-backup.sh",
      declared: /SUPABASE_CLI_VERSION="\$\{SUPABASE_CLI_VERSION:-([^}]+)\}"/,
      used: /SUPABASE="npx --yes supabase@\$\{SUPABASE_CLI_VERSION\}"/,
    },
    {
      file: "scripts/lib/supabase-cli.sh",
      declared: /^FRAPP_SUPABASE_CLI_PIN="([^"]+)"$/m,
      // The spec the pin feeds AND the install it feeds: either alone would pass with the
      // other pointing at `latest`.
      used: /spec="\$\{FRAPP_SUPABASE_CLI_VERSION:-\$FRAPP_SUPABASE_CLI_PIN\}"[\s\S]*npm install --prefix "\$cache" "supabase@\$\{spec\}"/,
    },
  ]) {
    it(`agrees with ${file}'s copy of the pin`, () => {
      const script = readFileSync(join(REPO, file), "utf8");
      const copy = script.match(declared)?.[1];
      assert.ok(copy, `${file} no longer declares a Supabase CLI version`);
      assert.equal(
        copy,
        pinnedVersion,
        `${file}'s Supabase CLI version has drifted from the pin in ` +
          ".github/actions/supabase-cli/action.yml — bump both together",
      );
      assert.match(
        script,
        used,
        `${file} must invoke the CLI through its declared version, not a literal — ` +
          "otherwise the checked declaration is dead and the real version is unpinned",
      );
    });
  }
});

describe("local actions resolve at every call site", () => {
  // The workspace a job is in, as a state machine over its lines:
  //
  //   none      — nothing checked out yet;
  //   trusted   — the workflow's own commit: a first `actions/checkout` with no
  //               `ref:` (or `ref: ${{ github.sha }}`), or the one sanctioned
  //               move back to it, `git checkout --force --detach
  //               "$TRUSTED_SHA"` in a step whose `TRUSTED_SHA` is
  //               `${{ github.sha }}` (`_deploy.yml`, #2805);
  //   untrusted — anything else: a checkout with any other `ref:`, a later
  //               checkout, or any other rewrite of the tree.
  //
  // A local action may run only in `trusted`. `uses: ./…` resolves from the
  // workspace at step-execution time, so after a move to another commit it
  // loads THAT commit's copy: deploying anything older than the action fails
  // with "Can't find 'action.yml'" (the rollback path), and anything newer
  // silently uses that commit's copy of the CLI pin.
  const TRUSTED_MOVE = /^\s*git checkout --force --detach "\$TRUSTED_SHA"\s*$/;
  const TRUSTED_REF = /^\s*TRUSTED_SHA:\s*\$\{\{\s*github\.sha\s*\}\}\s*$/;
  const STEP_START = /^\s{4,}-\s/;

  /** Every local-action call, with the workspace state it runs in. */
  function localActionCalls(text) {
    // Comments blanked: a commented-out `# uses: actions/checkout@v4` must not
    // satisfy the requirement for a real one.
    const lines = linesOf(text).map((l) => (/^\s*#/.test(l) ? "" : l));
    const calls = [];
    let state = "none";
    let movedAt = null;
    let stepStart = 0;
    lines.forEach((line, i) => {
      // Job boundary. Tolerates a quoted id and a trailing comment: the
      // stricter `/^ {2}[a-z0-9_-]+:\s*$/` never matched `deploy-prod: # note`
      // or `"deploy-prod":`, so one job's checkout leaked into the next.
      if (JOB_KEY_RE.test(line) && i > 3) {
        state = "none";
        movedAt = null;
      }
      if (STEP_START.test(line)) stepStart = i;
      if (/uses:\s*actions\/checkout@/.test(line)) {
        // The step's own `ref:`, if any: the whole step, since `with:` may
        // come before `uses:`, bounded by the next step.
        let next = lines.findIndex((l, j) => j > i && STEP_START.test(l));
        if (next === -1) next = lines.length;
        const ref = lines.slice(stepStart, next).map((l) => l.match(/^\s+ref:\s*(.+?)\s*$/)?.[1]).find(Boolean);
        const own = !ref || /^\$\{\{\s*github\.sha\s*\}\}$/.test(ref);
        // Only the FIRST checkout can establish trust; a later one moves the
        // workspace like `git checkout --detach` does, and must read that way.
        if (state === "none" && own) state = "trusted";
        else {
          state = "untrusted";
          movedAt = i + 1;
        }
      } else if (TRUSTED_MOVE.test(line) && state !== "none") {
        let next = lines.findIndex((l, j) => j > i && STEP_START.test(l));
        if (next === -1) next = lines.length;
        const step = lines.slice(stepStart, next);
        // A move under an `if:` leaves the workspace on the deployed commit
        // whenever the condition is false.
        if (step.some((l) => TRUSTED_REF.test(l)) && !step.some((l) => /^\s+if:/.test(l))) {
          state = "trusted";
          movedAt = null;
        } else {
          state = "untrusted";
          movedAt = i + 1;
        }
      } else if (WORKSPACE_REWRITE_RE.test(line) && state !== "none") {
        state = "untrusted";
        movedAt = i + 1;
      }
      if (USES_INFISICAL.test(line) || USES_SUPABASE.test(line)) {
        calls.push({ line: i + 1, state, movedAt });
      }
    });
    return calls;
  }

  it("every job calling a local action runs it from the trusted workspace", () => {
    let seen = 0;
    for (const { name, text } of workflows) {
      for (const call of localActionCalls(text)) {
        seen += 1;
        assert.notEqual(
          call.state,
          "none",
          `${name}:${call.line} calls a local composite action with no actions/checkout ` +
            `earlier in the same job — the action file will not be on disk`,
        );
        assert.equal(
          call.state,
          "trusted",
          `${name}:${call.line} calls a local composite action after the workspace was ` +
            `moved to another commit at line ${call.movedAt} — it would load the action from that ` +
            `tree, not the trusted ref. Call it before the move, or after the move back ` +
            `(\`git checkout --force --detach "$TRUSTED_SHA"\` with TRUSTED_SHA: \${{ github.sha }}).`,
        );
      }
    }
    assert.ok(seen >= 14, `expected every Infisical and Supabase call site, saw ${seen}`);
  });

  // The guard's own teeth, on the one file whose trust changes mid-job.
  describe("fails on the moves that would break _deploy.yml's trust split", () => {
    const deploy = workflows.find((w) => w.name === "_deploy.yml").text;
    const verdicts = (text) => localActionCalls(text).map((c) => c.state);

    it("passes the file as it is", () => {
      assert.deepEqual(verdicts(deploy), ["trusted", "trusted", "trusted"]);
    });

    it("fails without the move to the trusted ref", () => {
      const mutated = deploy.replace(/^(\s*)git checkout --force --detach "\$TRUSTED_SHA"$/m, "$1true");
      assert.notEqual(mutated, deploy);
      assert.ok(verdicts(mutated).every((v) => v === "untrusted"));
    });

    it("fails when TRUSTED_SHA names the deployed commit instead", () => {
      const mutated = deploy.replace(/TRUSTED_SHA: \$\{\{ github\.sha \}\}/, "TRUSTED_SHA: ${{ inputs.sha }}");
      assert.notEqual(mutated, deploy);
      assert.ok(verdicts(mutated).every((v) => v === "untrusted"));
    });

    it("fails when the move is not forced", () => {
      const mutated = deploy.replace('git checkout --force --detach "$TRUSTED_SHA"', 'git checkout --detach "$TRUSTED_SHA"');
      assert.notEqual(mutated, deploy);
      assert.ok(verdicts(mutated).every((v) => v === "untrusted"));
    });

    it("fails when the move runs only on some runs", () => {
      const mutated = deploy.replace(
        /(- name: Move the workspace to the trusted ref\n)/,
        "$1        if: inputs.environment == 'production'\n",
      );
      assert.notEqual(mutated, deploy);
      assert.ok(verdicts(mutated).every((v) => v === "untrusted"));
    });

    it("reads a checkout's ref wherever it sits in the step", () => {
      const job = (checkout) =>
        ["jobs:", "  x:", "    runs-on: ubuntu-latest", "    steps:", ...checkout, "      - uses: ./.github/actions/supabase-cli"].join("\n");
      const refFirst = ["      - name: co", "        with:", "          ref: ${{ inputs.sha }}", "        uses: actions/checkout@v4"];
      const usesFirst = ["      - name: co", "        uses: actions/checkout@v4", "        with:", "          ref: ${{ inputs.sha }}"];
      assert.deepEqual(verdicts(job(refFirst)), ["untrusted"]);
      assert.deepEqual(verdicts(job(usesFirst)), ["untrusted"]);
      assert.deepEqual(verdicts(job(["      - uses: actions/checkout@v4"])), ["trusted"]);
    });

    it("fails on a local action after the detach to the deployed commit", () => {
      const mutated = deploy.replace(
        /(\n {6}- name: Plan the deploy\n)/,
        "\n      - name: Late\n        uses: ./.github/actions/supabase-cli\n$1",
      );
      assert.notEqual(mutated, deploy);
      assert.equal(verdicts(mutated).at(-1), "untrusted");
    });
  });
});

const PRESERVE_HELPER = join(ACTIONS, "infisical-secrets", "preserve-nonempty-env.sh");
const BACKUP_S3_NAMES =
  "BACKUP_S3_ENDPOINT,BACKUP_S3_BUCKET,BACKUP_S3_ACCESS_KEY_ID,BACKUP_S3_SECRET_ACCESS_KEY";

function runPreserve(cmd, env) {
  return spawnSync("bash", [PRESERVE_HELPER, cmd], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("preserve-nonempty on Infisical inject", () => {
  it("the helper script is executable and lives next to the action", () => {
    assert.ok(existsSync(PRESERVE_HELPER), "preserve-nonempty-env.sh must sit in the action directory");
    assert.match(
      infisicalAction,
      /bash "\$GITHUB_ACTION_PATH\/preserve-nonempty-env\.sh" snapshot/,
      "snapshot must run via GITHUB_ACTION_PATH so the action is self-contained",
    );
    assert.match(
      infisicalAction,
      /bash "\$GITHUB_ACTION_PATH\/preserve-nonempty-env\.sh" restore/,
      "restore must run via GITHUB_ACTION_PATH so the action is self-contained",
    );
  });

  it("snapshots before secrets-action and restores after", () => {
    const injectAt = infisicalAction.indexOf("uses: Infisical/secrets-action@");
    const snapAt = infisicalAction.indexOf("preserve-nonempty-env.sh\" snapshot");
    const restoreAt = infisicalAction.indexOf("preserve-nonempty-env.sh\" restore");
    assert.ok(injectAt > 0 && snapAt > 0 && restoreAt > 0, "all three steps must exist");
    assert.ok(snapAt < injectAt, "snapshot must run before the Infisical inject");
    assert.ok(restoreAt > injectAt, "restore must run after the Infisical inject");
  });

  it("only the two production backup prod injects pass the four BACKUP_S3_* names", () => {
    const sites = [];
    for (const { name, text } of workflows) {
      const lines = linesOf(text).map((l) => (/^\s*#/.test(l) ? "" : l));
      let job = null;
      lines.forEach((line, i) => {
        const m = line.match(JOB_KEY_RE);
        if (m && i > 3) job = m[1];
        if (!USES_INFISICAL.test(line)) return;
        const window = lines.slice(i, i + 12).join("\n");
        const preserve = window.match(/^\s+preserve-nonempty:\s*(.+)$/m)?.[1];
        if (preserve) sites.push([name, job, preserve.replaceAll('"', "").trim()]);
      });
    }
    assert.deepEqual(
      sites.sort(),
      [
        ["db-backup.yml", "backup-production", BACKUP_S3_NAMES],
        ["db-backup.yml", "backup-production-storage", BACKUP_S3_NAMES],
      ].sort(),
      "preserve-nonempty belongs only on the two production backup prod injects",
    );
  });

  it("restores a snapshotted value when the later inject left it empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "preserve-nonempty-"));
    const githubEnv = join(dir, "github.env");
    const snapshot = join(dir, "snap");
    const secret = "s3://not-a-real-bucket";
    try {
      const snap = runPreserve("snapshot", {
        PRESERVE_NONEMPTY: "BACKUP_S3_ENDPOINT",
        PRESERVE_SNAPSHOT_DIR: snapshot,
        BACKUP_S3_ENDPOINT: secret,
      });
      assert.equal(snap.status, 0, snap.stderr);
      assert.doesNotMatch(snap.stdout, /s3:\/\//, "snapshot must not print the secret");

      const restore = runPreserve("restore", {
        PRESERVE_NONEMPTY: "BACKUP_S3_ENDPOINT",
        PRESERVE_SNAPSHOT_DIR: snapshot,
        GITHUB_ENV: githubEnv,
        BACKUP_S3_ENDPOINT: "",
      });
      assert.equal(restore.status, 0, restore.stderr);
      assert.match(restore.stdout, /Restored BACKUP_S3_ENDPOINT/);
      assert.doesNotMatch(restore.stdout, /s3:\/\//, "restore must not print the secret");
      const written = readFileSync(githubEnv, "utf8");
      assert.match(written, /^BACKUP_S3_ENDPOINT<</m);
      assert.match(written, new RegExp(`^${secret.replace(/[/.]/g, "\\$&")}$`, "m"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not overwrite a non-empty value from this injection", () => {
    const dir = mkdtempSync(join(tmpdir(), "preserve-nonempty-"));
    const githubEnv = join(dir, "github.env");
    const snapshot = join(dir, "snap");
    try {
      const snap = runPreserve("snapshot", {
        PRESERVE_NONEMPTY: "BACKUP_S3_BUCKET",
        PRESERVE_SNAPSHOT_DIR: snapshot,
        BACKUP_S3_BUCKET: "staging-bucket",
      });
      assert.equal(snap.status, 0, snap.stderr);

      const restore = runPreserve("restore", {
        PRESERVE_NONEMPTY: "BACKUP_S3_BUCKET",
        PRESERVE_SNAPSHOT_DIR: snapshot,
        GITHUB_ENV: githubEnv,
        BACKUP_S3_BUCKET: "prod-bucket",
      });
      assert.equal(restore.status, 0, restore.stderr);
      assert.match(restore.stdout, /restored 0 of 1/);
      assert.equal(existsSync(githubEnv), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an unsafe env identifier", () => {
    const result = runPreserve("snapshot", {
      PRESERVE_NONEMPTY: "../etc/passwd",
      PRESERVE_SNAPSHOT_DIR: join(tmpdir(), "preserve-nonempty-unsafe"),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a safe env identifier/);
  });
});
