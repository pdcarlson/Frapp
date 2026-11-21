import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { UpdateChatSidebarDto } from './chat-sidebar.dto';

/**
 * Through the production pipe, whose `enableImplicitConversion` would turn
 * `"false"` into `true` without `@IsStrictBoolean()`.
 */
describe('PATCH /v1/chat-sidebar takes only real booleans and a known sort (#2877)', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const transform = (value: object) =>
    pipe.transform(value, { type: 'body', metatype: UpdateChatSidebarDto });

  describe.each(['unread_only', 'hide_muted'])('%s', (field) => {
    it.each([null, 'false', 'true', 0, 1])('refuses %p', async (value) => {
      await expect(transform({ [field]: value })).rejects.toThrow();
    });

    it.each([true, false])('accepts %p as sent', async (value) => {
      await expect(transform({ [field]: value })).resolves.toEqual({
        [field]: value,
      });
    });
  });

  describe('sort', () => {
    it.each(['chapter', 'recent', 'alpha'])('accepts %p', async (value) => {
      await expect(transform({ sort: value })).resolves.toEqual({
        sort: value,
      });
    });

    it.each([null, 'newest', '', 1, true])('refuses %p', async (value) => {
      await expect(transform({ sort: value })).rejects.toThrow();
    });
  });

  it('accepts a body that leaves either filter out', async () => {
    await expect(transform({ hide_muted: true })).resolves.toEqual({
      hide_muted: true,
    });
  });
});
