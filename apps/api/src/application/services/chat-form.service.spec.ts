import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatFormService } from './chat-form.service';
import { FormResponseRefusedError } from '#domain/repositories/chat-form-response.repository.interface';
import type { ChatMessage } from '#domain/entities/chat.entity';

describe('ChatFormService (#3926 step 3)', () => {
  const form = {
    id: 'msg-1',
    channel_id: 'chan-1',
    kind: 'form',
    is_deleted: false,
    payload: {
      title: 'Room picks',
      questions: [
        { id: 'name', type: 'short_answer', title: 'Name', required: true },
        {
          id: 'room',
          type: 'multiple_choice',
          title: 'Room',
          options: [{ id: 'a', label: 'A' }],
        },
      ],
    },
  } as unknown as ChatMessage;

  const row = {
    message_id: 'msg-1',
    user_id: 'user-1',
    answers: { name: 'Sam' },
    created_at: '2026-11-13T00:00:00Z',
    updated_at: '2026-11-13T01:00:00Z',
  };

  let repo: {
    findOwn: jest.Mock;
    findAnsweredMessageIds: jest.Mock;
    save: jest.Mock;
  };
  let access: { assertMessageAccess: jest.Mock };
  let service: ChatFormService;

  beforeEach(() => {
    repo = {
      findOwn: jest.fn(),
      findAnsweredMessageIds: jest.fn(),
      save: jest.fn().mockResolvedValue(row),
    };
    access = { assertMessageAccess: jest.fn().mockResolvedValue(form) };
    service = new ChatFormService(repo, access as never);
  });

  it('reads only the caller’s own answers, after the channel check', async () => {
    repo.findOwn.mockResolvedValue(row);
    await expect(
      service.getOwnResponse('msg-1', 'ch-1', 'user-1'),
    ).resolves.toEqual({
      answers: { name: 'Sam' },
      updated_at: row.updated_at,
    });
    expect(access.assertMessageAccess).toHaveBeenCalledWith(
      'msg-1',
      'ch-1',
      'user-1',
    );
    expect(repo.findOwn).toHaveBeenCalledWith('msg-1', 'user-1');
  });

  it('reads null before the caller answers, and on a deleted form', async () => {
    repo.findOwn.mockResolvedValue(null);
    await expect(
      service.getOwnResponse('msg-1', 'ch-1', 'user-1'),
    ).resolves.toBeNull();

    access.assertMessageAccess.mockResolvedValue({ ...form, is_deleted: true });
    repo.findOwn.mockClear();
    await expect(
      service.getOwnResponse('msg-1', 'ch-1', 'user-1'),
    ).resolves.toBeNull();
    expect(repo.findOwn).not.toHaveBeenCalled();
  });

  it('reads the caller’s answers back on a closed or past-end form', async () => {
    repo.findOwn.mockResolvedValue(row);
    for (const patch of [
      { closed_at: '2026-11-12T00:00:00Z', closed_by: 'user-9' },
      { closes_at: '2020-01-01T00:00:00Z' },
    ]) {
      access.assertMessageAccess.mockResolvedValue({
        ...form,
        payload: { ...(form.payload as object), ...patch },
      });
      await expect(
        service.getOwnResponse('msg-1', 'ch-1', 'user-1'),
      ).resolves.toEqual({
        answers: { name: 'Sam' },
        updated_at: row.updated_at,
      });
    }
  });

  it('refuses to read answers on a message that is not a form', async () => {
    access.assertMessageAccess.mockResolvedValue({ ...form, kind: 'signup' });
    await expect(
      service.getOwnResponse('msg-1', 'ch-1', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.findOwn).not.toHaveBeenCalled();
  });

  it('refuses a caller who cannot read the channel, reading nothing', async () => {
    access.assertMessageAccess.mockRejectedValue(
      new NotFoundException('Message not found'),
    );
    await expect(
      service.saveResponse('msg-1', 'ch-1', 'user-1', { name: 'Sam' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('saves checked answers', async () => {
    await expect(
      service.saveResponse('msg-1', 'ch-1', 'user-1', {
        name: ' Sam ',
        room: 'a',
      }),
    ).resolves.toEqual({
      answers: { name: 'Sam' },
      updated_at: row.updated_at,
    });
    expect(repo.save).toHaveBeenCalledWith('msg-1', 'user-1', {
      name: 'Sam',
      room: 'a',
    });
    // The `answer` check: refused in an archived channel or the audit log.
    expect(access.assertMessageAccess).toHaveBeenCalledWith(
      'msg-1',
      'ch-1',
      'user-1',
      'answer',
    );
  });

  it.each([
    [
      'a message that is not a form',
      { kind: 'signup' },
      'Message is not a form card',
    ],
    ['a deleted form', { is_deleted: true }, 'Cannot act on a deleted message'],
    [
      'a closed form',
      { payload: { ...form.payload, closed_at: '2026-01-01T00:00:00Z' } },
      'This form is closed',
    ],
    [
      'a form past its end time',
      { payload: { ...form.payload, closes_at: '2000-01-01T00:00:00Z' } },
      'This form is closed',
    ],
  ])('refuses %s, writing nothing', async (_, patch, message) => {
    access.assertMessageAccess.mockResolvedValue({ ...form, ...patch });
    await expect(
      service.saveResponse('msg-1', 'ch-1', 'user-1', { name: 'Sam' }),
    ).rejects.toThrow(message);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses answers that do not fit the questions', async () => {
    await expect(
      service.saveResponse('msg-1', 'ch-1', 'user-1', { room: 'a' }),
    ).rejects.toThrow('Answer every required question');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it.each([
    ['closed', 'This form is closed'],
    ['missing', 'Cannot act on a deleted message'],
  ] as const)(
    'reads a %s refusal under the lock as a 400',
    async (reason, message) => {
      repo.save.mockRejectedValue(new FormResponseRefusedError(reason));
      const result = service.saveResponse('msg-1', 'ch-1', 'user-1', {
        name: 'Sam',
      });
      await expect(result).rejects.toBeInstanceOf(BadRequestException);
      await expect(result).rejects.toThrow(message);
    },
  );
});
