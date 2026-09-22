import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  API_SENTRY_ORG,
  API_SENTRY_PROJECT,
  type CliResult,
  defaultRunSentryCli,
  describeCliFailure,
  planSentrySourcemapUpload,
  runSentrySourcemapUpload,
  sentryCliBin,
  stripSourceMapFiles,
} from './upload-sentry-sourcemaps';

function fixtureDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'frapp-api-maps-'));
  mkdirSync(join(dir, 'interface'));
  writeFileSync(join(dir, 'main.js'), 'console.log(1);\n');
  writeFileSync(join(dir, 'main.js.map'), '{"version":3}\n');
  writeFileSync(join(dir, 'interface', 'filter.js'), 'exports.x=1;\n');
  writeFileSync(join(dir, 'interface', 'filter.js.map'), '{"version":3}\n');
  return dir;
}

describe('planSentrySourcemapUpload', () => {
  const distDir = '/app/apps/api/dist';

  it('skips inject and upload when SENTRY_AUTH_TOKEN is unset', () => {
    const plan = planSentrySourcemapUpload({
      env: { RENDER_GIT_COMMIT: '0ca478e9105105ff7013834615eee81499813d0e' },
      distDir,
    });
    expect(plan).toEqual({
      kind: 'skip',
      reason: 'missing-auth-token',
      distDir,
    });
  });

  it('skips when the token is an empty string', () => {
    expect(
      planSentrySourcemapUpload({
        env: { SENTRY_AUTH_TOKEN: '', RENDER_GIT_COMMIT: '0ca478e' },
        distDir,
      }).kind,
    ).toBe('skip');
  });

  it('uploads to frapp-live/frapp-api with RENDER_GIT_COMMIT as release', () => {
    const plan = planSentrySourcemapUpload({
      env: {
        SENTRY_AUTH_TOKEN: 'sntrys_test',
        RENDER_GIT_COMMIT: 'd85d933302834b3376c9733a761819020d7b0939',
      },
      distDir,
    });
    expect(plan.kind).toBe('upload');
    if (plan.kind !== 'upload') return;
    expect(plan.org).toBe(API_SENTRY_ORG);
    expect(plan.project).toBe(API_SENTRY_PROJECT);
    expect(plan.org).toBe('frapp-live');
    expect(plan.project).toBe('frapp-api');
    expect(plan.release).toBe('d85d933302834b3376c9733a761819020d7b0939');
    expect(plan.injectArgs).toEqual(['sourcemaps', 'inject', distDir]);
    expect(plan.uploadArgs).toEqual([
      'sourcemaps',
      'upload',
      distDir,
      '--org',
      'frapp-live',
      '--project',
      'frapp-api',
      '--release',
      'd85d933302834b3376c9733a761819020d7b0939',
    ]);
  });

  it('uploads without --release when RENDER_GIT_COMMIT is not a SHA', () => {
    const plan = planSentrySourcemapUpload({
      env: { SENTRY_AUTH_TOKEN: 'sntrys_test', RENDER_GIT_COMMIT: 'not-a-sha' },
      distDir,
    });
    expect(plan.kind).toBe('upload');
    if (plan.kind !== 'upload') return;
    expect(plan.release).toBeUndefined();
    expect(plan.uploadArgs).not.toContain('--release');
  });
});

describe('runSentrySourcemapUpload', () => {
  it('does not invoke sentry-cli when the token is unset and still strips maps', () => {
    const distDir = fixtureDist();
    const runCli = jest.fn();
    const log = jest.fn();
    expect(
      runSentrySourcemapUpload({
        env: {},
        distDir,
        runCli,
        log,
      }),
    ).toBe('skipped');
    expect(runCli).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'SENTRY_AUTH_TOKEN unset; skipping frapp-api source-map inject/upload',
    );
    expect(stripSourceMapFiles(distDir)).toEqual([]);
  });

  it('injects then uploads and strips maps on success', () => {
    const distDir = fixtureDist();
    const calls: string[][] = [];
    const log = jest.fn();
    expect(
      runSentrySourcemapUpload({
        env: {
          SENTRY_AUTH_TOKEN: 'sntrys_test',
          RENDER_GIT_COMMIT: '0ca478e9105105ff7013834615eee81499813d0e',
        },
        distDir,
        runCli: (args) => {
          calls.push(args);
          return { status: 0, stdout: 'ok', stderr: '' };
        },
        log,
      }),
    ).toBe('uploaded');
    expect(calls[0]).toEqual(['sourcemaps', 'inject', distDir]);
    expect(calls[1]?.slice(0, 6)).toEqual([
      'sourcemaps',
      'upload',
      distDir,
      '--org',
      'frapp-live',
      '--project',
    ]);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      'uploaded API source maps to frapp-live/frapp-api release 0ca478e9105105ff7013834615eee81499813d0e',
    );
  });
});

