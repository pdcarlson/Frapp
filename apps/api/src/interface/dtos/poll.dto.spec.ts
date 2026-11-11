import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { CreatePollDto } from './poll.dto';

/**
 * `expires_at` must be a date the poll-expiry sweep can read (#3498): an
 * unparseable one was stored, then logged every five minutes for a day.
 */
describe('CreatePollDto.expires_at', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const valid = {
    question: 'Formal theme?',
    options: ['Gatsby', 'Masquerade'],
  };
  const validate = (body: object) =>
    pipe.transform(body, { type: 'body', metatype: CreatePollDto });

  it('accepts an ISO 8601 timestamp, or none', async () => {
    await expect(
      validate({ ...valid, expires_at: '2026-11-12T18:00:00.000Z' }),
    ).resolves.toBeInstanceOf(CreatePollDto);
    await expect(validate(valid)).resolves.toBeInstanceOf(CreatePollDto);
  });

  it('refuses a string that is not a date', async () => {
    await expect(
      validate({ ...valid, expires_at: 'next tuesday' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
