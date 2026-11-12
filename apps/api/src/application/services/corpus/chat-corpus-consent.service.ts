import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CORPUS_REPOSITORY,
  type ICorpusRepository,
} from '#domain/repositories/corpus.repository.interface';
import { AiConsentService } from '../ai/ai-consent.service';

/**
 * Keeps the chat index in step with members' answers (#4314,
 * `spec/behavior/ai.md` § Chat as a source: "a member who turns the choice
 * off stops being read from that moment, and their message embeddings are
 * purged within a day").
 *
 * - **A No, at once.** Registered with `AiConsentService.onConsentWithdrawn`:
 *   every window holding a passage by the member, in every chapter, loses
 *   its passages in the same request and is rebuilt without them. Safe to
 *   run twice.
 * - **Everything else, within the hour** (`reconcile`, from the corpus
 *   sweep). A new sheet version (everyone counts as No until they answer
 *   again), a deleted account (its consent rows go with it), and a member
 *   who says yes after being left out all change who may be read without a
 *   No being given. The reconcile compares, per chapter, who the index holds
 *   and who it left out with who says yes now, and rebuilds the windows that
 *   differ.
 *
 * Retrieval already withholds a passage by anyone who no longer says yes, so
 * the window between a change and its rebuild never serves their words.
 */
@Injectable()
export class ChatCorpusConsentService implements OnModuleInit {
  private readonly logger = new Logger(ChatCorpusConsentService.name);

  constructor(
    private readonly consent: AiConsentService,
    @Inject(CORPUS_REPOSITORY) private readonly corpus: ICorpusRepository,
  ) {}

  onModuleInit(): void {
    this.consent.onConsentWithdrawn(async (userId) => {
      await this.corpus.requeueChatByAuthors([userId], null);
    });
  }

  /**
   * Returns how many windows were put back in line. A chapter that fails
   * does not stop the others; once every chapter has had its turn, the
   * failure is thrown so the cron reports it.
   */
  async reconcile(): Promise<number> {
    let requeued = 0;
    let failed = 0;
    for (const chapterId of await this.corpus.chatCorpusChapters()) {
      try {
        const { indexed, leftOut } =
          await this.corpus.chatCorpusAuthors(chapterId);
        const yes = await this.consent.chatAuthorsWhoSaidYes(chapterId, [
          ...new Set([...indexed, ...leftOut]),
        ]);
        const changed = [
          // Held, and no longer saying yes: their words go.
          ...indexed.filter((id) => !yes.has(id)),
          // Left out, and saying yes now: their words come in.
          ...leftOut.filter((id) => yes.has(id)),
        ];
        if (changed.length > 0) {
          requeued += await this.corpus.requeueChatByAuthors(
            [...new Set(changed)],
            chapterId,
          );
        }
      } catch (error) {
        // One chapter's failure must not stop the others' purge.
        failed += 1;
        this.logger.warn(
          `Chat index reconcile failed for a chapter: ${
            error instanceof Error ? error.name : 'unknown error'
          }`,
        );
      }
    }
    if (failed > 0) {
      throw new Error(
        `Chat index reconcile failed for ${failed} chapter(s); ${requeued} windows re-queued`,
      );
    }
    return requeued;
  }
}
