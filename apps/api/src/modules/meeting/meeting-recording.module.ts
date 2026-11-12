import { Module } from '@nestjs/common';
import { MeetingRecordingService } from '../../application/services/meeting-recording.service';
import { MeetingRecordingSweepService } from '../../application/workers/meeting-recording-sweep.service';
import { MeetingRecordingController } from '../../interface/controllers/meeting-recording.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { SupabaseMeetingRecordingRepository } from '../../infrastructure/supabase/repositories/supabase-meeting-recording.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { MEETING_RECORDING_REPOSITORY } from '#domain/repositories/meeting-recording.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { RbacModule } from '../rbac/rbac.module';
import { AiModule } from '../ai/ai.module';
import { AiRunsModule } from '../ai-runs/ai-runs.module';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { MeetingModule } from './meeting.module';

/**
 * A meeting's uploaded recording, transcribed (#712). Its own module, beside
 * drafting from notes (`MeetingDraftModule`), so the hand-written minutes
 * (`MeetingModule`) load nothing of AI or storage.
 */
@Module({
  imports: [
    // Who may edit which minutes, and who was at the meeting.
    MeetingModule,
    RbacModule,
    AiModule,
    AiRunsModule,
    // The officer is told at once when the chapter or they have not said yes.
    AiConsentModule,
  ],
  controllers: [MeetingRecordingController],
  providers: [
    MeetingRecordingService,
    MeetingRecordingSweepService,
    AiEnabledGuard,
    {
      provide: MEETING_RECORDING_REPOSITORY,
      useClass: SupabaseMeetingRecordingRepository,
    },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
})
export class MeetingRecordingModule {}
