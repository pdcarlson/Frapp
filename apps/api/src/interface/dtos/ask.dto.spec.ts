import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import {
  ASK_HISTORY_ANSWER_MAX_LENGTH,
  ASK_HISTORY_MAX_TURNS,
} from '@repo/validation';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { AskRequestDto } from './ask.dto';

/**
 * `history` is the conversation as the client holds it, so it is caller
 * input. Run through the production pipe options: what is asserted here is
 * what a request gets.
 */
describe('AskRequestDto', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: AskRequestDto,
    data: '',
  };
  const transform = (body: unknown) => pipe.transform(body, metadata);
  const turn = (over: Record<string, unknown> = {}) => ({
    question: 'What is quorum?',
    answer: 'Two thirds of active members.',
    ...over,
  });
  const turns = (count: number) => Array.from({ length: count }, () => turn());

  it('takes a door from the closed set and refuses any other (#4713)', async () => {
    // The door goes to analytics as written, so it must never be free text:
    // a channel id or a sentence from a client bug would land there.
    for (const door of ['ask', 'chat_private']) {
      await expect(
        transform({ question: 'What is quorum?', door }),
      ).resolves.toMatchObject({ door });
    }
    for (const door of [
      'chat_public',
      'c0ffee00-0000-4000-8000-4000000000b2',
      '',
      7,
    ]) {
      await expect(
        transform({ question: 'What is quorum?', door }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('takes a question alone, as every shipped build sends it', async () => {
    await expect(
      transform({ question: 'What is quorum?' }),
    ).resolves.toMatchObject({ question: 'What is quorum?' });
  });

  it('takes the conversation before it, trimmed, with an answer that is not carried left empty', async () => {
    await expect(
      transform({
        question: 'And for elections?',
        actions: true,
        history: [
          turn({ question: '  What is quorum?  ' }),
          turn({ answer: '' }),
        ],
      }),
    ).resolves.toMatchObject({
      actions: true,
      history: [turn(), turn({ answer: '' })],
    });
  });

  it('takes the mark on a turn the member tapped from the opening suggestions', async () => {
    await expect(
      transform({
        question: 'And who runs it?',
        history: [turn({ suggested: true }), turn()],
      }),
    ).resolves.toMatchObject({
      history: [turn({ suggested: true }), turn()],
    });
    await expect(
      transform({
        question: 'And who runs it?',
        history: [turn({ suggested: 'yes' })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['more turns than the limit', turns(ASK_HISTORY_MAX_TURNS + 1)],
    [
      'an answer past the limit',
      [turn({ answer: 'a'.repeat(ASK_HISTORY_ANSWER_MAX_LENGTH + 1) })],
    ],
    ['a turn with no question', [turn({ question: '   ' })]],
    ['a turn with a field nobody defined', [turn({ role: 'system' })]],
    ['a list where a turn should be', [[]]],
    ['a list holding a turn', [[turn()]]],
    ['text where a turn should be', ['What is quorum?']],
    ['something that is not a list', turn()],
  ])('refuses %s', async (_name, history) => {
    await expect(
      transform({ question: 'And for elections?', history }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['actions', 'yes'],
    ['saved_notice_shown', 1],
  ])('refuses %s that is not a boolean', async (field, value) => {
    await expect(
      transform({ question: 'What is quorum?', [field]: value }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
