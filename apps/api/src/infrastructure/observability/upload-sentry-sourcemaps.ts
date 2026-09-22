import { spawnSync } from 'node:child_process';
import { readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
 * Best effort when the token IS set, too (#2431): if `sentry-cli` cannot run
 * or exits non-zero, this logs one `WARNING:` line naming the step and
 * returns `'failed'`, and the build still succeeds. Symbolicated stack
 * traces are telemetry; they must not gate shipping the API. Before this, a
 * failing inject turned every Render build red for days while staging and
 * production kept serving an old image. What stays a hard failure is
 * stripping `*.map`: the runner must never ship TypeScript, so every path
 * strips, and an error while stripping still exits 1.
 *
 * Do not `ENV` the token in the Dockerfile. ARG is enough for this RUN.
 */
export const API_SENTRY_ORG = 'frapp-live';
export const API_SENTRY_PROJECT = 'frapp-api';

export type CliResult = {
  status: number | null;
  /** Set when the child was killed by a signal (then `status` is null). */
  signal?: NodeJS.Signals | null;
  /**
   * Set when the child never ran (ENOENT, EACCES, missing interpreter) or
   * was stopped by spawnSync itself (ETIMEDOUT, ENOBUFS). `status` is null.
   */
  error?: { code?: string; message: string };
  stdout: string;
  stderr: string;
};

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
 * The `@sentry/cli` that `apps/api/package.json` declares, found by Node
 * resolution from this module rather than at a fixed `<cwd>/node_modules`.
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
export function sentryCliBin(resolveFrom: string = __dirname): string {
  const manifest = require.resolve('@sentry/cli/package.json', {
    paths: [resolveFrom],
  });
  return join(dirname(manifest), 'bin', 'sentry-cli');
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
  cwd = process.cwd(),
): CliResult {
  // Run the package's JS entry under this node, not via its shebang, so the
  // spawn needs neither `node` on PATH nor an exec bit on the file. Inject
  // prints a line per modified file; the default 1 MiB buffer would kill the
  // child with ENOBUFS on a large dist.
  const result = spawnSync(process.execPath, [sentryCliBin(), ...args], {
    encoding: 'utf8',
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    signal: result.signal,
    ...(result.error ? { error: toCliError(result.error) } : {}),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function oneLine(text: string, limit = 2000): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** One line: step, exit status, signal, spawn error, then CLI output. */
export function describeCliFailure(
  step: 'inject' | 'upload',
  result: CliResult,
): string {
  const error = result.error
    ? `${result.error.code ?? 'error'}: ${result.error.message}`
    : 'none';
  const output = oneLine(result.stderr || result.stdout) || '(no output)';
  return (
    `sentry-cli sourcemaps ${step} failed ` +
    `(status=${String(result.status)} signal=${result.signal ?? 'none'} error=${error}): ` +
    output
  );
}

function redact(text: string, secret: string | undefined): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}

export function runSentrySourcemapUpload(options: {
  env?: NodeJS.Dict<string | undefined>;
  distDir: string;
  cwd?: string;
  runCli?: (args: string[]) => CliResult;
  log?: (message: string) => void;
}): SourcemapUploadOutcome {
  const env = options.env ?? process.env;
  const log =
    options.log ?? ((message) => process.stderr.write(`${message}\n`));
  const plan = planSentrySourcemapUpload({ env, distDir: options.distDir });
  if (plan.kind === 'skip') {
    log('SENTRY_AUTH_TOKEN unset; skipping frapp-api source-map inject/upload');
    stripSourceMapFiles(plan.distDir);
    return 'skipped';
  }

  const runCli =
    options.runCli ?? ((args) => defaultRunSentryCli(args, options.cwd));
  const run = (args: string[]): CliResult => {
    try {
      return runCli(args);
    } catch (error) {
      // e.g. `@sentry/cli` not installed at all: sentryCliBin() throws.
      return { status: null, error: toCliError(error), stdout: '', stderr: '' };
    }
  };
  // Best effort (see the module comment): report, strip, succeed. A failed
  // upload after a good inject leaves debug IDs in the shipped JS with no
  // maps behind them, which symbolicates no worse than no inject at all.
  const giveUp = (step: 'inject' | 'upload', result: CliResult) => {
    log(
      `WARNING: ${redact(describeCliFailure(step, result), env.SENTRY_AUTH_TOKEN)}; ` +
        `frapp-api source maps NOT uploaded, *.map stripped, build continues (best effort, #2431)`,
    );
    stripSourceMapFiles(plan.distDir);
    return 'failed' as const;
  };

  const injected = run(plan.injectArgs);
  if (injected.status !== 0) {
    return giveUp('inject', injected);
  }
  const uploaded = run(plan.uploadArgs);
  if (uploaded.status !== 0) {
    return giveUp('upload', uploaded);
  }
  stripSourceMapFiles(plan.distDir);
  log(
    `uploaded API source maps to ${plan.org}/${plan.project}` +
      (plan.release ? ` release ${plan.release}` : ' (no RENDER_GIT_COMMIT)'),
  );
  return 'uploaded';
}

function isDirectCli(): boolean {
  const entry = process.argv[1];
  return (
    typeof entry === 'string' &&
    /upload-sentry-sourcemaps\.[cm]?js$/.test(entry)
  );
}

if (isDirectCli()) {
  try {
    // 'failed' exits 0 on purpose; only an unexpected error (e.g. stripping
    // `*.map` itself failing) reaches the catch and fails the build.
    runSentrySourcemapUpload({ distDir: join(__dirname, '../..') });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
