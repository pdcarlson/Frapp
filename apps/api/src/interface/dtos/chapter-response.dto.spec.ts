import { DECORATORS } from '@nestjs/swagger';
import { SUBSCRIPTION_STATUSES } from '@repo/validation';
import {
  CurrentChapterResponseDto,
  UpdateChapterResponseDto,
} from './chapter-response.dto';

/**
 * `subscription_status` has one owner, `SUBSCRIPTION_STATUSES` in
 * `@repo/validation` (#4152). Both chapter response DTOs must publish exactly
 * that list, in that order, as their Swagger enum: the order is what
 * `apps/api/openapi.json` and the generated SDK union carry, so a hand-written
 * list here, even one with the same values reordered, is a contract change.
 */
describe('chapter response DTOs: subscription_status enum', () => {
  function swaggerEnum(dto: { prototype: object }): unknown {
    const meta = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      dto.prototype,
      'subscription_status',
    ) as { enum?: unknown } | undefined;
    return meta?.enum;
  }

  it.each([
    ['CurrentChapterResponseDto', CurrentChapterResponseDto],
    ['UpdateChapterResponseDto', UpdateChapterResponseDto],
  ])('%s publishes the @repo/validation list in order', (_name, dto) => {
    expect(swaggerEnum(dto)).toEqual([...SUBSCRIPTION_STATUSES]);
  });

  it('the owner list is the four states the published contract carries', () => {
    // A change here changes apps/api/openapi.json and every shipped client's
    // union, which `check:api-contract` and `check:api-breaking:shipped` gate
    // too; this pins it where the change is made.
    expect([...SUBSCRIPTION_STATUSES]).toEqual([
      'incomplete',
      'active',
      'past_due',
      'canceled',
    ]);
  });
});
