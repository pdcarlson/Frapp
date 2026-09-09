import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { ListInvoicesQueryDto } from './financial-invoice.dto';

const VALID_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('ListInvoicesQueryDto', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

  async function transform(
    query: Record<string, unknown>,
  ): Promise<ListInvoicesQueryDto> {
    return pipe.transform(query, {
      type: 'query',
      metatype: ListInvoicesQueryDto,
    });
  }

  it('accepts an omitted user_id', async () => {
    await expect(transform({})).resolves.toEqual({});
  });

  it('accepts a UUID user_id', async () => {
    await expect(transform({ user_id: VALID_UUID })).resolves.toEqual({
      user_id: VALID_UUID,
    });
  });

  it('rejects a non-UUID user_id', async () => {
    await expect(transform({ user_id: 'not-a-uuid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
