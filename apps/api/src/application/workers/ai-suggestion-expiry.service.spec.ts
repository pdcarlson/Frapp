import { AiSuggestionExpiryService } from './ai-suggestion-expiry.service';

describe('AiSuggestionExpiryService (#4309)', () => {
  it('expires through the service, and a tick never overlaps another', async () => {
    let finish: (n: number) => void = () => undefined;
    const suggestions = { expireDue: jest.fn().mockResolvedValue(0) };
    suggestions.expireDue.mockReturnValueOnce(
      new Promise<number>((resolve) => (finish = resolve)),
    );
    const sweep = new AiSuggestionExpiryService(suggestions as never);
    const first = sweep.handleAiSuggestionExpirySweep();
    await sweep.handleAiSuggestionExpirySweep();
    expect(suggestions.expireDue).toHaveBeenCalledTimes(1);
    finish(3);
    await first;
    await sweep.handleAiSuggestionExpirySweep();
    expect(suggestions.expireDue).toHaveBeenCalledTimes(2);
  });
});
