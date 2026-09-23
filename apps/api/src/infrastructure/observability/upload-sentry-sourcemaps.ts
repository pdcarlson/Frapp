import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readDeployedCommit } from './deployed-commit';

/**
 * API source-map upload (Render Docker builder, after `nest build`).
 *
 * Live `frapp-api` issues showed compiled `/app/apps/api/dist/*.js` frames
 * with ContextLines on-disk JS. That is not TypeScript symbolication: the
 * Node SDK reads the running `.js`, and nothing in the image build invoked
 * `sentry-cli`. Next.js apps upload from `withSentryConfig`; the API never
 * did.
 *
 * Same skip as web: no `SENTRY_AUTH_TOKEN` → inject/upload are skipped, the
 * build still succeeds. CI `api-docker-build` must not pass the token — that
 * job's image is discarded, and a second inject would mint debug IDs that
 * never run. Upload belongs on the Render build of the image that serves
 * traffic.
 *
 * Best effort when the token IS set, too (#2431): if `sentry-cli` cannot be
 * resolved or started, exits non-zero, is killed by a signal, or outlives its
 * time bound, this logs one `WARNING:` line naming the step, puts dist right
 * (restore after a failed inject, then strip), logs a second, plain line
 * saying what it did only once it is done, and returns `'failed'`; the build
 * still succeeds. Symbolicated stack traces are telemetry; they must not
 * gate shipping the API. Before this, a failing inject turned every
 * `frapp-api-staging` Render build red for days while staging kept serving
 * an old image. Two things stay hard failures, because each would ship a
 * wrong image: stripping `*.map` (the runner must never ship TypeScript, so
 * every path strips), and restoring dist after a failed inject (see
 * INJECT_SNAPSHOT_PREFIX). An error in either still exits 1.
 *
 * Do not `ENV` the token in the Dockerfile. ARG is enough for this RUN.
 */
export const API_SENTRY_ORG = 'frapp-live';
export const API_SENTRY_PROJECT = 'frapp-api';

/**
 * Wall-clock bound per `sentry-cli` step, so a hung CLI cannot hold the
 * Render build open. On expiry the child is SIGKILLed and the step reports
 * `ETIMEDOUT`, which is a best-effort failure like any other.
 *
 * Inject only rewrites files already on local disk (a few hundred `*.js` /
 * `*.map` pairs, seconds of work), so two minutes is wide headroom that still
 * catches a wedged process. Upload is the network step: a few MB of maps
 * through Sentry's chunked upload, where a stalled connection is the likely
 * hang. Ten minutes allows a slow link several times over without letting
 * one failed telemetry call dominate a build.
 */
export const SENTRY_CLI_INJECT_TIMEOUT_MS = 2 * 60 * 1000;
export const SENTRY_CLI_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Name prefix of the copy of `distDir` taken just before inject, as a fresh
 * sibling of it (`/app/apps/api/.sentry-inject-snapshot-XXXXXX` in the image).
 *
 * `sentry-cli sourcemaps inject` rewrites every `*.js` and `*.js.map` in
 * place: strace of 3.8.0 shows `open(O_WRONLY|O_CREAT|O_TRUNC)` and then a
 * write on each one, with no temp file and rename. A step killed at its time
 * bound or by the OOM killer, or one that hits ENOSPC mid-write, can leave a
 * module empty or cut short, and the best-effort path would ship it. So on
 * any inject failure dist is restored from this snapshot before stripping,
 * and a failed restore fails the build. Upload needs no snapshot: strace
 * shows it opens dist files read-only and writes only a bundle under the
 * system temp dir.
 *
 * A sibling, never inside `distDir`: inject would rewrite a snapshot there,
 * and the runner stage copies `apps/api/dist/` wholesale. From `apps/api/`
 * the runner copies only `dist/` and `package.json` (the Docker wiring test
 * pins that), so even a snapshot whose removal failed cannot ship. Removal
 * is still attempted on every path; a failure logs a NOTE, not a WARNING.
 */
