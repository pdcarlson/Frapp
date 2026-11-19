import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';

import { LIST_QUERY_LIMIT_MAX } from '#domain/constants/list-query-limits';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import {
  ListMessagesAttachmentsQueryDto,
  ChatMessageActionDto,
  CreateDmDto,
  CreateGroupDmDto,
  GetChannelMessagesQueryDto,
  SendMessageDto,
  SetChapterChatLevelDto,
  UpdateChannelDto,
} from './chat.dto';

const VALID_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VALID_ISO = '2026-04-01T12:00:00.000Z';

describe('GetChannelMessagesQueryDto', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

  async function transform(
    query: Record<string, unknown>,
  ): Promise<GetChannelMessagesQueryDto> {
    return pipe.transform(query, {
      type: 'query',
      metatype: GetChannelMessagesQueryDto,
    });
  }

  it('accepts omitted optional fields (limit default is applied in the service)', async () => {
    const result = await transform({});
    expect(result.limit).toBeUndefined();
    expect(result.before).toBeUndefined();
    expect(result.since).toBeUndefined();
  });

  it('accepts a valid limit, before ISO instant, and since UUID', async () => {
    await expect(
      transform({ limit: '25', before: VALID_ISO, since: VALID_UUID }),
    ).resolves.toEqual({
      limit: 25,
      before: VALID_ISO,
      since: VALID_UUID,
    });
  });

  it('rejects a non-numeric limit', async () => {
    await expect(transform({ limit: 'abc' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a zero limit', async () => {
    await expect(transform({ limit: '0' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a negative limit', async () => {
    await expect(transform({ limit: '-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a limit above the list-query ceiling', async () => {
    await expect(
      transform({ limit: String(LIST_QUERY_LIMIT_MAX + 1) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-ISO before cursor', async () => {
    await expect(
      transform({ before: 'not-an-instant' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a UUID used as before (before is an ISO timestamp)', async () => {
    await expect(transform({ before: VALID_UUID })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // Regex-valid, calendar-invalid: the pipe is the shape gate. ChatService
  // calls instantOrThrow (which parses through parseIsoInstant) so 2026-02-30
  // becomes a 400 rather than Postgres 22008.
  it('accepts a regex-shaped before that names a day that does not exist', async () => {
    await expect(
      transform({ before: '2026-02-30T00:00:00Z' }),
    ).resolves.toEqual(
      expect.objectContaining({ before: '2026-02-30T00:00:00Z' }),
    );
  });

  it('rejects a non-UUID since', async () => {
    await expect(transform({ since: 'not-a-uuid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

/**
 * `default_notification_level` (#2771) takes `null` as a value, not an
 * absence: it clears an officer's choice back to the built-in default. Run
 * through the real pipe, as `PATCH /v1/channels/:id` does, because the service
 * specs hand the service a plain object and never exercise the decorators.
 */
describe('UpdateChannelDto.default_notification_level', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const transform = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdateChannelDto });

  it.each(['all', 'mentions', 'off'])('accepts %s', async (level) => {
    await expect(
      transform({ default_notification_level: level }),
    ).resolves.toMatchObject({ default_notification_level: level });
  });

  it('accepts null, which clears it', async () => {
    await expect(
      transform({ default_notification_level: null }),
    ).resolves.toMatchObject({ default_notification_level: null });
  });

  it('leaves it out when omitted', async () => {
    const result = await transform({ name: 'general' });
    expect(result.default_notification_level).toBeUndefined();
  });

  it('rejects any other value', async () => {
    await expect(
      transform({ default_notification_level: 'loud' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UpdateChannelDto.is_default', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const transform = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdateChannelDto });

  it('accepts true and false, and absent', async () => {
    await expect(transform({ is_default: true })).resolves.toMatchObject({
      is_default: true,
    });
    await expect(transform({ is_default: false })).resolves.toMatchObject({
      is_default: false,
    });
    await expect(transform({})).resolves.toBeDefined();
  });

  it('refuses null, which would reach a not-null column', async () => {
    await expect(transform({ is_default: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SetChapterChatLevelDto (#3840)', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const transform = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: SetChapterChatLevelDto });

  it('accepts all and mentions', async () => {
    await expect(transform({ level: 'all' })).resolves.toBeDefined();
    await expect(transform({ level: 'mentions' })).resolves.toBeDefined();
  });

  // No "Off" (notifications.md § Chapter-wide chat level): the read could not
  // report a stored `off`, so the write must refuse it.
  it('refuses off', async () => {
    await expect(transform({ level: 'off' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

/** Run a body through the global pipe as the route would. */
function bodyTransform<T>(metatype: new () => T) {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  return (body: Record<string, unknown>): Promise<T> =>
    pipe.transform(body, { type: 'body', metatype });
}

describe('SendMessageDto metadata', () => {
  const transform = bodyTransform(SendMessageDto);
  const message = {
    client_message_id: VALID_UUID,
    content: 'Hello',
  };

  it('takes small client metadata', async () => {
    await expect(
      transform({ ...message, metadata: { draft_id: 'abc' } }),
    ).resolves.toBeDefined();
  });

  // Every reader of the channel downloads the row, so the field is bounded.
  it('refuses metadata over 16,384 characters as JSON', async () => {
    await expect(
      transform({ ...message, metadata: { blob: 'x'.repeat(16_400) } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChatMessageActionDto', () => {
  const transform = bodyTransform(ChatMessageActionDto);

  it.each([
    ['a reaction', { action_type: 'reaction:👍' }],
    ['a skin-toned reaction', { action_type: 'reaction:👍🏽' }],
    ['a vote', { action_type: 'vote', payload: { option_id: ['a', 'b'] } }],
    [
      'a sign-up claim with every slot of a full card',
      {
        action_type: 'signup',
        payload: {
          slot_ids: Array.from({ length: 20 }, (_, i) => `slot-${i}`),
          note: 'x'.repeat(140),
        },
      },
    ],
  ])('takes %s', async (_label, body) => {
    await expect(transform(body)).resolves.toBeDefined();
  });

  it.each([
    ['an action type no app sends', { action_type: 'rsvp' }],
    ['a reaction with no emoji', { action_type: 'reaction:' }],
    ['a reaction with a space', { action_type: 'reaction:a b' }],
    [
      'a payload over 4,096 characters as JSON',
      { action_type: 'vote', payload: { option_id: 'x'.repeat(4_100) } },
    ],
  ])('refuses %s', async (_label, body) => {
    await expect(transform(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreateGroupDmDto', () => {
  const transform = bodyTransform(CreateGroupDmDto);
  const ids = (count: number) =>
    Array.from(
      { length: count },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
    );

  // A group DM holds up to 10 people, the creator included.
  it('takes nine others', async () => {
    await expect(transform({ member_ids: ids(9) })).resolves.toBeDefined();
  });

  it('refuses ten others, in words a member can read', async () => {
    const refusal = await transform({ member_ids: ids(10) }).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(BadRequestException);
    expect(
      JSON.stringify((refusal as BadRequestException).getResponse()),
    ).toContain('A group DM holds up to 10 people, you included');
  });

  // A UUID is the same id in either case; the service compares strings.
  it('lowercases every id', async () => {
    const upper = 'AAAAAAAA-AAAA-4AAA-8AAA-00000000000B';
    await expect(transform({ member_ids: [upper] })).resolves.toMatchObject({
      member_ids: [upper.toLowerCase()],
    });
  });
});

describe('CreateDmDto', () => {
  const transform = bodyTransform(CreateDmDto);

  it('lowercases the id', async () => {
    const upper = 'AAAAAAAA-AAAA-4AAA-8AAA-00000000000B';
    await expect(transform({ member_id: upper })).resolves.toMatchObject({
      member_id: upper.toLowerCase(),
    });
  });

  it('still refuses something that is not an id', async () => {
    await expect(transform({ member_id: 'NOT-AN-ID' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

/**
 * The batched attachments read (#5667) takes its ids in the query string, so
 * it stays a GET: the `read` rate limit, and readable while a chapter's
 * subscription has lapsed. The 50-id cap keeps one answer under PostgREST's
 * 1000-row read cap; clients chunk at the same size.
 */
describe('ListMessagesAttachmentsQueryDto', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ListMessagesAttachmentsQueryDto,
    data: '',
  };
  const transform = (query: unknown) => pipe.transform(query, metadata);
  const id = (n: number) =>
    `3f0c1d9e-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('splits a comma-separated list and drops repeats', async () => {
    await expect(
      transform({ message_ids: `${id(1)},${id(2)},${id(1).toUpperCase()}` }),
    ).resolves.toMatchObject({ message_ids: [id(1), id(2)] });
  });

  it('accepts 50 ids and refuses 51', async () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => id(i + 1)).join(',');
    await expect(transform({ message_ids: ids(50) })).resolves.toBeDefined();
    await expect(transform({ message_ids: ids(51) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses an empty list and a non-uuid', async () => {
    await expect(transform({ message_ids: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      transform({ message_ids: `${id(1)},not-an-id` }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
