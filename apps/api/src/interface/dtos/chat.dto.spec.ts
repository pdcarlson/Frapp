import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { LIST_QUERY_LIMIT_MAX } from '#domain/constants/list-query-limits';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { GetChannelMessagesQueryDto } from './chat.dto';

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
  // calls parseIsoInstant so 2026-02-30 becomes a 400 rather than Postgres 22008.
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
