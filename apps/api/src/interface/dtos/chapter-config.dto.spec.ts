import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { PatchChapterConfigDto } from './chapter-config.dto';

/**
 * `default_invite_role_id` (#422) is the one field on this DTO where `null` is
 * a *value* rather than an absence: it clears the chapter's default invite
 * role. That contract lives entirely in decorator metadata, and the service
 * specs construct the DTO object directly, so nothing else in the suite runs
 * this field through the real pipe.
 *
 * That gap is not hypothetical. `@IsOptional()` reads as redundant next to
 * `@ValidateIf((_o, v) => v !== null)` — but deleting it makes `undefined`
 * satisfy the `ValidateIf` condition, so **every** `PATCH /v1/chapters/:id/config`
 * that omits the field 400s with "must be a UUID", taking the whole settings
 * surface down. Verified by mutation while writing this file; the suite was
 * green throughout. These tests exist so that mutation fails loudly.
 *
 * The pipe is constructed from `VALIDATION_PIPE_OPTIONS` — the same object
 * `bootstrap.ts` registers globally — so `whitelist` / `forbidNonWhitelisted`
 * / `transform` behave here exactly as they do in production.
 */
describe('PatchChapterConfigDto — default_invite_role_id (#422)', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: PatchChapterConfigDto,
  };

  const transform = (payload: unknown) => pipe.transform(payload, metadata);

  const UUID = '3f1a5c2e-8b4d-4a6f-9c1e-2d7b8a9f0c31';

  it('accepts a uuid', async () => {
    await expect(transform({ default_invite_role_id: UUID })).resolves.toEqual(
      expect.objectContaining({ default_invite_role_id: UUID }),
    );
  });

  /*
   * The load-bearing case. `whitelist: true` strips unknown properties, so a
   * null that failed to register as a known property would vanish silently and
   * `patchConfig` would read it as "leave the default alone" — turning a clear
   * into a no-op with no error anywhere.
   */
  it('accepts an explicit null and keeps the key, so a clear is distinguishable from an omission', async () => {
    const result = (await transform({
      default_invite_role_id: null,
    })) as PatchChapterConfigDto;

    expect(result).toHaveProperty('default_invite_role_id');
    expect(result.default_invite_role_id).toBeNull();
  });

  it('accepts a payload that omits the field entirely', async () => {
    await expect(transform({ analytics_opt_out: true })).resolves.toEqual(
      expect.objectContaining({ analytics_opt_out: true }),
    );
  });

  it('accepts an empty patch', async () => {
    await expect(transform({})).resolves.toBeDefined();
  });

  it('rejects a non-uuid string', async () => {
    await expect(
      transform({ default_invite_role_id: 'not-a-uuid' }),
    ).rejects.toThrow();
  });

  it('rejects an empty string, which would otherwise reach the role lookup', async () => {
    await expect(transform({ default_invite_role_id: '' })).rejects.toThrow();
  });
});

/**
 * #1817. Top-level patch fields are omit-or-value, never `null`. `@IsOptional()`
 * used to skip `null`, so the pipe accepted `{ branding: null }` and
 * `patchConfig` then 500'd against jsonb / boolean `not null` columns.
 *
 * `analytics_opt_out` is the same mechanism as `org_archetype` (scalar NOT NULL
 * + `!== undefined` write) and is included even though the issue listed only
 * the nested blocks.
 *
 * `default_invite_role_id` is the opposite contract (#422) and stays nullable.
 */
describe('PatchChapterConfigDto — explicit null on nested blocks (#1817)', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: PatchChapterConfigDto,
  };

  const transform = (payload: unknown) => pipe.transform(payload, metadata);

  const NULL_BLOCKS = [
    'org_archetype',
    'enabled_modules',
    'vocabulary',
    'branding',
    'beta_config',
    'dues',
    'service',
    'workflows',
    'points',
    'analytics_opt_out',
  ] as const;

  const expectPropertyNamed400 = async (payload: unknown, property: string) => {
    const err = await transform(payload).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    const response = (err as BadRequestException).getResponse();
    const text =
      typeof response === 'string' ? response : JSON.stringify(response);
    expect(text).toContain(property);
  };

  it.each(NULL_BLOCKS)(
    'rejects an explicit null on %s and names the property',
    async (property) => {
      await expectPropertyNamed400({ [property]: null }, property);
    },
  );

  it('accepts an empty patch', async () => {
    await expect(transform({})).resolves.toBeDefined();
  });

  it('accepts a payload that omits the nested blocks', async () => {
    await expect(transform({ analytics_opt_out: true })).resolves.toEqual(
      expect.objectContaining({ analytics_opt_out: true }),
    );
  });

  it('still accepts an explicit null on default_invite_role_id (#422)', async () => {
    const result = (await transform({
      default_invite_role_id: null,
    })) as PatchChapterConfigDto;

    expect(result).toHaveProperty('default_invite_role_id');
    expect(result.default_invite_role_id).toBeNull();
  });

  it('still accepts a present nested block', async () => {
    await expect(transform({ branding: {} })).resolves.toEqual(
      expect.objectContaining({ branding: {} }),
    );
  });
});
