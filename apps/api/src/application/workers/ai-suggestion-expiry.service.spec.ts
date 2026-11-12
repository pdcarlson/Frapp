import { AiSuggestionExpiryService } from './ai-suggestion-expiry.service';

describe('AiSuggestionExpiryService (#4309)', () => {
  it('puts back stale accepts, then expires, and a tick never overlaps another', async () => {
    let finish: (n: number) => void = () => undefined;
    const order: string[] = [];
    const suggestions = {
      releaseStaleAccepts: jest.fn(async () => {
        order.push('release');
        return 1;
      }),
      expireDue: jest.fn(async () => {
        order.push('expire');
        return 0;
      }),
    };
    suggestions.expireDue.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          order.push('expire');
          finish = resolve;
        }),
    );
    const sweep = new AiSuggestionExpiryService(suggestions as never);
    const first = sweep.handleAiSuggestionExpirySweep();
    await new Promise((resolve) => setImmediate(resolve));
    await sweep.handleAiSuggestionExpirySweep();
    expect(suggestions.expireDue).toHaveBeenCalledTimes(1);
    finish(3);
    await first;
    await sweep.handleAiSuggestionExpirySweep();
    expect(order).toEqual(['release', 'expire', 'release', 'expire']);
  });
});
