import { spawnSync } from 'node:child_process';
import { readdirSync, unlinkSync } from 'node:fs';
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
 * Do not `ENV` the token in the Dockerfile. ARG is enough for this RUN.
 */
export const API_SENTRY_ORG = 'frapp-live';
export const API_SENTRY_PROJECT = 'frapp-api';

export type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

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

export function sentryCliBin(cwd = process.cwd()): string {
  return join(cwd, 'node_modules', '.bin', 'sentry-cli');
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

export function defaultRunSentryCli(
  args: string[],
  cwd = process.cwd(),
): CliResult {
  const result = spawnSync(sentryCliBin(cwd), args, {
    encoding: 'utf8',
    cwd,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function runSentrySourcemapUpload(options: {
  env?: NodeJS.Dict<string | undefined>;
  distDir: string;
  cwd?: string;
  runCli?: (args: string[]) => CliResult;
  log?: (message: string) => void;
}): 'skipped' | 'uploaded' {
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

  const injected = runCli(plan.injectArgs);
  if (injected.status !== 0) {
    throw new Error(
      `sentry-cli sourcemaps inject failed (${String(injected.status)}): ${injected.stderr || injected.stdout}`,
    );
  }
  const uploaded = runCli(plan.uploadArgs);
  if (uploaded.status !== 0) {
    throw new Error(
      `sentry-cli sourcemaps upload failed (${String(uploaded.status)}): ${uploaded.stderr || uploaded.stdout}`,
    );
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
    runSentrySourcemapUpload({ distDir: join(__dirname, '../..') });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
