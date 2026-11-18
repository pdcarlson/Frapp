import {
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { readMeetingContent } from '@repo/validation';
import type { Meeting } from '#domain/entities/meeting.entity';
import { TaskStatus } from '#domain/entities/task.entity';
import {
  AI_SUGGESTION_REPOSITORY,
  type IAiSuggestionRepository,
} from '#domain/repositories/ai-suggestion.repository.interface';
import { isAiEnabled } from '#domain/utils/ai-enabled';
import {
  actionItemKey,
  actionItemsText,
  taskProposalsFromMinutes,
} from '#domain/utils/minutes-task-proposals';
import { AiConsentService } from './ai/ai-consent.service';
import {
  AiSuggestionService,
  type ReconcileAiSuggestionsResult,
} from './ai-suggestion.service';
import { MeetingService } from './meeting.service';
import { TaskService } from './task.service';

/**
 * Where an action item of posted minutes stands as a task: the minutes'
 * checkbox (Paul, 2026-11-18: "action items should be like checkboxes that
 * show updates as the tasks are actually checked off").
 */
export interface ActionItemTask {
  /** The action item's place in the minutes' list, from 0. */
  index: number;
  /** Marked done: by its member, or every copy of a task for everyone. */
  done: boolean;
  /** A task for everyone: how many of its copies are done. */
  group: { done: number; total: number } | null;
}

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
    private readonly tasks: TaskService,
    @Inject(AI_SUGGESTION_REPOSITORY)
    private readonly suggestionRepo: IAiSuggestionRepository,
  ) {}

  /**
   * The tasks the action items of these minutes became: one entry per item
   * an officer created as a task that still exists, with whether it is done.
   * An item matches its suggestion by the same fingerprint that keeps it
   * from being suggested twice, so an item tidied after posting keeps its
   * task. Only the done mark is told, never the task's own fields, because a
   * member may read the minutes without being able to read the task
   * (`tasks.md` § Visibility), and the minutes already say who owes it.
   */
  async actionItemTasks(
    chapterId: string,
    meetingId: string,
    viewerId: string,
  ): Promise<ActionItemTask[]> {
    // Throws for minutes the viewer may not read, as the minutes' own read.
    const { meeting } = await this.meetings.get(chapterId, meetingId, viewerId);
    if (meeting.status !== 'posted') return [];
    const items = readMeetingContent(meeting.content).action_items;
    if (items.length === 0) return [];
    const rows = await this.suggestionRepo.listKeyedForSource(
      chapterId,
      { type: 'meeting', id: meeting.id },
      'task',
    );
    const taskOf = new Map<string, string>();
    for (const row of rows) {
      if (row.status === 'accepted' && row.result_id && row.dedupe_key) {
        taskOf.set(row.dedupe_key, row.result_id);
      }
    }
    const wanted = items.map((item, index) => ({
      index,
      taskId: taskOf.get(actionItemKey(item.text.trim())),
    }));
    const found = await Promise.all(
      wanted.map(async ({ index, taskId }) => {
        if (!taskId) return null;
        try {
          const task = await this.tasks.findById(taskId, chapterId);
          const group = task.group
            ? { done: task.group.done, total: task.group.total }
            : null;
          return {
            index,
            done: group
              ? group.total > 0 && group.done >= group.total
              : task.stored_status === TaskStatus.COMPLETED,
            group,
          };
        } catch (error) {
          // A task deleted since: the item has no task to follow.
          if (error instanceof NotFoundException) return null;
          throw error;
        }
      }),
    );
    return found.filter((entry): entry is ActionItemTask => entry !== null);
  }

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
    // With the chapter's switch off nothing is proposed, and what was
    // waiting from before is taken back on this save: a list nobody is
    // keeping up with the minutes shouldn't be acceptable.
    const on = await this.consent.chapterSwitchOn(
      meeting.chapter_id,
      'meeting_notes',
    );
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
      proposals: on
        ? taskProposalsFromMinutes(meeting.content, meeting.event_name)
        : [],
      notify: on && change.reason === 'posted' ? [change.actorId] : [],
    });
  }
}