export const INJECT_SNAPSHOT_PREFIX = '.sentry-inject-snapshot-';

export type SentryCliStep = 'inject' | 'upload';

export type CliResult = {
  status: number | null;
  /** Set when the child was killed by a signal (then `status` is null). */
  signal?: NodeJS.Signals | null;
  /**
   * Set when the child never ran (ENOENT, EACCES) or was stopped by
   * spawnSync itself (ETIMEDOUT, ENOBUFS; then `signal` is set too).
   */
  error?: { code?: string; message: string };
  stdout: string;
  stderr: string;
};

export type SentryCliRunner = (
  args: string[],
  options: { timeoutMs: number },
) => CliResult;

export type SourcemapUploadOutcome = 'skipped' | 'uploaded' | 'failed';

export type SourcemapUploadPlan =
  | { kind: 'skip'; reason: 'missing-auth-token'; distDir: string }
  | {
      kind: 'upload';
      org: typeof API_SENTRY_ORG;
      project: typeof API_SENTRY_PROJECT;
      release: string | undefined;
      distDir: string;
      injectArgs: string[];
      uploadArgs: string[];
    };

export function planSentrySourcemapUpload(options: {
  env?: NodeJS.Dict<string | undefined>;
  distDir: string;
}): SourcemapUploadPlan {
  const env = options.env ?? process.env;
  const distDir = options.distDir;
  if (!env.SENTRY_AUTH_TOKEN) {
    return { kind: 'skip', reason: 'missing-auth-token', distDir };
  }
  const release = readDeployedCommit(env);
  const injectArgs = ['sourcemaps', 'inject', distDir];
  const uploadArgs = [
    'sourcemaps',
    'upload',
    distDir,
    '--org',
    API_SENTRY_ORG,
    '--project',
    API_SENTRY_PROJECT,
  ];
  if (release) {
    uploadArgs.push('--release', release);
  }
  return {
    kind: 'upload',
    org: API_SENTRY_ORG,
    project: API_SENTRY_PROJECT,
    release,
    distDir,
    injectArgs,
    uploadArgs,
  };
}

/**
 * The entry module of the `@sentry/cli` that `apps/api/package.json`
 * declares, found by Node resolution from this module's directory, never
 * from `process.cwd()`.
 *
 * Hoisting decides where the package lands, and the API's copy is NOT at the
 * root: the lockfile nests it at `apps/api/node_modules/@sentry/cli` because
 * Sentry's bundler plugins (via `@sentry/nextjs`, `@sentry/react-native`)
 * claim the root slot for an older major, and the Docker deps stage
 * (`npm ci --workspace=apps/api ...`) does not install that root copy at all.
 * The old fixed path `/app/node_modules/.bin/sentry-cli` therefore did not
 * exist in the image, and spawnSync failed with ENOENT, which surfaced as
 * `inject failed (null):` (#2431).
 */
export function resolveSentryCliModule(
  resolveFrom: string = __dirname,
): string {
  return require.resolve('@sentry/cli', { paths: [resolveFrom] });
}

type SentryCliModule = { SentryCli?: { getPath?: unknown } };

/**
 * The platform's native `sentry-cli` executable, located by the package's own
 * `SentryCli.getPath()` (optional-dependency binary, its download fallback,
 * or `SENTRY_BINARY_PATH`).
 *
 * Not the package's `bin/sentry-cli`, a Node wrapper that spawns this binary
 * as its own child, for two reasons:
 * - It relays the child's exit with `process.exit(code)`, and `code` is null
 *   when the child dies by a signal, so a native CLI killed by the OOM killer
 *   or a segfault comes back as exit 0 and a failed step reads as success.
 * - spawnSync's timeout or ENOBUFS kill (SIGKILL) would reach only the
 *   wrapper, which dies without passing it on. The step then does report
 *   SIGKILL, but the native process is orphaned and keeps running: an inject
 *   would go on rewriting dist while it is restored from its snapshot, and
 *   could leave the restored dist cut short after all.
 * Spawning the native binary directly puts the kill on the process doing the
 * writing.
 */
