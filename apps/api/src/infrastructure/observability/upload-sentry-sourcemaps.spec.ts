import { spawnSync } from 'node:child_process';
import fs, {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import ts from 'typescript';
import {
  API_SENTRY_ORG,
  API_SENTRY_PROJECT,
  type CliResult,
  cliSucceeded,
  defaultRunSentryCli,
  describeCliFailure,
  INJECT_SNAPSHOT_PREFIX,
  main,
  planSentrySourcemapUpload,
  resolveSentryCliModule,
  runSentrySourcemapUpload,
  SENTRY_CLI_INJECT_TIMEOUT_MS,
  SENTRY_CLI_UPLOAD_TIMEOUT_MS,
  sentryCliBin,
  stripSourceMapFiles,
} from './upload-sentry-sourcemaps';

const MAIN_JS = 'console.log(1);\n';
const FILTER_JS = 'exports.x=1;\n';

function writeFixtureDist(dir: string): string {
  mkdirSync(join(dir, 'interface'), { recursive: true });
  writeFileSync(join(dir, 'main.js'), MAIN_JS);
  writeFileSync(join(dir, 'main.js.map'), '{"version":3}\n');
  writeFileSync(join(dir, 'interface', 'filter.js'), FILTER_JS);
  writeFileSync(join(dir, 'interface', 'filter.js.map'), '{"version":3}\n');
  return dir;
}

/**
 * `<fresh dir>/dist`, so the pre-inject snapshot (a sibling of dist) is the
 * only other thing that can appear beside it.
 */
function fixtureDist(): string {
  return writeFixtureDist(
    join(mkdtempSync(join(tmpdir(), 'frapp-api-maps-')), 'dist'),
  );
}

/** What sits beside dist: `['dist']` once no snapshot is left behind. */
function siblingsOf(distDir: string): string[] {
  return readdirSync(dirname(distDir)).sort();
}

function snapshotsBeside(distDir: string): string[] {
  return siblingsOf(distDir).filter((name) =>
    name.startsWith(INJECT_SNAPSHOT_PREFIX),
  );
}

/** The `*.map` files in dist, relative and `/`-separated, without removing any. */
function mapFilesIn(distDir: string): string[] {
  return readdirSync(distDir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.map'))
    .map((name) => name.split(sep).join('/'))
    .sort();
}

const FIXTURE_MAPS = ['interface/filter.js.map', 'main.js.map'];

/** The plain line logged once dist has been cleaned up after a failure. */
function cleanedUp(distDir?: string): string {
  return (
    (distDir ? `restored ${distDir} from its pre-inject snapshot, ` : '') +
    'stripped *.map; build continues'
  );
}

function fsError(code: string, syscall: string, path: string): Error {
  return Object.assign(
    new Error(`${code}: simulated failure, ${syscall} '${path}'`),
    { code },
  );
}

/**
 * Makes `unlinkSync` fail for one path only. Tests may run as root, which
 * ignores file modes, so a chmod fixture would not fail there.
 */
function failUnlinkOf(target: string): jest.SpyInstance {
  const unlinkSync = fs.unlinkSync;
  return jest.spyOn(fs, 'unlinkSync').mockImplementation((path) => {
    if (path === target) throw fsError('EBUSY', 'unlink', target);
    unlinkSync(path);
  });
}

/** A dist path that does not exist, so stripping `*.map` throws ENOENT. */
function missingDist(): string {
  return join(tmpdir(), 'frapp-api-no-dist', `${process.pid}-${Date.now()}`);
}

function declaredCliVersion(): string {
  return (
    JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    }
  ).devDependencies['@sentry/cli'];
}

function versionOfModule(entry: string): string {
  // js/index.js -> package root
  return (
    JSON.parse(
      readFileSync(join(dirname(dirname(entry)), 'package.json'), 'utf8'),
    ) as { version: string }
  ).version;
}

const ok: CliResult = { status: 0, signal: null, stdout: 'ok', stderr: '' };

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

  it('injects then uploads, each under its own time bound, and strips maps on success', () => {
    const distDir = fixtureDist();
    const calls: Array<{ args: string[]; timeoutMs: number }> = [];
    const log = jest.fn();
    expect(
      runSentrySourcemapUpload({
        env: {
          SENTRY_AUTH_TOKEN: 'sntrys_test',
          RENDER_GIT_COMMIT: '0ca478e9105105ff7013834615eee81499813d0e',
        },
        distDir,
        runCli: (args, { timeoutMs }) => {
          calls.push({ args, timeoutMs });
          return ok;
        },
        log,
      }),
    ).toBe('uploaded');
    expect(calls[0]).toEqual({
      args: ['sourcemaps', 'inject', distDir],
      timeoutMs: SENTRY_CLI_INJECT_TIMEOUT_MS,
    });
    expect(calls[1]?.args.slice(0, 6)).toEqual([
      'sourcemaps',
      'upload',
      distDir,
      '--org',
      'frapp-live',
      '--project',
    ]);
    expect(calls[1]?.timeoutMs).toBe(SENTRY_CLI_UPLOAD_TIMEOUT_MS);
    expect(SENTRY_CLI_INJECT_TIMEOUT_MS).toBe(2 * 60 * 1000);
    expect(SENTRY_CLI_UPLOAD_TIMEOUT_MS).toBe(10 * 60 * 1000);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
    expect(siblingsOf(distDir)).toEqual(['dist']);
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

  function run(
    runCli: (args: string[]) => CliResult,
    env: NodeJS.Dict<string> = { SENTRY_AUTH_TOKEN: token },
  ) {
    const distDir = fixtureDist();
    const log = jest.fn<void, [string]>();
    const outcome = runSentrySourcemapUpload({
      env,
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
    // The WARNING states the failure; what was done about it is logged
    // after it happened, on a line of its own.
    expect(lines).toEqual([
      'WARNING: sentry-cli sourcemaps inject failed (status=null signal=none ' +
        'error=ENOENT: spawnSync /app/node_modules/.bin/sentry-cli ENOENT): ' +
        '(no output); frapp-api source maps NOT uploaded ' +
        '(best effort, #2431); clear the Docker build cache to retry',
      cleanedUp(distDir),
    ]);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
    expect(readFileSync(join(distDir, 'main.js'), 'utf8')).toBe(MAIN_JS);
    expect(siblingsOf(distDir)).toEqual(['dist']);
  });

  it('returns failed, names upload, and strips maps when upload exits non-zero', () => {
    const { distDir, lines, outcome } = run((args) =>
      args[1] === 'inject'
        ? ok
        : {
            status: 1,
            stdout: '',
            stderr: 'error: API request failed\n  caused by: 401 Unauthorized',
          },
    );
    expect(outcome).toBe('failed');
    expect(lines).toEqual([
      'WARNING: sentry-cli sourcemaps upload failed (status=1 signal=none error=none): ' +
        'error: API request failed caused by: 401 Unauthorized; ' +
        'frapp-api source maps NOT uploaded (best effort, #2431); ' +
        'clear the Docker build cache to retry',
      cleanedUp(),
    ]);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
    expect(siblingsOf(distDir)).toEqual(['dist']);
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

  it('does not take exit 0 as success when a signal or a spawn error is also present', () => {
    expect(cliSucceeded(ok)).toBe(true);
    expect(cliSucceeded({ ...ok, signal: 'SIGTERM' })).toBe(false);
    expect(
      cliSucceeded({
        ...ok,
        error: { code: 'ENOBUFS', message: 'spawnSync ENOBUFS' },
      }),
    ).toBe(false);
    const { lines, outcome } = run((args) =>
      args[1] === 'inject'
        ? ok
        : { ...ok, error: { code: 'ENOBUFS', message: 'spawnSync ENOBUFS' } },
    );
    expect(outcome).toBe('failed');
    expect(lines[0]).toContain(
      'upload failed (status=0 signal=none error=ENOBUFS: spawnSync ENOBUFS)',
    );
  });

  it('treats a runner that throws (no @sentry/cli installed) as a failed step', () => {
    const { distDir, lines, outcome } = run(() => {
      throw Object.assign(
        new Error("Cannot find module '@sentry/cli'\nRequire stack:\n- x.js"),
        { code: 'MODULE_NOT_FOUND' },
      );
    });
    expect(outcome).toBe('failed');
    expect(lines).toEqual([
      expect.stringMatching(/^WARNING: /),
      cleanedUp(distDir),
    ]);
    expect(lines[0]).not.toContain('\n');
    expect(lines[0]).toContain(
      "error=MODULE_NOT_FOUND: Cannot find module '@sentry/cli' Require stack: - x.js)",
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

  it('redacts before truncating, so a cut cannot leave part of the token', () => {
    // Without redact-first, the 2000-char cut lands inside the token and
    // prints its first characters.
    const { lines } = run(() => ({
      status: 1,
      stdout: '',
      stderr: `${'x'.repeat(1995)}${token}`,
    }));
    expect(lines[0]).not.toContain(token.slice(0, 5));
  });

  it('redacts the trimmed token too (a stored value with a trailing newline)', () => {
    const { lines } = run(
      () => ({ status: 1, stdout: '', stderr: `echo: ${token} end` }),
      { SENTRY_AUTH_TOKEN: `${token}\n` },
    );
    expect(lines[0]).not.toContain(token);
    expect(lines[0]).toContain('echo: [redacted] end');
  });

  it('redacts and flattens a multi-line spawn error message onto the one WARNING line', () => {
    const { lines } = run(() => ({
      status: null,
      error: { code: 'EACCES', message: `spawn failed\nwith ${token}\nend` },
      stdout: '',
      stderr: '',
    }));
    expect(lines.filter((line) => line.startsWith('WARNING: '))).toEqual([
      lines[0],
    ]);
    expect(lines[0]).not.toContain('\n');
    expect(lines.join('\n')).not.toContain(token);
    expect(lines[0]).toContain(
      'error=EACCES: spawn failed with [redacted] end)',
    );
  });
});

describe('inject runs under a snapshot of dist', () => {
  const env = { SENTRY_AUTH_TOKEN: 'sntrys_test' };
  const injectedMain = `${MAIN_JS}//# debugId=0000\n`;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('snapshots dist beside it for inject and discards it before upload', () => {
    const distDir = fixtureDist();
    const seen: Record<string, string[]> = {};
    const maps: Record<string, string[]> = {};
    let snapshotMain: string | undefined;
    expect(
      runSentrySourcemapUpload({
        env,
        distDir,
        // Records only: runSentrySourcemapUpload turns a throw from here,
        // such as a failed expect, into a failed step.
        runCli: (args) => {
          seen[args[1] ?? ''] = siblingsOf(distDir);
          maps[args[1] ?? ''] = mapFilesIn(distDir);
          if (args[1] === 'inject') {
            const [snapshot] = snapshotsBeside(distDir);
            snapshotMain = readFileSync(
              join(dirname(distDir), snapshot ?? '', 'main.js'),
              'utf8',
            );
            writeFileSync(join(distDir, 'main.js'), injectedMain);
          }
          return ok;
        },
        log: jest.fn(),
      }),
    ).toBe('uploaded');
    expect(seen.inject).toEqual([
      expect.stringMatching(/^\.sentry-inject-snapshot-/),
      'dist',
    ]);
    expect(snapshotMain).toBe(MAIN_JS);
    expect(seen.upload).toEqual(['dist']);
    // Both steps need the maps: inject rewrites them, upload sends them. The
    // strip comes after upload, never before.
    expect(maps).toEqual({ inject: FIXTURE_MAPS, upload: FIXTURE_MAPS });
    // A good inject is kept: the shipped JS carries its debug IDs.
    expect(readFileSync(join(distDir, 'main.js'), 'utf8')).toBe(injectedMain);
    expect(siblingsOf(distDir)).toEqual(['dist']);
  });

  it('restores dist byte for byte when inject fails after rewriting files', () => {
    const distDir = fixtureDist();
    const log = jest.fn<void, [string]>();
    expect(
      runSentrySourcemapUpload({
        env,
        distDir,
        runCli: () => {
          // What a kill mid-write leaves: an O_TRUNC'd module cut short.
          writeFileSync(join(distDir, 'main.js'), 'cons');
          writeFileSync(join(distDir, 'interface', 'filter.js'), '');
          writeFileSync(join(distDir, 'stray.js'), 'x');
          return { status: null, signal: 'SIGKILL', stdout: '', stderr: '' };
        },
        log,
      }),
    ).toBe('failed');
    expect(readFileSync(join(distDir, 'main.js'), 'utf8')).toBe(MAIN_JS);
    expect(readFileSync(join(distDir, 'interface', 'filter.js'), 'utf8')).toBe(
      FILTER_JS,
    );
    expect(existsSync(join(distDir, 'stray.js'))).toBe(false);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
    expect(siblingsOf(distDir)).toEqual(['dist']);
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      expect.stringMatching(
        /^WARNING: sentry-cli sourcemaps inject failed \(status=null signal=SIGKILL error=none\): \(no output\); frapp-api source maps NOT uploaded /,
      ),
      cleanedUp(distDir),
    ]);
  });

  // spawnSync reports a step it stopped itself with `error` AND `signal`.
  it.each([
    ['ETIMEDOUT', 'at its time bound'],
    ['ENOBUFS', 'for overflowing its output buffer'],
  ])('restores dist when spawnSync stops inject with %s (%s)', (code) => {
    const distDir = fixtureDist();
    const log = jest.fn<void, [string]>();
    expect(
      runSentrySourcemapUpload({
        env,
        distDir,
        runCli: () => {
          writeFileSync(join(distDir, 'main.js'), 'cons');
          return {
            status: null,
            signal: 'SIGKILL',
            error: { code, message: `spawnSync /x/sentry-cli ${code}` },
            stdout: '',
            stderr: '',
          };
        },
        log,
      }),
    ).toBe('failed');
    expect(readFileSync(join(distDir, 'main.js'), 'utf8')).toBe(MAIN_JS);
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^WARNING: sentry-cli sourcemaps inject failed \\(status=null signal=SIGKILL error=${code}: `,
        ),
      ),
      cleanedUp(distDir),
    ]);
    expect(siblingsOf(distDir)).toEqual(['dist']);
  });

  it('keeps the injected JS when only upload fails (upload only reads dist)', () => {
    const distDir = fixtureDist();
    expect(
      runSentrySourcemapUpload({
        env,
        distDir,
        runCli: (args) => {
          if (args[1] === 'inject') {
            writeFileSync(join(distDir, 'main.js'), injectedMain);
            return ok;
          }
          return { status: 1, stdout: '', stderr: 'upload failed' };
        },
        log: jest.fn(),
      }),
    ).toBe('failed');
    expect(readFileSync(join(distDir, 'main.js'), 'utf8')).toBe(injectedMain);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
    expect(siblingsOf(distDir)).toEqual(['dist']);
  });

  it('skips inject but still strips when the snapshot cannot be taken', () => {
    const distDir = fixtureDist();
    jest.spyOn(fs, 'mkdtempSync').mockImplementation((prefix) => {
      throw fsError('ENOSPC', 'mkdtemp', String(prefix));
    });
    const runCli = jest.fn(() => ok);
    const log = jest.fn<void, [string]>();
    expect(runSentrySourcemapUpload({ env, distDir, runCli, log })).toBe(
      'failed',
    );
    expect(runCli).not.toHaveBeenCalled();
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      expect.stringMatching(
        /^WARNING: could not snapshot .* before sentry-cli sourcemaps inject, so inject did not run \(ENOSPC: simulated failure, mkdtemp .*\); frapp-api source maps NOT uploaded \(best effort, #2431\)/,
      ),
      // Nothing was restored: inject never touched dist.
      cleanedUp(),
    ]);
    expect(readFileSync(join(distDir, 'main.js'), 'utf8')).toBe(MAIN_JS);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
  });

  it('removes a partial snapshot when copying dist into it fails', () => {
    const distDir = fixtureDist();
    jest.spyOn(fs, 'cpSync').mockImplementation(() => {
      throw fsError('ENOSPC', 'copyfile', distDir);
    });
    const runCli = jest.fn(() => ok);
    expect(
      runSentrySourcemapUpload({ env, distDir, runCli, log: jest.fn() }),
    ).toBe('failed');
    expect(runCli).not.toHaveBeenCalled();
    expect(siblingsOf(distDir)).toEqual(['dist']);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
  });

  it('fails the build when the restore after a failed inject fails', () => {
    const failedInject = (distDir: string) => () => {
      writeFileSync(join(distDir, 'main.js'), 'cons');
      // The snapshot is gone, so the restore cannot copy it back.
      for (const name of snapshotsBeside(distDir)) {
        rmSync(join(dirname(distDir), name), { recursive: true });
      }
      return { status: 1, stdout: '', stderr: 'inject failed' };
    };

    const distDir = fixtureDist();
    const log = jest.fn<void, [string]>();
    expect(() =>
      runSentrySourcemapUpload({
        env,
        distDir,
        runCli: failedInject(distDir),
        log,
      }),
    ).toThrow(/^restoring .* from its pre-inject snapshot .* failed: ENOENT/);
    // The failure is logged; a restore or strip that did not happen is not.
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      expect.stringMatching(
        /^WARNING: sentry-cli sourcemaps inject failed \(status=1 .*\): inject failed; frapp-api source maps NOT uploaded /,
      ),
    ]);
    expect(siblingsOf(distDir)).toEqual(['dist']);

    const again = fixtureDist();
    const mainLog = jest.fn<void, [string]>();
    expect(
      main({ env, distDir: again, runCli: failedInject(again), log: mainLog }),
    ).toBe(1);
    expect(mainLog).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^ERROR: restoring .* from its pre-inject snapshot .* failed: ENOENT.*failing the build$/,
      ),
    );
  });

  it('only warns when the snapshot cannot be removed (it is outside dist)', () => {
    const distDir = fixtureDist();
    const rmSyncReal = fs.rmSync;
    jest.spyOn(fs, 'rmSync').mockImplementation((path, options) => {
      if (String(path).includes(INJECT_SNAPSHOT_PREFIX)) {
        throw fsError('EBUSY', 'rmdir', String(path));
      }
      rmSyncReal(path, options);
    });
    const log = jest.fn<void, [string]>();
    expect(
      runSentrySourcemapUpload({ env, distDir, runCli: () => ok, log }),
    ).toBe('uploaded');
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      expect.stringMatching(
        /^WARNING: could not remove the pre-inject snapshot .*\(EBUSY: .*\); it is outside dist, so it does not ship$/,
      ),
      expect.stringMatching(/^uploaded API source maps/),
    ]);
    jest.restoreAllMocks();
    for (const name of snapshotsBeside(distDir)) {
      rmSync(join(dirname(distDir), name), { recursive: true });
    }
  });
});

describe('stripping *.map stays fatal on every path', () => {
  const env = { SENTRY_AUTH_TOKEN: 'sntrys_test' };
  const paths: Array<[string, Parameters<typeof main>[0]]> = [
    ['skip (no token)', { env: {} }],
    ['success', { env, runCli: () => ok }],
    [
      'upload failure',
      {
        env,
        runCli: (args) =>
          args[1] === 'inject' ? ok : { status: 1, stdout: '', stderr: 'nope' },
      },
    ],
    [
      'inject failure',
      { env, runCli: () => ({ status: 1, stdout: '', stderr: 'nope' }) },
    ],
  ];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws when the dist root is missing', () => {
    expect(() =>
      runSentrySourcemapUpload({
        env: {},
        distDir: missingDist(),
        log: jest.fn(),
      }),
    ).toThrow(/ENOENT/);
  });

  it.each(paths)(
    'throws when one *.map cannot be unlinked, on the %s path',
    (_path, options) => {
      const distDir = fixtureDist();
      const target = join(distDir, 'interface', 'filter.js.map');
      const unlink = failUnlinkOf(target);
      expect(() =>
        runSentrySourcemapUpload({ ...options, distDir, log: jest.fn() }),
      ).toThrow(`EBUSY: simulated failure, unlink '${target}'`);
      expect(unlink).toHaveBeenCalledWith(target);
      expect(siblingsOf(distDir)).toEqual(['dist']);
    },
  );

  it.each([
    ['inject', () => ({ status: 1, stdout: '', stderr: 'nope' })],
    [
      'upload',
      (args: string[]) =>
        args[1] === 'inject' ? ok : { status: 1, stdout: '', stderr: 'nope' },
    ],
  ])(
    'logs the %s WARNING before a strip that throws, and claims no cleanup',
    (step, runCli) => {
      const distDir = fixtureDist();
      failUnlinkOf(join(distDir, 'main.js.map'));
      const log = jest.fn<void, [string]>();
      expect(() =>
        runSentrySourcemapUpload({ env, distDir, runCli, log }),
      ).toThrow(/EBUSY/);
      expect(log.mock.calls.map(([line]) => line)).toEqual([
        expect.stringMatching(
          new RegExp(`^WARNING: sentry-cli sourcemaps ${step} failed `),
        ),
      ]);
    },
  );

  it.each(paths)(
    'main() exits 1 when one *.map cannot be unlinked, on the %s path',
    (_path, options) => {
      const distDir = fixtureDist();
      failUnlinkOf(join(distDir, 'main.js.map'));
      const log = jest.fn();
      expect(main({ ...options, distDir, log })).toBe(1);
      expect(log).toHaveBeenLastCalledWith(
        expect.stringMatching(/^ERROR: EBUSY.*failing the build$/),
      );
    },
  );

  it('main() exits 1 when the dist root is missing', () => {
    const log = jest.fn();
    expect(main({ env: {}, distDir: missingDist(), log })).toBe(1);
    expect(log).toHaveBeenLastCalledWith(
      expect.stringMatching(/^ERROR: ENOENT.*failing the build$/),
    );
  });

  it('main() exits 0 when sentry-cli fails but stripping succeeds', () => {
    const distDir = fixtureDist();
    const log = jest.fn();
    expect(
      main({
        env,
        distDir,
        runCli: () => ({ status: 1, stdout: '', stderr: 'nope' }),
        log,
      }),
    ).toBe(0);
    expect(stripSourceMapFiles(distDir)).toEqual([]);
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
    const entry = resolveSentryCliModule();
    expect(entry).toMatch(/[\\/]@sentry[\\/]cli[\\/]js[\\/]index\.js$/);
    expect(versionOfModule(entry)).toBe(declaredCliVersion());
  });

  it('returns the native executable, not the JS wrapper that masks signals', () => {
    const bin = sentryCliBin();
    expect(existsSync(bin)).toBe(true);
    expect(bin).not.toBe(
      join(dirname(dirname(resolveSentryCliModule())), 'bin', 'sentry-cli'),
    );
    // A script starts with `#!`; the wrapper is `#!/usr/bin/env node`.
    expect(readFileSync(bin).subarray(0, 2).toString('latin1')).not.toBe('#!');
  });

  it('does not depend on process.cwd()', () => {
    const expectedEntry = resolveSentryCliModule();
    const expectedBin = sentryCliBin();
    const declared = declaredCliVersion();
    const original = process.cwd();
    // No node_modules here: a cwd-relative lookup (the #2431 bug) finds nothing.
    const elsewhere = mkdtempSync(join(tmpdir(), 'frapp-api-cwd-'));
    try {
      process.chdir(elsewhere);
      expect(process.cwd()).not.toBe(original);
      expect(existsSync(join(process.cwd(), 'node_modules'))).toBe(false);
      const entry = resolveSentryCliModule();
      expect(entry).toBe(expectedEntry);
      expect(versionOfModule(entry)).toBe(declared);
      expect(sentryCliBin()).toBe(expectedBin);
    } finally {
      process.chdir(original);
    }
  });

  it('finds the copy nested under apps/api when the root has none (Docker deps stage)', () => {
    // `npm ci --workspace=apps/api ...` installs only apps/api's nested copy;
    // the root node_modules has no @sentry/cli at all.
    const root = mkdtempSync(join(tmpdir(), 'frapp-api-cli-'));
    const pkgDir = join(root, 'apps/api/node_modules/@sentry/cli');
    mkdirSync(join(pkgDir, 'js'), { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      '{"name":"@sentry/cli","version":"0.0.0","main":"js/index.js"}\n',
    );
    const nativeBin = join(root, 'native-sentry-cli');
    writeFileSync(
      join(pkgDir, 'js', 'index.js'),
      `exports.SentryCli = { getPath: () => ${JSON.stringify(nativeBin)} };\n`,
    );
    const scriptDir = join(root, 'apps/api/dist/infrastructure/observability');
    mkdirSync(scriptDir, { recursive: true });
    expect(resolveSentryCliModule(scriptDir)).toBe(
      join(pkgDir, 'js', 'index.js'),
    );
    expect(sentryCliBin(scriptDir)).toBe(nativeBin);
  });

  it('throws a named error when @sentry/cli no longer exports SentryCli.getPath', () => {
    const root = mkdtempSync(join(tmpdir(), 'frapp-api-cli-api-'));
    const pkgDir = join(root, 'node_modules/@sentry/cli');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      '{"name":"@sentry/cli","version":"99.0.0","main":"index.js"}\n',
    );
    writeFileSync(join(pkgDir, 'index.js'), 'exports.other = 1;\n');
    expect(() => sentryCliBin(root)).toThrow(
      /does not export SentryCli\.getPath\(\)/,
    );
  });
});

describe('defaultRunSentryCli', () => {
  const posixIt = process.platform === 'win32' ? it.skip : it;

  it('runs the native sentry-cli directly', () => {
    const result = defaultRunSentryCli(['--version'], { timeoutMs: 60_000 });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(cliSucceeded(result)).toBe(true);
    expect(result.stdout.trim()).toBe(`sentry-cli ${declaredCliVersion()}`);
  });

  it('surfaces a spawn error instead of a bare null status', () => {
    const result = defaultRunSentryCli(['--version'], {
      timeoutMs: 60_000,
      cwd: join(tmpdir(), 'frapp-api-no-such-dir', String(process.pid)),
    });
    expect(result.status).toBeNull();
    expect(result.error?.code).toBe('ENOENT');
    expect(describeCliFailure('inject', result)).toMatch(
      /^sentry-cli sourcemaps inject failed \(status=null signal=none error=ENOENT: /,
    );
  });

  // Real spawns of a fake `sentry-cli`, pointed at through SENTRY_BINARY_PATH,
  // which @sentry/cli's own getPath() honours (js/helper.js).
  describe('with a fake native binary', () => {
    const saved = process.env.SENTRY_BINARY_PATH;
    afterEach(() => {
      if (saved === undefined) delete process.env.SENTRY_BINARY_PATH;
      else process.env.SENTRY_BINARY_PATH = saved;
    });

    function fakeBinary(body: string): string {
      const path = join(
        mkdtempSync(join(tmpdir(), 'frapp-fake-cli-')),
        'sentry-cli',
      );
      writeFileSync(path, `#!/bin/sh\n${body}\n`);
      chmodSync(path, 0o755);
      return path;
    }

    posixIt('reports a self-killed binary as failed with its signal', () => {
      process.env.SENTRY_BINARY_PATH = fakeBinary('kill -9 $$');
      expect(sentryCliBin()).toBe(process.env.SENTRY_BINARY_PATH);

      // Harmless args: if a regression spawned the real CLI instead of the
      // fake, `inject .` would rewrite files in the working tree.
      const direct = defaultRunSentryCli(['--version'], { timeoutMs: 60_000 });
      expect(direct).toMatchObject({ status: null, signal: 'SIGKILL' });
      expect(direct.error).toBeUndefined();
      expect(cliSucceeded(direct)).toBe(false);

      const distDir = fixtureDist();
      const log = jest.fn<void, [string]>();
      expect(
        runSentrySourcemapUpload({
          env: { SENTRY_AUTH_TOKEN: 'sntrys_test' },
          distDir,
          log,
        }),
      ).toBe('failed');
      expect(log.mock.calls.map(([line]) => line)).toEqual([
        expect.stringMatching(
          /^WARNING: sentry-cli sourcemaps inject failed \(status=null signal=SIGKILL error=none\)/,
        ),
        cleanedUp(distDir),
      ]);
      expect(stripSourceMapFiles(distDir)).toEqual([]);
    });

    posixIt('restores a module that a killed inject left truncated', () => {
      // $3 is the dist directory: `sourcemaps inject <distDir>`.
      process.env.SENTRY_BINARY_PATH = fakeBinary(
        'printf cons > "$3/main.js"\nkill -9 $$',
      );
      const distDir = fixtureDist();
      const log = jest.fn<void, [string]>();
      expect(
        runSentrySourcemapUpload({
          env: { SENTRY_AUTH_TOKEN: 'sntrys_test' },
          distDir,
          log,
        }),
      ).toBe('failed');
      expect(readFileSync(join(distDir, 'main.js'), 'utf8')).toBe(MAIN_JS);
      expect(log.mock.calls.map(([line]) => line)).toEqual([
        expect.stringMatching(
          /^WARNING: sentry-cli sourcemaps inject failed \(status=null signal=SIGKILL error=none\)/,
        ),
        cleanedUp(distDir),
      ]);
      expect(stripSourceMapFiles(distDir)).toEqual([]);
      expect(siblingsOf(distDir)).toEqual(['dist']);
    });

    posixIt(
      'kills a hung inject at its time bound, reports ETIMEDOUT, and restores what it truncated',
      () => {
        // Cut main.js short the way inject's O_TRUNC write does, note that it
        // happened, then hang until the time bound kills it. `exec` so the
        // SIGKILL hits the sleeper itself and no orphan outlives the test.
        const marker = join(
          mkdtempSync(join(tmpdir(), 'frapp-fake-cli-ran-')),
          'truncated',
        );
        process.env.SENTRY_BINARY_PATH = fakeBinary(
          `printf cons > "$3/main.js"\n: > '${marker}'\nexec sleep 30`,
        );
        const distDir = fixtureDist();
        const original = readFileSync(join(distDir, 'main.js'));
        const log = jest.fn<void, [string]>();
        const started = Date.now();
        expect(
          runSentrySourcemapUpload({
            env: { SENTRY_AUTH_TOKEN: 'sntrys_test' },
            distDir,
            timeoutsMs: { inject: 1000, upload: 1000 },
            log,
          }),
        ).toBe('failed');
        expect(Date.now() - started).toBeLessThan(10_000);
        // The kill came after the truncation, so the restore had work to do.
        expect(existsSync(marker)).toBe(true);
        expect(log.mock.calls.map(([line]) => line)).toEqual([
          expect.stringMatching(
            /^WARNING: sentry-cli sourcemaps inject failed \(status=null signal=SIGKILL error=ETIMEDOUT: /,
          ),
          cleanedUp(distDir),
        ]);
        expect(readFileSync(join(distDir, 'main.js')).equals(original)).toBe(
          true,
        );
        expect(
          readFileSync(join(distDir, 'interface', 'filter.js'), 'utf8'),
        ).toBe(FILTER_JS);
        expect(snapshotsBeside(distDir)).toEqual([]);
        expect(stripSourceMapFiles(distDir)).toEqual([]);
      },
    );
  });
});

/**
 * Emits this module, and every local module it requires, the way `nest build`
 * does (CommonJS: apps/api/package.json has no `"type": "module"`), at the
 * same path under `<root>/dist/` as under `src/`. Returns the entry's path.
 */
function emitBuiltEntry(root: string): string {
  const srcRoot = join(__dirname, '../..');
  const emit = (srcFile: string): string => {
    const out = join(
      root,
      'dist',
      relative(srcRoot, srcFile).replace(/\.ts$/, '.js'),
    );
    if (existsSync(out)) return out;
    const { outputText } = ts.transpileModule(readFileSync(srcFile, 'utf8'), {
      fileName: srcFile,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        esModuleInterop: true,
      },
    });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, outputText);
    for (const [, local] of outputText.matchAll(
      /require\("(\.{1,2}\/[^"]+)"\)/g,
    )) {
      emit(join(dirname(srcFile), `${local}.ts`));
    }
    return out;
  };
  return emit(join(__dirname, 'upload-sentry-sourcemaps.ts'));
}

/**
 * Docker's view of the instructions, as BuildKit's parser builds them:
 * comment lines and whitespace-only lines dropped (inside a `\` continuation
 * too, where Docker skips them and keeps joining), then each line that ends
 * in `\`, trailing blanks allowed, joined to the next.
 */
function dockerInstructions(dockerfile: string): string[] {
  return dockerfile
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\[ \t]*\r?\n/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}

type StageCopy = { from: string | undefined; sources: string[] };

/**
 * The `COPY` instructions of one stage, with `--from` resolved to a stage
 * name (a numeric `--from` is a stage index) and every source made absolute,
 * since a `--from` source is relative to that stage's root, not its WORKDIR.
 */
function stageCopies(dockerfile: string, stage: string): StageCopy[] {
  const instructions = dockerInstructions(dockerfile);
  const stages = instructions
    .filter((line) => /^FROM /i.test(line))
    .map((line) => /\sAS\s+(\S+)$/i.exec(line)?.[1]?.toLowerCase());
  const start = instructions.findIndex((line) =>
    new RegExp(`^FROM \\S+ AS ${stage}$`, 'i').test(line),
  );
  expect(start).toBeGreaterThan(-1);
  const next = instructions.findIndex(
    (line, index) => index > start && /^FROM /i.test(line),
  );
  return instructions
    .slice(start + 1, next === -1 ? undefined : next)
    .filter((line) => /^COPY /i.test(line))
    .map((line) => {
      const words = line.split(' ').slice(1);
      const flags: string[] = [];
      while (words[0]?.startsWith('--')) flags.push(words.shift() ?? '');
      const rest = words.join(' ');
      const paths = rest.startsWith('[')
        ? (JSON.parse(rest) as string[])
        : words;
      const from = flags
        .find((flag) => flag.startsWith('--from='))
        ?.slice('--from='.length)
        .toLowerCase();
      return {
        from: from && /^\d+$/.test(from) ? stages[Number(from)] : from,
        sources: paths
          .slice(0, -1)
          .map((source) =>
            posix.normalize(source.startsWith('/') ? source : `/${source}`),
          ),
      };
    });
}

const DOCKER_UPLOAD_RUN =
  'RUN node apps/api/dist/infrastructure/observability/upload-sentry-sourcemaps.js';

// Nothing else runs the module as a program, so without these a regression in
// `isDirectCli()` or `process.exitCode = main()` would pass every test above.
describe('the built entry, run by node as the Docker step runs it', () => {
  const posixIt = process.platform === 'win32' ? it.skip : it;

  function builtTree() {
    // Real path: node runs the entry from its real path, so the dist the
    // script logs is under it even where the temp dir is a symlink (macOS).
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'frapp-api-built-')));
    const entry = emitBuiltEntry(root);
    const distDir = writeFixtureDist(join(root, 'dist'));
    return { root, distDir, entry: relative(root, entry) };
  }

  function runNode(
    root: string,
    args: string[],
    extraEnv: NodeJS.Dict<string> = {},
  ) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of [
      'SENTRY_AUTH_TOKEN',
      'SENTRY_BINARY_PATH',
      'RENDER_GIT_COMMIT',
      'NODE_OPTIONS',
      'NODE_PATH',
    ]) {
      delete env[key];
    }
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return {
      status: result.status,
      signal: result.signal,
      lines: result.stderr.split('\n').filter((line) => line !== ''),
    };
  }

  it('is emitted at the path the Dockerfile runs', () => {
    const { entry } = builtTree();
    expect(`RUN node apps/api/${entry}`).toBe(DOCKER_UPLOAD_RUN);
    const tsconfigBuild = readFileSync(
      join(process.cwd(), 'tsconfig.build.json'),
      'utf8',
    );
    expect(tsconfigBuild).toMatch(/"rootDir"\s*:\s*"\.\/src"/);
  });

  it('exits 0 and strips maps when SENTRY_AUTH_TOKEN is unset', () => {
    const { root, distDir, entry } = builtTree();
    const run = runNode(root, [entry]);
    expect(run).toEqual({
      status: 0,
      signal: null,
      lines: [
        'SENTRY_AUTH_TOKEN unset; skipping frapp-api source-map inject/upload',
      ],
    });
    expect(stripSourceMapFiles(distDir)).toEqual([]);
  });

  posixIt(
    'exits 0 with one WARNING, then the cleanup, and an untouched module when inject is killed mid-write',
    () => {
      const { root, distDir, entry } = builtTree();
      // Found by resolution from the entry's directory, like the real one.
      const fakeBin = join(root, 'fake-sentry-cli');
      writeFileSync(
        fakeBin,
        '#!/bin/sh\nprintf cons > "$3/main.js"\nkill -9 $$\n',
      );
      chmodSync(fakeBin, 0o755);
      const pkgDir = join(root, 'node_modules/@sentry/cli');
      mkdirSync(join(pkgDir, 'js'), { recursive: true });
      writeFileSync(
        join(pkgDir, 'package.json'),
        '{"name":"@sentry/cli","version":"0.0.0","main":"js/index.js"}\n',
      );
      writeFileSync(
        join(pkgDir, 'js', 'index.js'),
        `exports.SentryCli = { getPath: () => ${JSON.stringify(fakeBin)} };\n`,
      );

      const run = runNode(root, [entry], { SENTRY_AUTH_TOKEN: 'sntrys_test' });
      expect(run.status).toBe(0);
      expect(run.signal).toBeNull();
      expect(run.lines).toEqual([
        expect.stringMatching(
          /^WARNING: sentry-cli sourcemaps inject failed \(status=null signal=SIGKILL error=none\)/,
        ),
        cleanedUp(distDir),
      ]);
      expect(readFileSync(join(distDir, 'main.js'), 'utf8')).toBe(MAIN_JS);
      expect(stripSourceMapFiles(distDir)).toEqual([]);
      expect(snapshotsBeside(distDir)).toEqual([]);
    },
  );

  it('exits 1 with an ERROR when a *.map cannot be stripped', () => {
    const { root, distDir, entry } = builtTree();
    const preload = join(root, 'fail-unlink.js');
    writeFileSync(
      preload,
      [
        "const fs = require('node:fs');",
        'const unlinkSync = fs.unlinkSync;',
        'fs.unlinkSync = (path) => {',
        "  if (String(path).endsWith('.map')) {",
        "    throw Object.assign(new Error('EBUSY: simulated failure, unlink ' + path), { code: 'EBUSY' });",
        '  }',
        '  return unlinkSync(path);',
        '};',
        '',
      ].join('\n'),
    );
    const run = runNode(root, ['--require', preload, entry]);
    expect(run.status).toBe(1);
    expect(run.lines.at(-1)).toMatch(/^ERROR: EBUSY.*failing the build$/);
    expect(existsSync(join(distDir, 'main.js.map'))).toBe(true);
  });
});