describe('runSentrySourcemapUpload when sentry-cli fails (best effort, #2431)', () => {
  const token = 'sntrys_test_secret_value';
  // What spawnSync returned on Render: the binary path did not exist.
  const enoent: CliResult = {
    status: null,
    signal: null,
    error: {
      code: 'ENOENT',
      message: 'spawnSync /app/node_modules/.bin/sentry-cli ENOENT',
    },
    stdout: '',
    stderr: '',
  };

  function run(runCli: (args: string[]) => CliResult) {
    const distDir = fixtureDist();
    const log = jest.fn<void, [string]>();
    const outcome = runSentrySourcemapUpload({
      env: { SENTRY_AUTH_TOKEN: token },
      distDir,
      runCli: jest.fn(runCli),
      log,
    });
    return { distDir, log, outcome, lines: log.mock.calls.map(([m]) => m) };
  }

  it('returns failed, warns with the spawn error, and strips maps when inject cannot spawn', () => {
    const calls: string[][] = [];
    const { distDir, lines, outcome } = run((args) => {
      calls.push(args);
      return enoent;
    });
    expect(outcome).toBe('failed');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toBe('inject');
    expect(lines).toEqual([
      'WARNING: sentry-cli sourcemaps inject failed (status=null signal=none ' +
        'error=ENOENT: spawnSync /app/node_modules/.bin/sentry-cli ENOENT): ' +
        '(no output); frapp-api source maps NOT uploaded, *.map stripped, ' +
        'build continues (best effort, #2431)',
    ]);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
    expect(existsSync(join(distDir, 'main.js'))).toBe(true);
  });

  it('returns failed, names upload, and strips maps when upload exits non-zero', () => {
    const { distDir, lines, outcome } = run((args) =>
      args[1] === 'inject'
        ? { status: 0, stdout: 'injected', stderr: '' }
        : {
            status: 1,
            stdout: '',
            stderr: 'error: API request failed\n  caused by: 401 Unauthorized',
          },
    );
    expect(outcome).toBe('failed');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^WARNING: sentry-cli sourcemaps upload failed \(status=1 signal=none error=none\): error: API request failed caused by: 401 Unauthorized; /,
    );
    expect(stripSourceMapFiles(distDir)).toEqual([]);
  });

  it('reports the signal when sentry-cli is killed', () => {
    const { lines, outcome } = run(() => ({
      status: null,
      signal: 'SIGKILL',
      stdout: '',
      stderr: '',
    }));
    expect(outcome).toBe('failed');
    expect(lines[0]).toContain('inject failed (status=null signal=SIGKILL');
  });

  it('treats a runner that throws (no @sentry/cli installed) as a failed step', () => {
    const { distDir, lines, outcome } = run(() => {
      throw Object.assign(
        new Error("Cannot find module '@sentry/cli/package.json'"),
        { code: 'MODULE_NOT_FOUND' },
      );
    });
    expect(outcome).toBe('failed');
    expect(lines[0]).toContain(
      "error=MODULE_NOT_FOUND: Cannot find module '@sentry/cli/package.json'",
    );
    expect(stripSourceMapFiles(distDir)).toEqual([]);
  });

  it('never prints the auth token even if sentry-cli echoes it', () => {
    const { lines } = run(() => ({
      status: 1,
      stdout: '',
      stderr: `bad token ${token}`,
    }));
    expect(lines[0]).not.toContain(token);
    expect(lines[0]).toContain('bad token [redacted]');
  });
});

describe('describeCliFailure', () => {
  it('keeps multi-line CLI output on one line and falls back to stdout', () => {
    expect(
      describeCliFailure('upload', {
        status: 2,
        stdout: 'line one\n\nline two\n',
        stderr: '',
      }),
    ).toBe(
      'sentry-cli sourcemaps upload failed (status=2 signal=none error=none): line one line two',
    );
  });
});

