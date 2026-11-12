import { NotFoundException } from '@nestjs/common';
import { AiEnabledGuard } from './ai-enabled.guard';

describe('AiEnabledGuard', () => {
  const original = process.env.AI_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = original;
  });

  it.each([undefined, '', 'false', '0', 'TRUE', 'yes'])(
    'answers 404 ai.not_available when AI_ENABLED is %p',
    (value) => {
      if (value === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = value;
      expect(() => new AiEnabledGuard().canActivate()).toThrow(
        NotFoundException,
      );
      try {
        new AiEnabledGuard().canActivate();
      } catch (error) {
        expect((error as NotFoundException).getResponse()).toMatchObject({
          code: 'ai.not_available',
        });
      }
    },
  );

  it.each(['true', '1'])(
    'lets the request through when AI_ENABLED is %p, as the job queue does',
    (value) => {
      process.env.AI_ENABLED = value;
      expect(new AiEnabledGuard().canActivate()).toBe(true);
    },
  );
});