describe('API Docker / CI wiring', () => {
  const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
  const ci = readFileSync(
    join(process.cwd(), '../../.github/workflows/ci.yml'),
    'utf8',
  );

  it('invokes the upload entry after nest build and does not ENV the token', () => {
    expect(dockerfile).toContain(DOCKER_UPLOAD_RUN);
    expect(dockerfile).toMatch(/ARG SENTRY_AUTH_TOKEN/);
    expect(dockerfile).toMatch(/ARG RENDER_GIT_COMMIT/);
    expect(dockerfile).not.toMatch(/ENV SENTRY_AUTH_TOKEN/);
    // The linux-x64 sentry-cli is static-pie: no glibc shim, and no network
    // fetch in the build that an Alpine mirror outage could fail.
    expect(dockerfile).not.toMatch(/apk add/);
    // Best effort is decided in the script (#2431), not by swallowing the
    // step's exit code, which would also hide a failed strip or restore. The
    // whole instruction is compared, continuation lines included, so a
    // `|| true` on a continuation line, a `; true` or a `set +e` all fail it.
    expect(
      dockerInstructions(dockerfile).filter((line) =>
        line.includes('upload-sentry-sourcemaps'),
      ),
    ).toEqual([DOCKER_UPLOAD_RUN]);
    // Shapes Docker joins into one instruction, so the check above sees them.
    for (const shape of [
      `${DOCKER_UPLOAD_RUN} \\\n    # comment\n    || true\n`,
      `${DOCKER_UPLOAD_RUN} \\\n\n    || true\n`,
      `${DOCKER_UPLOAD_RUN} \\\n  \t \r\n    || true\n`,
      `${DOCKER_UPLOAD_RUN} \\  \n    || true\n`,
    ]) {
      expect(dockerInstructions(shape)).toEqual([
        `${DOCKER_UPLOAD_RUN} || true`,
      ]);
    }
    const buildIndex = dockerfile.indexOf(
      'RUN npm run build --workspace=apps/api',
    );
    const uploadIndex = dockerfile.indexOf('upload-sentry-sourcemaps.js');
    expect(buildIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(buildIndex);
  });

  it('takes only dist/ and package.json from the builder apps/api/ into the runner', () => {
    // The pre-inject snapshot is made at apps/api/.sentry-inject-snapshot-*
    // in the builder, beside dist, and a failure to remove it is only a
    // warning because of this: nothing else under apps/api/ reaches the
    // runner, and no builder source is apps/api/ or a directory above it.
    const api = '/app/apps/api/';
    const copies = stageCopies(dockerfile, 'runner');
    expect(copies.length).toBeGreaterThan(0);
    const fromBuilder = copies
      .filter((copy) => copy.from === 'builder')
      .flatMap((copy) => copy.sources)
      // `/` becomes '', which the ancestor check below still catches.
      .map((source) => source.replace(/\/+$/, ''));
    expect(fromBuilder.filter((source) => /[*?[]/.test(source))).toEqual([]);
    expect(
      fromBuilder
        // Under apps/api/, or apps/api itself or a directory above it (kept
        // whole, so it cannot match).
        .filter(
          (source) => source.startsWith(api) || api.startsWith(`${source}/`),
        )
        .map((source) =>
          source.startsWith(api) ? source.slice(api.length) : source,
        )
        .sort(),
    ).toEqual(['dist', 'package.json']);
    // The parser sees what Docker sees: a copy of the whole builder app, by
    // stage index, is caught.
    expect(
      stageCopies(
        'FROM a AS deps\nFROM a AS builder\nFROM a AS runner\nCOPY --from=1 /app/apps/ ./apps/\n',
        'runner',
      ),
    ).toEqual([{ from: 'builder', sources: ['/app/apps/'] }]);
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
