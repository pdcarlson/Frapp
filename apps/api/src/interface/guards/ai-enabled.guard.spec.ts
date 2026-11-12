import { NotFoundException } from '@nestjs/common';
import { AiEnabledGuard } from './ai-enabled.guard';

describe('AiEnabledGuard', () => {
  const original = process.env.AI_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = original;
  });

  it.each([undefined, '', 'false', '1', 'TRUE', 'yes'])(
    'answers 404 ai.disabled when AI_ENABLED is %p',
    (value) => {
      if (value === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = value;
      expect(() => new AiEnabledGuard().canActivate()).toThrow(
        NotFoundException,
      );
    },
  );

  it('lets the request through only when AI_ENABLED is exactly true', () => {
    process.env.AI_ENABLED = 'true';
    expect(new AiEnabledGuard().canActivate()).toBe(true);
  });
});
