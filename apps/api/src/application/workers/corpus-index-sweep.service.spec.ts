import type { ChatCorpusConsentService } from '../services/corpus/chat-corpus-consent.service';
import type { CorpusIngestService } from '../services/corpus/corpus-ingest.service';
import { CorpusIndexSweepService } from './corpus-index-sweep.service';

describe('CorpusIndexSweepService', () => {
  function setup() {
    const sweep = jest.fn<Promise<number>, []>().mockResolvedValue(0);
    const reconcile = jest.fn<Promise<number>, []>().mockResolvedValue(0);
    const worker = new CorpusIndexSweepService(
      { sweep } as unknown as CorpusIngestService,
      { reconcile } as unknown as ChatCorpusConsentService,
    );
    return { worker, sweep, reconcile };
  }

  it('reconciles the chat index each time the hourly job fires, one at a time', async () => {
    const { worker, reconcile } = setup();
    let finish: (n: number) => void = () => undefined;
    reconcile.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );
    const first = worker.handleChatCorpusReconcile();
    await worker.handleChatCorpusReconcile();
    expect(reconcile).toHaveBeenCalledTimes(1);
    finish(2);
    await first;
    await worker.handleChatCorpusReconcile();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

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
