import type { ICorpusRepository } from '#domain/repositories/corpus.repository.interface';
import type { AiConsentService } from '../ai/ai-consent.service';
import { ChatCorpusConsentService } from './chat-corpus-consent.service';

const CHAPTER_A = 'chapter-a';
const CHAPTER_B = 'chapter-b';

function setup(yesByChapter: Record<string, string[]>) {
  let listener: ((userId: string) => Promise<void>) | null = null;
  const consent = {
    onConsentWithdrawn: jest.fn((fn: (userId: string) => Promise<void>) => {
      listener = fn;
    }),
    chatAuthorsWhoSaidYes: jest.fn(
      (chapterId: string, ids: readonly string[]) =>
        Promise.resolve(
          new Set(
            ids.filter((id) => (yesByChapter[chapterId] ?? []).includes(id)),
          ),
        ),
    ),
  } as unknown as jest.Mocked<AiConsentService>;
  const corpus = {
    requeueChatByAuthors: jest.fn().mockResolvedValue(1),
    chatCorpusChapters: jest.fn().mockResolvedValue([CHAPTER_A, CHAPTER_B]),
    chatCorpusAuthors: jest.fn((chapterId: string) =>
      Promise.resolve(
        chapterId === CHAPTER_A
          ? { indexed: ['sam', 'gone'], leftOut: ['lee', 'quiet'] }
          : { indexed: ['sam'], leftOut: [] },
      ),
    ),
  } as unknown as jest.Mocked<ICorpusRepository>;
  const service = new ChatCorpusConsentService(consent, corpus);
  service.onModuleInit();
  return {
    service,
    corpus,
    withdraw: (userId: string) => {
      if (!listener) throw new Error('no listener registered');
      return listener(userId);
    },
  };
}

describe('ChatCorpusConsentService', () => {
  it('drops a member’s passages in every chapter the moment they say No', async () => {
    const { corpus, withdraw } = setup({});
    await withdraw('sam');
    expect(corpus.requeueChatByAuthors).toHaveBeenCalledWith(['sam'], null);
  });

  it('rebuilds, per chapter, windows held by members who no longer say yes and windows that left out members who now do', async () => {
    const { service, corpus } = setup({
      [CHAPTER_A]: ['sam', 'lee'],
      [CHAPTER_B]: ['sam'],
    });
    await expect(service.reconcile()).resolves.toBe(1);
    // `gone` (a deleted account, or a new sheet unanswered) goes; `lee` said
    // yes after being left out and comes in; `quiet` stays out.
    expect(corpus.requeueChatByAuthors).toHaveBeenCalledTimes(1);
    expect(corpus.requeueChatByAuthors).toHaveBeenCalledWith(
      ['gone', 'lee'],
      CHAPTER_A,
    );
  });

  it('keeps going to the next chapter when one fails', async () => {
    const { service, corpus } = setup({ [CHAPTER_B]: [] });
    corpus.chatCorpusAuthors.mockRejectedValueOnce(new Error('database away'));
    await service.reconcile();
    expect(corpus.requeueChatByAuthors).toHaveBeenCalledWith(
      ['sam'],
      CHAPTER_B,
    );
  });
});
