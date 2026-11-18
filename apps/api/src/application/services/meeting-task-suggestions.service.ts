import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { readMeetingContent } from '@repo/validation';
import type { Meeting } from '#domain/entities/meeting.entity';
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

/** One posted minutes' open action items (`seriesOpenActionItems`). */
export interface SeriesOpenActionItems {
  meeting_id: string;
  event_start_time: string;
  items: {
    /** The item's place in its minutes' list, from 0. */
    index: number;
    text: string;
    owner_user_id: string | null;
    due_date: string | null;
    group: ActionItemTask['group'];
  }[];
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
   * from being suggested twice, so an item whose case, punctuation or
   * spacing is tidied after posting keeps its task; one reworded is a new
   * item to Frapp and loses its box. Only the done mark is told, never the task's own fields, because a
   * member may read the minutes without being able to read the task, and the
   * minutes already say who owes it (`tasks.md` § Visibility records this
   * exception).
   */
  async actionItemTasks(
    chapterId: string,
    meetingId: string,
    viewerId: string,
  ): Promise<ActionItemTask[]> {
    // Throws for minutes the viewer may not read, as the minutes' own read.
    const { meeting } = await this.meetings.get(chapterId, meetingId, viewerId);
    return this.marksFor(chapterId, meeting);
  }

  /**
   * The action items still open across one repeating meeting's posted
   * minutes, newest meeting first (#5482; Paul's pick, 2026-11-18: done comes
   * from Tasks). An item is open until the task it became is done; one
   * nobody made a task of stays open. Two items that read the same share one
   * task, so a later copy closes with the first. Only minutes the viewer may
   * read are looked at (the Minutes list's own read), and each minutes'
   * content and marks are read together, so they always agree.
   */
  async seriesOpenActionItems(
    chapterId: string,
    viewerId: string,
    seriesKey: string,
  ): Promise<SeriesOpenActionItems[]> {
    const { rows, facts } = await this.meetings.listWithFacts(
      chapterId,
      viewerId,
    );
    const series = rows.filter(
      (row) =>
        row.status === 'posted' && facts.get(row.id)?.series_key === seriesKey,
    );
    const result: SeriesOpenActionItems[] = [];
    for (const meeting of series) {
      const items = readMeetingContent(meeting.content).action_items;
      if (items.length === 0) continue;
      const marks = new Map(
        (await this.marksFor(chapterId, meeting)).map((mark) => [
          mark.index,
          mark,
        ]),
      );
      // A later copy of an item follows the first copy's task.
      const firstOf = new Map<string, number>();
      const open = items.flatMap((item, index) => {
        const key = actionItemKey(item.text.trim());
        const first = firstOf.get(key) ?? index;
        if (!firstOf.has(key)) firstOf.set(key, index);
        const mark = marks.get(first);
        if (mark?.done) return [];
        return [
          {
            index,
            text: item.text,
            owner_user_id: item.owner_user_id,
            due_date: item.due_date,
            group: mark?.group ?? null,
          },
        ];
      });
      if (open.length > 0) {
        result.push({
          meeting_id: meeting.id,
          event_start_time: meeting.event_start_time,
          items: open,
        });
      }
    }
    return result;
  }

  /** `actionItemTasks` for minutes already read under the viewer's rule. */
  private async marksFor(
    chapterId: string,
    meeting: Meeting,
  ): Promise<ActionItemTask[]> {
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
    // Two items that read the same were one suggestion, so one task: it
    // follows the first of them.
    const seen = new Set<string>();
    const wanted = items.flatMap((item, index) => {
      const key = actionItemKey(item.text.trim());
      const taskId = taskOf.get(key);
      if (!taskId || seen.has(key)) return [];
      seen.add(key);
      return [{ index, taskId }];
    });
    if (wanted.length === 0) return [];
    const marks = await this.tasks.doneMarks(
      chapterId,
      wanted.map((entry) => entry.taskId),
    );
    // A task deleted since leaves its item with nothing to follow.
    return wanted.flatMap(({ index, taskId }) => {
      const mark = marks.get(taskId);
      return mark ? [{ index, ...mark }] : [];
    });
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
