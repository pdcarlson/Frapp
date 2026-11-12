import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Meeting } from '#domain/entities/meeting.entity';
import { isAiEnabled } from '#domain/utils/ai-enabled';
import {
  actionItemsText,
  taskProposalsFromMinutes,
} from '#domain/utils/minutes-task-proposals';
import { AiConsentService } from './ai/ai-consent.service';
import {
  AiSuggestionService,
  type ReconcileAiSuggestionsResult,
} from './ai-suggestion.service';
import { MeetingService } from './meeting.service';

/**
 * Suggested tasks from minutes (#4313, `spec/behavior/meetings.md`
 * § Suggested tasks). When minutes are posted, each action item becomes a
 * suggested task an officer accepts, changes or dismisses; nothing is a task
 * until they do (ADR-28 decision 11).
 *
 * - **Posted minutes only.** A draft is its author's, and its action items
 *   are still being written.
 * - **No model call** (`minutes-task-proposals.ts` says why), so hand-written
 *   minutes get suggestions exactly as drafted ones do, and there is no
 *   member's Yes to ask for: nothing leaves Frapp.
 * - **Off unless** the server has AI on and the president has meeting notes
 *   on, like every other AI entry point on the minutes.
 * - **Follows edits.** Saving posted minutes again takes back a waiting
 *   suggestion whose action item was removed, replaces one whose owner or
 *   day changed, and proposes an item that is new. An item already accepted
 *   or dismissed is never proposed again.
 * - **One push**, when the minutes post, to the officer who posted them, and
 *   only if they could accept one. Edits afterwards tell nobody, as they tell
 *   nobody about the minutes.
 */
@Injectable()
export class MeetingTaskSuggestionsService implements OnModuleInit {
  constructor(
    private readonly meetings: MeetingService,
    private readonly suggestions: AiSuggestionService,
    private readonly consent: AiConsentService,
  ) {}

  onModuleInit(): void {
    this.meetings.onPostedMinutesSaved(async (meeting, change) => {
      await this.sync(meeting, change);
    });
  }

  async sync(
    meeting: Meeting,
    change: { reason: 'posted' | 'edited'; actorId: string },
  ): Promise<ReconcileAiSuggestionsResult | null> {
    if (meeting.status !== 'posted' || !isAiEnabled()) return null;
    if (
      !(await this.consent.chapterSwitchOn(meeting.chapter_id, 'meeting_notes'))
    ) {
      return null;
    }
    return this.suggestions.reconcileSource({
      chapterId: meeting.chapter_id,
      requestedFor: change.actorId,
      source: {
        type: 'meeting',
        id: meeting.id,
        title: meeting.event_name,
        text: actionItemsText(meeting.content),
      },
      kind: 'task',
      proposals: taskProposalsFromMinutes(meeting.content, meeting.event_name),
      notify: change.reason === 'posted' ? [change.actorId] : [],
    });
  }
}
