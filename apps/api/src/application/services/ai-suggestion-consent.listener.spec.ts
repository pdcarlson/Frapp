import type { IAiSuggestionRepository } from '#domain/repositories/ai-suggestion.repository.interface';
import type { AiConsentService } from './ai/ai-consent.service';
import { AiSuggestionConsentListener } from './ai-suggestion-consent.listener';

describe('AiSuggestionConsentListener', () => {
  it('takes a member’s words out of suggestions when they say No', async () => {
    let registered: ((userId: string) => Promise<void>) | undefined;
    const consent = {
      onConsentWithdrawn: jest.fn((listener) => {
        registered = listener;
      }),
    } as unknown as AiConsentService;
    const dropQuotesBy = jest.fn().mockResolvedValue(2);
    const listener = new AiSuggestionConsentListener(consent, {
      dropQuotesBy,
    } as unknown as IAiSuggestionRepository);

    listener.onModuleInit();
    expect(registered).toBeDefined();
    await registered?.('user-1');

    expect(dropQuotesBy).toHaveBeenCalledWith('user-1');
  });

  it('lets a failure through, so the No fails and the retry runs it again', async () => {
    let registered: ((userId: string) => Promise<void>) | undefined;
    const consent = {
      onConsentWithdrawn: jest.fn((listener) => {
        registered = listener;
      }),
    } as unknown as AiConsentService;
    const listener = new AiSuggestionConsentListener(consent, {
      dropQuotesBy: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as IAiSuggestionRepository);

    listener.onModuleInit();
    await expect(registered?.('user-1')).rejects.toThrow('db down');
  });
});
