import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { aiConsentRefusal } from '../ai/ai-consent-refusal';
import { AiGatewayService } from '../ai/ai-gateway.service';
import {
  ASK_DICTATION_PROMPT_VERSION,
  ASK_DICTATION_SYSTEM,
  AskDictationOutputSchema,
  askDictationMessages,
} from './ask-dictation-prompt';

/**
 * The longest a cleanup may be, against what was said: tidying adds
 * punctuation and the odd digit, and takes words out. Anything longer is the
 * model answering or adding, and the member gets their own words instead.
 */
export function dictationCeiling(said: string): number {
  return said.length * 1.25 + 40;
}

/**
 * Dictation in Ask's field (#5276, `spec/behavior/ai.md` § Ask Frapp,
 * Dictation). The phone's own recogniser turns speech into words; this tidies
 * them (fillers and false starts out, punctuation in) through `ask.dictation`
 * and hands them back for the member to read, edit and send. Nothing sends
 * on its own.
 *
 * **Nothing the member said is lost.** A provider refusal, a reply that is
 * not the schema, a provider failure, a spend cap, or a cleanup that fails
 * the length check all answer with the words as they came, trimmed.
 *
 * Only consent refuses, as every AI route says it (`aiConsentRefusal`): the
 * gateway checks the Ask switch and the member's yes before the call, so a
 * member without Frapp AI on gets 403 and keeps their raw words on the phone.
 *
 * Nothing is stored, and no word of it is logged, traced or counted; the
 * gateway's ledger and usage event carry sizes and the prompt version only.
 */
@Injectable()
export class AskDictationService {
  private readonly logger = new Logger(AskDictationService.name);

  constructor(private readonly gateway: AiGatewayService) {}

  async clean(input: {
    chapterId: string;
    userId: string;
    text: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const said = input.text.trim();

    let result;
    try {
      result = await this.gateway.generateObject(
        'ask.dictation',
        {
          promptVersion: ASK_DICTATION_PROMPT_VERSION,
          system: ASK_DICTATION_SYSTEM,
          messages: askDictationMessages(said),
          schema: AskDictationOutputSchema,
          ...(input.signal ? { signal: input.signal } : {}),
        },
        { chapterId: input.chapterId, actingUserId: input.userId },
      );
    } catch (error) {
      if (!(error instanceof LanguageModelError)) throw error;
      // Its kind only: a `LanguageModelError` carries no provider text.
      this.logger.warn(`Dictation cleanup failed: ${error.kind}`);
      return said;
    }

    if (result.status === 'unavailable') {
      if (result.reason === 'consent') {
        // The gateway's consent denials are `chapter_off` and
        // `member_declined`; the helper names both as every AI route does.
        throw aiConsentRefusal(
          result.detail === 'chapter_off' ? 'chapter_off' : 'member_declined',
        );
      }
      if (result.reason === 'disabled' || result.reason === 'not_configured') {
        // The code `AiEnabledGuard` answers with: no AI here, hide the mic's
        // cleanup and keep the recogniser's words.
        throw new NotFoundException({
          code: 'ai.not_available',
          message: 'AI features are not available.',
        });
      }
      // A spend cap: no error code says it outside Ask's stream, and the
      // member's words are all they need.
      return said;
    }
    if (result.status !== 'ok') return said;

    const cleaned = result.value.text.trim();
    if (cleaned === '' || cleaned.length > dictationCeiling(said)) return said;
    return cleaned;
  }
}
