import { spawnSync } from 'node:child_process';
import { readdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
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
 * Best effort when the token IS set, too (#2431): if `sentry-cli` cannot run,
 * exits non-zero, is killed by a signal, or outlives its time bound, this
 * logs one `WARNING:` line naming the step and returns `'failed'`, and the
 * build still succeeds. Symbolicated stack traces are telemetry; they must
 * not gate shipping the API. Before this, a failing inject turned every
 * Render build red for days while staging and production kept serving an old
 * image. What stays a hard failure is stripping `*.map`: the runner must
 * never ship TypeScript, so every path strips, and an error while stripping
 * still exits 1.
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
 * Not the package's `bin/sentry-cli`: that is a JS wrapper that relays the
 * native child's exit with `process.exit(code)` and forwards SIGTERM, so a
 * native process killed by a signal (OOM, segfault, or spawnSync's own
 * timeout/ENOBUFS kill) comes back as exit 0, and a failed upload would be
 * logged as uploaded.
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
  // Best effort (see the module comment): report, strip, succeed. A failed
  // upload after a good inject leaves debug IDs in the shipped JS with no
  // maps behind them, which symbolicates no worse than no inject at all.
  const giveUp = (step: SentryCliStep, result: CliResult) => {
    log(
      `WARNING: ${describeCliFailure(step, result, env.SENTRY_AUTH_TOKEN)}; ` +
        `frapp-api source maps NOT uploaded, *.map stripped, build continues ` +
        `(best effort, #2431); clear the Docker build cache to retry`,
    );
    stripSourceMapFiles(plan.distDir);
    return 'failed' as const;
  };

  const injected = run('inject', plan.injectArgs);
  if (!cliSucceeded(injected)) {
    return giveUp('inject', injected);
  }
  const uploaded = run('upload', plan.uploadArgs);
  if (!cliSucceeded(uploaded)) {
    return giveUp('upload', uploaded);
  }
  stripSourceMapFiles(plan.distDir);
  log(
    `uploaded API source maps to ${plan.org}/${plan.project}` +
      (plan.release ? ` release ${plan.release}` : ' (no RENDER_GIT_COMMIT)'),
  );
  return 'uploaded';
}

/**
 * The Docker step's entry. Returns the exit code: 0 for every outcome,
 * including `'failed'`, and 1 only for an unexpected error, such as stripping
 * `*.map` itself failing, which must fail the build.
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
        `frapp-api source-map step failed where it must not (stripping *.map), failing the build`,
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
