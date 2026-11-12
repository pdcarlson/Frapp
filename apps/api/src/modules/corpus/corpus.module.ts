import { Module } from '@nestjs/common';
import { DOCUMENT_TEXT_EXTRACTOR } from '#domain/adapters/document-text-extractor.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { CHAPTER_DOCUMENT_REPOSITORY } from '#domain/repositories/chapter-document.repository.interface';
import { CORPUS_REPOSITORY } from '#domain/repositories/corpus.repository.interface';
import { MEETING_REPOSITORY } from '#domain/repositories/meeting.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { ChapterDocumentCorpusSource } from '../../application/services/corpus/chapter-document-corpus-source';
import { CorpusIngestService } from '../../application/services/corpus/corpus-ingest.service';
import { CorpusRetrievalService } from '../../application/services/corpus/corpus-retrieval.service';
import { CORPUS_SOURCE_ADAPTERS } from '../../application/services/corpus/corpus-source';
import { MeetingMinutesCorpusSource } from '../../application/services/corpus/meeting-minutes-corpus-source';
import { CorpusIndexSweepService } from '../../application/workers/corpus-index-sweep.service';
import { DocumentTextExtractor } from '../../infrastructure/extraction/document-text-extractor';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { SupabaseChapterDocumentRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-document.repository';
import { SupabaseCorpusRepository } from '../../infrastructure/supabase/repositories/supabase-corpus.repository';
import { SupabaseMeetingRepository } from '../../infrastructure/supabase/repositories/supabase-meeting.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { SupabaseUserRepository } from '../../infrastructure/supabase/repositories/supabase-user.repository';
import { AiModule } from '../ai/ai.module';
import { AiConsentSeamModule } from '../ai/ai-consent-seam.module';
import { AiRunsModule } from '../ai-runs/ai-runs.module';
import { MeetingModule } from '../meeting/meeting.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * The AI corpus (#720): the index of chapter documents and posted minutes,
 * the job that keeps it, and retrieval.
 *
 * It has no controller. A feature that answers from the chapter's records
 * (Ask, #450) imports this module and injects `CorpusRetrievalService`.
 *
 * A new source type is one more `CorpusSourceAdapter` in the
 * `CORPUS_SOURCE_ADAPTERS` list below (channel messages, #4314), plus its
 * name in `CORPUS_SOURCE_TYPES` and in the database check.
 */
@Module({
  imports: [
    AiModule,
    // The sweep asks the gateway's consent check before it queues a run.
    AiConsentSeamModule,
    AiRunsModule,
    // `MeetingService.canRead`, the one read rule for minutes.
    MeetingModule,
    RbacModule,
  ],
  providers: [
    CorpusIngestService,
    CorpusRetrievalService,
    CorpusIndexSweepService,
    ChapterDocumentCorpusSource,
    MeetingMinutesCorpusSource,
    {
      provide: CORPUS_SOURCE_ADAPTERS,
      useFactory: (
        documents: ChapterDocumentCorpusSource,
        minutes: MeetingMinutesCorpusSource,
      ) => [documents, minutes],
      inject: [ChapterDocumentCorpusSource, MeetingMinutesCorpusSource],
    },
    { provide: DOCUMENT_TEXT_EXTRACTOR, useClass: DocumentTextExtractor },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
    { provide: CORPUS_REPOSITORY, useClass: SupabaseCorpusRepository },
    {
      provide: CHAPTER_DOCUMENT_REPOSITORY,
      useClass: SupabaseChapterDocumentRepository,
    },
    { provide: MEETING_REPOSITORY, useClass: SupabaseMeetingRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: ROLE_REPOSITORY, useClass: SupabaseRoleRepository },
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
  ],
  exports: [CorpusRetrievalService],
})
export class CorpusModule {}
