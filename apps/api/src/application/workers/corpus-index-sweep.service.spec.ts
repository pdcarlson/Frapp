import type { CorpusIngestService } from '../services/corpus/corpus-ingest.service';
import { CorpusIndexSweepService } from './corpus-index-sweep.service';

describe('CorpusIndexSweepService', () => {
  function setup() {
    const sweep = jest.fn<Promise<number>, []>().mockResolvedValue(0);
    const worker = new CorpusIndexSweepService({
      sweep,
    } as unknown as CorpusIngestService);
    return { worker, sweep };
  }

  it('sweeps each time it fires', async () => {
    const { worker, sweep } = setup();
    await worker.handleCorpusIndexSweep();
    await worker.handleCorpusIndexSweep();
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('does not start a second sweep while one is still running', async () => {
    const { worker, sweep } = setup();
    let finish: (queued: number) => void = () => undefined;
    sweep.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );
    const first = worker.handleCorpusIndexSweep();
    await worker.handleCorpusIndexSweep();
    expect(sweep).toHaveBeenCalledTimes(1);
    finish(3);
    await first;
  });

  it('sweeps again after a sweep that failed', async () => {
    const { worker, sweep } = setup();
    sweep.mockRejectedValueOnce(new Error('database away'));
    // `@ReportedCron` reports the failure; whether it rethrows is its own.
    await worker.handleCorpusIndexSweep().catch(() => undefined);
    await worker.handleCorpusIndexSweep();
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
