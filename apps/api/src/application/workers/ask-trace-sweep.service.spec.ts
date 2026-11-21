import { AskTraceSweepService } from './ask-trace-sweep.service';

describe('AskTraceSweepService', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('deletes whatever has run out, even with AI switched off on the server', async () => {
    delete process.env.AI_ENABLED;
    const traces = { sweep: jest.fn(async () => 1) };
    const service = new AskTraceSweepService(traces as never);
    await service.handleAskTraceSweep();
    expect(traces.sweep).toHaveBeenCalledTimes(1);
    expect(traces.sweep.mock.calls[0]).toEqual([expect.any(Date)]);
  });
});