export function sentryCliBin(resolveFrom: string = __dirname): string {
  const entry = resolveSentryCliModule(resolveFrom);
  const cli = (createRequire(__filename)(entry) as SentryCliModule | null)
    ?.SentryCli;
  const getPath = cli?.getPath;
  if (typeof getPath !== 'function') {
    throw new Error(
      `${entry} does not export SentryCli.getPath(); the @sentry/cli API changed`,
    );
  }
  const bin: unknown = getPath.call(cli);
  if (typeof bin !== 'string' || bin === '') {
    throw new Error(`${entry} SentryCli.getPath() returned no path`);
  }
  return bin;
}

export function stripSourceMapFiles(distDir: string): string[] {
  const removed: string[] = [];
  walkAndStrip(distDir, removed);
  return removed;
}

/**
 * Puts `distDir` back exactly as `snapshotDir` holds it: everything in
 * `distDir` is removed, then the snapshot is copied in. Throws on any error,
 * which the caller must treat as fatal, because a half-restored dist must
 * not ship.
 */
export function restoreDistFromSnapshot(
  snapshotDir: string,
  distDir: string,
): void {
  try {
    for (const entry of readdirSync(distDir)) {
      rmSync(join(distDir, entry), { recursive: true, force: true });
    }
    cpSync(snapshotDir, distDir, { recursive: true, preserveTimestamps: true });
  } catch (error) {
    throw new Error(
      `restoring ${distDir} from its pre-inject snapshot ${snapshotDir} failed: ` +
        describeError(error, []),
    );
  }
}

function walkAndStrip(dir: string, removed: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAndStrip(path, removed);
      continue;
    }
    if (entry.name.endsWith('.map')) {
      unlinkSync(path);
      removed.push(path);
    }
  }
}

