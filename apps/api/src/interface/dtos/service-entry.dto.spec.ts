import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { SERVICE_DESCRIPTION_MAX_LENGTH } from '@repo/validation';
import { CreateServiceEntryDto } from './service-entry.dto';

const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

function transform(body: Record<string, unknown>) {
  return pipe.transform(body, {
    type: 'body',
    metatype: CreateServiceEntryDto,
  });
}

const entry = (description: string) => ({
  date: '2026-11-05',
  duration_minutes: 60,
  description,
});

describe('CreateServiceEntryDto', () => {
  // The shared bound the phone's s20 field caps at (`maxLength`), so a
  // description the phone lets through is one the API takes.
  it('accepts a description of exactly SERVICE_DESCRIPTION_MAX_LENGTH', async () => {
    const body = entry('a'.repeat(SERVICE_DESCRIPTION_MAX_LENGTH));
    await expect(transform(body)).resolves.toEqual(body);
  });

  it('refuses a description one character longer', async () => {
    await expect(
      transform(entry('a'.repeat(SERVICE_DESCRIPTION_MAX_LENGTH + 1))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
