import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import type { AiGatewayService } from '../ai/ai-gateway.service';
import {
  ASK_DICTATION_CLOSE,
  ASK_DICTATION_OPEN,
  ASK_DICTATION_PROMPT_VERSION,
  ASK_DICTATION_SYSTEM,
} from './ask-dictation-prompt';
import { AskDictationService, dictationCeiling } from './ask-dictation.service';

const SAID = 'um so when is the uh chapter meeting thursday no friday';
const CLEANED = 'When is the chapter meeting Friday?';

function build(result: unknown) {
  const generateObject =
    result instanceof Error
      ? jest.fn().mockRejectedValue(result)
      : jest.fn().mockResolvedValue(result);
  const service = new AskDictationService({
    generateObject,
  } as unknown as AiGatewayService);
  return { service, generateObject };
}

const clean = (service: AskDictationService, text = `  ${SAID}  `) =>
  service.clean({ chapterId: 'chapter-1', userId: 'user-1', text });

describe('AskDictationService', () => {
  it('hands back the cleaned words', async () => {
    const { service, generateObject } = build({
      status: 'ok',
      value: { text: `  ${CLEANED} ` },
    });
    await expect(clean(service)).resolves.toBe(CLEANED);
    expect(generateObject).toHaveBeenCalledWith(
      'ask.dictation',
      expect.objectContaining({
        promptVersion: ASK_DICTATION_PROMPT_VERSION,
        system: ASK_DICTATION_SYSTEM,
      }),
      { chapterId: 'chapter-1', actingUserId: 'user-1' },
    );
  });

  it('sends the words as fenced data in the user turn, never in the system prompt', async () => {
    const { service, generateObject } = build({
      status: 'ok',
      value: { text: CLEANED },
    });
    await clean(service);
    const [, prompt] = generateObject.mock.calls[0];
    expect(prompt.system).not.toContain(SAID);
    expect(prompt.messages).toEqual([
      {
        role: 'user',
        content: expect.stringContaining(
          `${ASK_DICTATION_OPEN}\n${SAID}\n${ASK_DICTATION_CLOSE}`,
        ),
      },
    ]);
  });

  it.each([
    ['a provider refusal', { status: 'refused', category: 'policy' }],
    ['a reply that is not the schema', { status: 'invalid_output' }],
    [
      'a spend cap',
      { status: 'unavailable', reason: 'spend_cap', detail: 'member_cap' },
    ],
    [
      'a thrown provider error',
      new LanguageModelError('overloaded', 'anthropic'),
    ],
  ])('keeps the words as said, trimmed, on %s', async (_, result) => {
    const { service } = build(result);
    await expect(clean(service)).resolves.toBe(SAID);
  });

  it('lets an error that is not the provider’s through', async () => {
    const { service } = build(new Error('database down'));
    await expect(clean(service)).rejects.toThrow('database down');
  });

  it.each([
    ['chapter_off', 'ai.chapter_off'],
    ['member_declined', 'ai.consent.required'],
  ])('refuses consent (%s) as every AI route does', async (detail, code) => {
    const { service } = build({
      status: 'unavailable',
      reason: 'consent',
      detail,
    });
    const error = await clean(service).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code,
    });
  });

  it.each(['disabled', 'not_configured'])(
    'answers ai.not_available when the gateway is %s',
    async (reason) => {
      const { service } = build({ status: 'unavailable', reason });
      const error = await clean(service).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'ai.not_available',
      });
    },
  );

  describe('the safety check', () => {
    it('keeps the words as said when the cleanup is empty', async () => {
      const { service } = build({ status: 'ok', value: { text: '   ' } });
      await expect(clean(service)).resolves.toBe(SAID);
    });

    it('keeps the words as said when the model wrote far more than was said', async () => {
      const answer = 'x'.repeat(Math.floor(dictationCeiling(SAID)) + 1);
      const { service } = build({ status: 'ok', value: { text: answer } });
      await expect(clean(service)).resolves.toBe(SAID);
    });

    it('lets a cleanup up to the ceiling through', async () => {
      const longest = 'x'.repeat(Math.floor(dictationCeiling(SAID)));
      const { service } = build({ status: 'ok', value: { text: longest } });
      await expect(clean(service)).resolves.toBe(longest);
    });

    it('sets the ceiling at a quarter more than was said, plus 40', () => {
      expect(dictationCeiling('a'.repeat(100))).toBe(165);
      expect(dictationCeiling('')).toBe(40);
    });
  });
});
