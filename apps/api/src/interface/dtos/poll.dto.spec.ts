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

  it.each([
    'next tuesday',
    // ISO 8601 that `Date` can't parse.
    '2026-W46-4',
    '2026-316',
    '20261201',
    '20261112T1800Z',
    // No zone, so its instant depends on the server's.
    '2026-11-12T18:00:00',
    // Not a real day: `Date` rolls it to March 2.
    '2026-02-30T12:00:00Z',
  ])('refuses %s', async (expires_at) => {
    await expect(validate({ ...valid, expires_at })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts an offset, which PollService stores in UTC', async () => {
    await expect(
      validate({ ...valid, expires_at: '2026-11-12T18:00:00+05:00' }),
    ).resolves.toBeInstanceOf(CreatePollDto);
  });
});
