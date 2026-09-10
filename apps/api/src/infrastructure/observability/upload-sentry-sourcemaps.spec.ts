import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_SENTRY_ORG,
  API_SENTRY_PROJECT,
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

  it('injects then uploads and fails closed if inject fails', () => {
    const distDir = fixtureDist();
    const runCli = jest.fn((args: string[]) => {
      if (args[1] === 'inject') {
        return { status: 1, stdout: '', stderr: 'inject boom' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    expect(() =>
      runSentrySourcemapUpload({
        env: { SENTRY_AUTH_TOKEN: 'sntrys_test' },
        distDir,
        runCli,
      }),
    ).toThrow(/inject failed/);
    expect(runCli).toHaveBeenCalledTimes(1);
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

describe('sentryCliBin', () => {
  it('resolves the workspace-hoisted binary from the Docker build cwd', () => {
    expect(sentryCliBin('/app')).toBe('/app/node_modules/.bin/sentry-cli');
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