// Duck-typed, not `instanceof Error`: spawnSync's error comes from Node's own
// realm, which fails `instanceof` inside a vm context such as Jest's.
function toCliError(error: unknown): { code?: string; message: string } {
  if (typeof error !== 'object' || error === null) {
    return { message: String(error) };
  }
  const { code, message } = error as { code?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : 'unknown error';
  return typeof code === 'string' ? { code, message: text } : { message: text };
}

export function defaultRunSentryCli(
  args: string[],
  options: { timeoutMs: number; cwd?: string },
): CliResult {
  // Inject prints a line per modified file; the default 1 MiB buffer would
  // kill the child with ENOBUFS on a large dist. SIGKILL on timeout, because
  // spawnSync waits for the child to exit and a CLI stuck in a network call
  // may not act on SIGTERM.
  const result = spawnSync(sentryCliBin(), args, {
    encoding: 'utf8',
    cwd: options.cwd ?? process.cwd(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs,
    killSignal: 'SIGKILL',
  });
  return {
    status: result.status,
    signal: result.signal,
    ...(result.error ? { error: toCliError(result.error) } : {}),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Exit 0 alone is not success: a spawn error or a signal overrides it. */
export function cliSucceeded(result: CliResult): boolean {
  return result.status === 0 && !result.signal && !result.error;
}

// The value as stored and its trimmed form (a pasted secret often carries a
// trailing newline the CLI would not echo), longest first so the trimmed form
// never splits the full one. Whitespace-only values are not secrets.
function secretVariants(secret: string | undefined): string[] {
  if (!secret) return [];
  const variants = new Set([secret, secret.trim()]);
  return [...variants]
    .filter((variant) => variant.trim() !== '')
    .sort((a, b) => b.length - a.length);
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce(
    (out, secret) => out.split(secret).join('[redacted]'),
    text,
  );
}

// Redact the raw text first (a secret containing whitespace would no longer
// match once flattened), again after flattening, and only then truncate, so
// a cut can never leave half a secret behind.
function cleanLine(text: string, secrets: string[], limit = 2000): string {
  const flat = redact(
    redact(text, secrets).replace(/\s+/g, ' ').trim(),
    secrets,
  );
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** A thrown error on one line, led by its code unless the message is. */
function describeError(error: unknown, secrets: string[]): string {
  const { code, message } = toCliError(error);
  const text = cleanLine(message, secrets) || '(no message)';
  return code && !text.startsWith(code) ? `${code}: ${text}` : text;
}

/** One line: step, exit status, signal, spawn error, then CLI output. */
export function describeCliFailure(
  step: SentryCliStep,
  result: CliResult,
  secret?: string,
): string {
  const secrets = secretVariants(secret);
  const error = result.error
    ? `${result.error.code ?? 'error'}: ${cleanLine(result.error.message, secrets) || '(no message)'}`
    : 'none';
  const output =
    cleanLine(result.stderr, secrets) ||
    cleanLine(result.stdout, secrets) ||
    '(no output)';
  return (
    `sentry-cli sourcemaps ${step} failed ` +
    `(status=${String(result.status)} signal=${result.signal ?? 'none'} error=${error}): ` +
    output
  );
}

export type SourcemapUploadOptions = {
  env?: NodeJS.Dict<string | undefined>;
  distDir: string;
  cwd?: string;
  runCli?: SentryCliRunner;
  timeoutsMs?: Record<SentryCliStep, number>;
  log?: (message: string) => void;
};

function stderrLog(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function runSentrySourcemapUpload(
  options: SourcemapUploadOptions,
): SourcemapUploadOutcome {
  const env = options.env ?? process.env;
  const log = options.log ?? stderrLog;
  const plan = planSentrySourcemapUpload({ env, distDir: options.distDir });
  if (plan.kind === 'skip') {
    log('SENTRY_AUTH_TOKEN unset; skipping frapp-api source-map inject/upload');
    stripSourceMapFiles(plan.distDir);
    return 'skipped';
  }

  const timeoutsMs = options.timeoutsMs ?? {
    inject: SENTRY_CLI_INJECT_TIMEOUT_MS,
    upload: SENTRY_CLI_UPLOAD_TIMEOUT_MS,
  };
  const runCli: SentryCliRunner =
    options.runCli ??
    ((args, { timeoutMs }) =>
      defaultRunSentryCli(args, { timeoutMs, cwd: options.cwd }));
  const run = (step: SentryCliStep, args: string[]): CliResult => {
    try {
      return runCli(args, { timeoutMs: timeoutsMs[step] });
    } catch (error) {
      // e.g. `@sentry/cli` or its platform binary not installed:
      // sentryCliBin() throws.
      return { status: null, error: toCliError(error), stdout: '', stderr: '' };
    }
  };
  const secrets = secretVariants(env.SENTRY_AUTH_TOKEN);
  // Best effort (see the module comment): report, clean up dist, succeed. A
  // failed upload after a good inject leaves debug IDs in the shipped JS with
  // no maps behind them, which symbolicates no worse than no inject at all.
  //
  // The WARNING states only the failure and goes out first, so a restore or
  // strip that then throws still leaves the cause in the build log. What was
  // done to dist is logged only after it is done.
  // The WARNING claims only what is known when it is written: the step
  // failed, so the upload is not confirmed (a step stopped mid-upload may
  // have sent part of it). Whether the build continues, and the cache advice
  // that only a continuing build needs, go on the cleanup line after it.
  const warn = (what: string) =>
    log(
      `WARNING: ${what}; frapp-api source-map upload not confirmed ` +
        `(best effort, #2431)`,
    );
  const stripAndContinue = (done: string[] = []): 'failed' => {
    stripSourceMapFiles(plan.distDir);
    log(
      `${[...done, 'stripped *.map'].join(', ')}; build continues ` +
        `(clear the Docker build cache to retry the upload)`,
    );
    return 'failed';
  };
  const giveUp = (what: string) => {
    warn(what);
    return stripAndContinue();
  };

  // Inject under a snapshot of dist (see INJECT_SNAPSHOT_PREFIX).
  let snapshotDir: string | undefined;
  try {
    try {
      snapshotDir = mkdtempSync(
        join(dirname(resolve(plan.distDir)), INJECT_SNAPSHOT_PREFIX),
      );
      cpSync(plan.distDir, snapshotDir, {
        recursive: true,
        preserveTimestamps: true,
      });
    } catch (error) {
      // Nothing has touched dist yet, so skipping inject keeps it pristine.
      return giveUp(
        `could not snapshot ${plan.distDir} before sentry-cli sourcemaps inject, ` +
          `so inject did not run (${describeError(error, secrets)})`,
      );
    }
    const injected = run('inject', plan.injectArgs);
    // Restore on ANY failure, never only on some of its shapes: a step
    // stopped at its time bound (ETIMEDOUT) or for overflowing its output
    // buffer (ENOBUFS) carries both `error` and `signal`, and was killed
    // wherever it was, possibly mid-write.
    if (!cliSucceeded(injected)) {
      warn(describeCliFailure('inject', injected, env.SENTRY_AUTH_TOKEN));
      restoreDistFromSnapshot(snapshotDir, plan.distDir);
      return stripAndContinue([
        `restored ${plan.distDir} from its pre-inject snapshot`,
      ]);
    }
  } finally {
    if (snapshotDir) discardSnapshot(snapshotDir, log);
  }

  const uploaded = run('upload', plan.uploadArgs);
  if (!cliSucceeded(uploaded)) {
    return giveUp(
      describeCliFailure('upload', uploaded, env.SENTRY_AUTH_TOKEN),
    );
  }
  stripSourceMapFiles(plan.distDir);
  log(
    `uploaded API source maps to ${plan.org}/${plan.project}` +
      (plan.release ? ` release ${plan.release}` : ' (no RENDER_GIT_COMMIT)'),
  );
  return 'uploaded';
}

// Not fatal: the snapshot sits beside dist, and from apps/api/ the runner
// stage copies only dist/ and package.json, so a leftover cannot ship. Logged
// as NOTE, not WARNING: `WARNING:` lines mean a sentry-cli step failed, and a
// leftover snapshot is not that.
function discardSnapshot(
  snapshotDir: string,
  log: (message: string) => void,
): void {
  try {
    rmSync(snapshotDir, { recursive: true, force: true });
  } catch (error) {
    log(
      `NOTE: could not remove the pre-inject snapshot ${snapshotDir} ` +
        `(${describeError(error, [])}); it is outside dist, so it does not ship`,
    );
  }
}

/**
 * The Docker step's entry. Returns the exit code: 0 for every outcome,
 * including `'failed'`, and 1 only for an error that would ship a wrong
 * image (stripping `*.map`, or restoring dist after a failed inject), which
 * must fail the build.
 */
export function main(
  options: Omit<SourcemapUploadOptions, 'distDir'> & { distDir?: string } = {},
): number {
  const log = options.log ?? stderrLog;
  try {
    runSentrySourcemapUpload({
      ...options,
      distDir: options.distDir ?? join(__dirname, '../..'),
      log,
    });
    return 0;
  } catch (error) {
    const env = options.env ?? process.env;
    log(
      `ERROR: ${cleanLine(toCliError(error).message, secretVariants(env.SENTRY_AUTH_TOKEN))}; ` +
        `frapp-api source-map step failed where it must not ` +
        `(stripping *.map, or restoring dist after a failed inject), failing the build`,
    );
    return 1;
  }
}

function isDirectCli(): boolean {
  const entry = process.argv[1];
  return (
    typeof entry === 'string' &&
    /upload-sentry-sourcemaps\.[cm]?js$/.test(entry)
  );
}

if (isDirectCli()) {
  process.exitCode = main();
}