describe('sentryCliBin', () => {
  it('resolves the @sentry/cli version apps/api declares, not a hoisted copy', () => {
    const declared = (
      JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
        devDependencies: Record<string, string>;
      }
    ).devDependencies['@sentry/cli'];
    const bin = sentryCliBin();
    expect(bin).toMatch(/[\\/]@sentry[\\/]cli[\\/]bin[\\/]sentry-cli$/);
    const resolved = (
      JSON.parse(
        readFileSync(join(dirname(dirname(bin)), 'package.json'), 'utf8'),
      ) as { version: string }
    ).version;
    expect(resolved).toBe(declared);
  });

  it('finds the copy nested under apps/api when the root has none (Docker deps stage)', () => {
    // `npm ci --workspace=apps/api ...` installs only apps/api's nested copy;
    // the root node_modules has no @sentry/cli at all.
    const root = mkdtempSync(join(tmpdir(), 'frapp-api-cli-'));
    const pkgDir = join(root, 'apps/api/node_modules/@sentry/cli');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      '{"name":"@sentry/cli","version":"0.0.0"}\n',
    );
    const scriptDir = join(root, 'apps/api/dist/infrastructure/observability');
    mkdirSync(scriptDir, { recursive: true });
    expect(sentryCliBin(scriptDir)).toBe(join(pkgDir, 'bin', 'sentry-cli'));
  });
});

describe('defaultRunSentryCli', () => {
  it('reaches a working sentry-cli through the resolved package', () => {
    const result = defaultRunSentryCli(['--version']);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^sentry-cli \d+\.\d+\.\d+/);
  });

  it('surfaces a spawn error instead of a bare null status', () => {
    const result = defaultRunSentryCli(
      ['--version'],
      join(tmpdir(), 'frapp-api-no-such-dir', String(process.pid)),
    );
    expect(result.status).toBeNull();
    expect(result.error?.code).toBe('ENOENT');
    expect(describeCliFailure('inject', result)).toMatch(
      /^sentry-cli sourcemaps inject failed \(status=null signal=none error=ENOENT: /,
    );
  });
});

describe('API Docker / CI wiring', () => {
  const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
  const ci = readFileSync(
    join(process.cwd(), '../../.github/workflows/ci.yml'),
    'utf8',
  );

  it('invokes the upload entry after nest build and does not ENV the token', () => {
    expect(dockerfile).toContain(
      'node apps/api/dist/infrastructure/observability/upload-sentry-sourcemaps.js',
    );
    expect(dockerfile).toMatch(/ARG SENTRY_AUTH_TOKEN/);
    expect(dockerfile).toMatch(/ARG RENDER_GIT_COMMIT/);
    expect(dockerfile).toContain('gcompat');
    expect(dockerfile).not.toMatch(/ENV SENTRY_AUTH_TOKEN/);
    // Best effort is decided in the script (#2431), not by swallowing the
    // step's exit code, which would also hide a failure to strip `*.map`.
    expect(dockerfile).not.toMatch(/upload-sentry-sourcemaps\.js\s*(\|\||;)/);
    const buildIndex = dockerfile.indexOf(
      'RUN npm run build --workspace=apps/api',
    );
    const uploadIndex = dockerfile.indexOf('upload-sentry-sourcemaps.js');
    expect(buildIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(buildIndex);
  });

  it('does not pass SENTRY_AUTH_TOKEN into api-docker-build (discarded image)', () => {
    const dockerJob = ci.slice(ci.indexOf('api-docker-build:'));
    const nextJob = dockerJob.search(/\n {2}[a-z].*:/);
    const job = nextJob === -1 ? dockerJob : dockerJob.slice(0, nextJob);
    expect(job).toContain('docker/build-push-action');
    expect(job).not.toContain('SENTRY_AUTH_TOKEN');
  });

  it('emits self-contained maps and depends on sentry-cli in the builder tree', () => {
    const tsconfig = readFileSync(join(process.cwd(), 'tsconfig.json'), 'utf8');
    const tsconfigBuild = readFileSync(
      join(process.cwd(), 'tsconfig.build.json'),
      'utf8',
    );
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { devDependencies?: Record<string, string> };
    expect(tsconfig).toMatch(/"sourceMap"\s*:\s*true/);
    expect(tsconfigBuild).toMatch(/"inlineSources"\s*:\s*true/);
    expect(pkg.devDependencies?.['@sentry/cli']).toBeDefined();
  });
});
