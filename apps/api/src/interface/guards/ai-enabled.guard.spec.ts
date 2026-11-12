import { NotFoundException } from '@nestjs/common';
import { AiEnabledGuard } from './ai-enabled.guard';

describe('AiEnabledGuard', () => {
  const original = process.env.AI_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = original;
  });

  it('lets the request through when the server switch is on', () => {
    process.env.AI_ENABLED = 'true';
    expect(new AiEnabledGuard().canActivate()).toBe(true);
  });

  it.each([undefined, 'false', ''])(
    'answers 404 ai.disabled when AI_ENABLED is %p',
    (value) => {
      if (value === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = value;

      let thrown: unknown;
      try {
        new AiEnabledGuard().canActivate();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect((thrown as NotFoundException).getResponse()).toEqual({
        code: 'ai.disabled',
        message: 'AI features are not available.',
      });
    },
  );
});
