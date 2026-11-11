import * as fs from 'node:fs';
import * as path from 'node:path';
import 'reflect-metadata';
import { CronExpression } from '@nestjs/schedule';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { ReportedCron } from './reported-cron.decorator';

jest.mock('../../infrastructure/observability/report-caught-failure', () => ({
  reportCaughtFailure: jest.fn(),
}));

const report = jest.mocked(reportCaughtFailure);

class Sweeps {
  ran = 0;

  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleNightlySweep(): Promise<void> {
    this.ran += 1;
    await Promise.resolve();
    throw new RangeError('Invalid time value');
  }

  @ReportedCron(CronExpression.EVERY_HOUR, { name: 'quiet' })
  async handleQuietSweep(): Promise<string> {
    this.ran += 1;
    return Promise.resolve('done');
  }
}

/**
 * Every scheduled handler reports a rejection through `reportCaughtFailure`
 * instead of leaving it to `@nestjs/schedule`'s raw `logger.error` (#3498).
 */
describe('ReportedCron', () => {
  beforeEach(() => report.mockClear());

  it('reports a rejection at error level under the handler’s site, and resolves', async () => {
    const sweeps = new Sweeps();

    await expect(sweeps.handleNightlySweep()).resolves.toBeUndefined();

    expect(sweeps.ran).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.anything(), {
      level: 'error',
      site: 'cron:handle-nightly-sweep',
      message: 'Sweeps.handleNightlySweep rejected; skipping this tick',
      error: expect.any(RangeError),
    });
  });

  it('passes a handler’s result through and reports nothing', async () => {
    const sweeps = new Sweeps();
    await expect(sweeps.handleQuietSweep()).resolves.toBe('done');
    expect(sweeps.ran).toBe(1);
    expect(report).not.toHaveBeenCalled();
  });

  it('registers the wrapper, not the bare method, with the scheduler', () => {
    // `@nestjs/schedule` reads its metadata off the function it will call.
    const handler = Sweeps.prototype.handleQuietSweep;
    expect(Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', handler)).toEqual(
      expect.objectContaining({
        cronTime: CronExpression.EVERY_HOUR,
        name: 'quiet',
      }),
    );
    expect(handler.name).toBe('handleQuietSweep');
  });

  it('is the only way the API schedules a handler', () => {
    const src = path.resolve(__dirname, '../..');
    const bare: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.spec.ts') &&
          full !== path.join(__dirname, 'reported-cron.decorator.ts') &&
          /@Cron\(/.test(fs.readFileSync(full, 'utf8'))
        ) {
          bare.push(path.relative(src, full));
        }
      }
    };
    walk(src);
    expect(bare).toEqual([]);
  });
});
