import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SystemPermissions } from '#domain/constants/permissions';
import { MeetingDraftController } from './meeting-draft.controller';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { REQUIRED_MODULE_KEY } from '../decorators/module.decorator';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const MEETING = '33333333-3333-4333-8333-333333333333';

describe('MeetingDraftController (#4312)', () => {
  it('is off unless AI is on: the AI guard runs before sign-in', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MeetingDraftController),
    ).toEqual([
      AiEnabledGuard,
      SupabaseAuthGuard,
      ChapterGuard,
      PermissionsGuard,
    ]);
  });

  it('asks for meetings:record and the meetings module on every route', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MeetingDraftController),
    ).toEqual([SystemPermissions.MEETINGS_RECORD]);
    expect(
      Reflect.getMetadata(REQUIRED_MODULE_KEY, MeetingDraftController),
    ).toBe('meetings');
  });

  it('only stops a draft when asked to keep the notes', async () => {
    const discard = jest.fn().mockResolvedValue(undefined);
    const controller = new MeetingDraftController({ discard } as never);
    await controller.discard(CHAPTER, USER, MEETING, 'true');
    expect(discard).toHaveBeenLastCalledWith(CHAPTER, MEETING, USER, {
      keepNotes: true,
    });
    await controller.discard(CHAPTER, USER, MEETING);
    expect(discard).toHaveBeenLastCalledWith(CHAPTER, MEETING, USER, {
      keepNotes: false,
    });
  });
});
