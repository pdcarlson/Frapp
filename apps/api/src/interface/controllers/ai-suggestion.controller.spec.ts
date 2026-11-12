import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { AiSuggestion } from '#domain/entities/ai-suggestion.entity';
import { AiSuggestionController } from './ai-suggestion.controller';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { AiSuggestionDto } from '../dtos/ai-suggestion.dto';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const MEETING = '33333333-3333-4333-8333-333333333333';

const row = (overrides: Partial<AiSuggestion> = {}): AiSuggestion => ({
  id: '44444444-4444-4444-8444-444444444444',
  chapter_id: CHAPTER,
  batch_id: '55555555-5555-4555-8555-555555555555',
  ordinal: 0,
  run_id: null,
  requested_for: USER,
  kind: 'task',
  source_type: 'meeting',
  source_id: MEETING,
  payload: { title: 'Book the venue', subtasks: [] },
  quote: 'book the venue',
  quote_author_id: null,
  required_permission: 'tasks:manage',
  status: 'pending',
  edited: false,
  decided_by: null,
  decided_at: null,
  result_id: null,
  notified_at: null,
  expires_at: '2026-11-26T12:00:00.000Z',
  created_at: '2026-11-12T12:00:00.000Z',
  ...overrides,
});

describe('AiSuggestionController (#4309)', () => {
  it('is off unless AI is on: the AI guard runs before sign-in', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AiSuggestionController),
    ).toEqual([
      AiEnabledGuard,
      SupabaseAuthGuard,
      ChapterGuard,
      PermissionsGuard,
    ]);
  });

  it('wants source_type and source_id together', async () => {
    const listForUser = jest.fn(async () => ({ items: [], has_more: false }));
    const controller = new AiSuggestionController({ listForUser } as never);
    await expect(
      controller.list(CHAPTER, USER, null, { source_type: 'meeting' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(listForUser).not.toHaveBeenCalled();

    await controller.list(CHAPTER, USER, null, {
      source_type: 'meeting',
      source_id: MEETING,
    });
    expect(listForUser).toHaveBeenCalledWith(CHAPTER, USER, {
      source: { type: 'meeting', id: MEETING },
      enabledModules: null,
    });
  });

  describe('AiSuggestionDto.from', () => {
    it('shows the task and quote while it waits', () => {
      const dto = AiSuggestionDto.from(row());
      expect(dto.task?.title).toBe('Book the venue');
      expect(dto.quote).toBe('book the venue');
    });

    it.each(['accepting', 'accepted', 'dismissed', 'expired'] as const)(
      'shows no text once %s',
      (status) => {
        const dto = AiSuggestionDto.from(row({ status }));
        expect(dto.task).toBeNull();
        expect(dto.quote).toBeNull();
      },
    );
  });
});
