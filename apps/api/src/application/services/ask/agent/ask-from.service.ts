import { Injectable, Logger } from '@nestjs/common';
import {
  eventLimitsAudience,
  isModuleEnabled,
  type AskFrom,
} from '@repo/validation';
import type { LanguageModelSource } from '#domain/adapters/language-model.interface';
import { SystemPermissions, WILDCARD } from '#domain/constants/permissions';
import type { AskGivenRef } from '#domain/utils/ai-report-receipt';
import { EventService } from '../../event.service';
import { TaskService } from '../../task.service';
import { oneLine } from '../ask-lines';
import type { AgentToolContext } from './agent-tool';
import { ASK_FROM_SOURCE_TITLE } from './ask-agent-prompt';
import { quoted } from './tools-chapter/chapter-tool-kit';
import { eventHeadline } from './tools-chapter/event-lines';
import { whenDue } from './tools-chapter/task-lines';
import { ConversationScope } from './tools-conversations/conversation-scope';

/** One thing the member had open, as the model reads it. */
export interface AskFromPart {
  /** Read beside the question like the asker block: never cited. */
  source: LanguageModelSource;
  /** Who else may open it, for a post to a channel (#4713). */
  ref: AskGivenRef;
  /** What the asker is shown when it holds a post back. */
  label: string;
}

/**
 * What the member had open when they asked (#4899): the channel they typed
 * in, or the event or task on screen, so "this channel", "here" and "this
 * event" mean something.
 *
 * **The app sends ids, and an id proves nothing.** Each is looked up as the
 * asker through the read its own screen uses, and one they cannot open is
 * dropped without a word: the channel must be in their channel list
 * (`GET /v1/channels`), the event must be one their calendar shows
 * (`GET /v1/events/:id`), and the task theirs or one a `tasks:manage`
 * holder may open (`GET /v1/tasks/:id`). So an id here can show a model
 * nothing its member could not see, and nothing about whether it exists
 * (`docs/security/ai-prompt-injection.md` C2).
 *
 * What a model gets is a name and, for an event or a task, when it is: the
 * least that makes "this" mean something. Anything more it reads with a
 * tool, as the asker, and cites. A read that fails means an answer that
 * does not know where it was asked from, never no answer.
 */
@Injectable()
export class AskFromService {
  private readonly logger = new Logger(AskFromService.name);

  constructor(
    private readonly scope: ConversationScope,
    private readonly events: EventService,
    private readonly tasks: TaskService,
  ) {}

  async read(
    from: AskFrom | null | undefined,
    context: AgentToolContext,
  ): Promise<AskFromPart[]> {
    const held = context.permissions;
    // Every screen an id can come from is behind `members:view`.
    if (
      !from ||
      (!held.has(WILDCARD) && !held.has(SystemPermissions.MEMBERS_VIEW))
    ) {
      return [];
    }
    const parts = await Promise.all([
      this.part('channel', from.channel_id, () =>
        this.channel(from.channel_id!, context),
      ),
      this.part(
        'event',
        isModuleEnabled(context.enabledModules, 'events')
          ? from.event_id
          : undefined,
        () => this.event(from.event_id!, context),
      ),
      this.part(
        'task',
        isModuleEnabled(context.enabledModules, 'tasks')
          ? from.task_id
          : undefined,
        () => this.task(from.task_id!, context),
      ),
    ]);
    return parts.flatMap((part) => part ?? []);
  }

  /** One lookup, which never takes the answer down with it. */
  private async part(
    what: string,
    id: string | undefined,
    read: () => Promise<AskFromPart | null>,
  ): Promise<AskFromPart | null> {
    if (!id) return null;
    try {
      return await read();
    } catch (error) {
      // Not found and not allowed look the same from here, on purpose.
      this.logger.debug(
        `Ask: the ${what} asked from was not read (${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
      return null;
    }
  }

  private async channel(
    id: string,
    context: AgentToolContext,
  ): Promise<AskFromPart | null> {
    const channel = (await this.scope.openChannels(context)).find(
      (open) => open.id === id,
    );
    const name = oneLine(channel?.name);
    if (!channel || !name) return null;
    return {
      source: {
        id: 'from:channel',
        title: `${ASK_FROM_SOURCE_TITLE}: a channel`,
        text: `The member is asking from the channel #${name}. "This channel" and "here" mean #${name}.`,
      },
      // Everyone who reads that channel knows its name; nobody else is
      // taken to.
      ref: { type: 'channel', id: channel.id },
      label: 'The channel you asked from',
    };
  }

  private async event(
    id: string,
    context: AgentToolContext,
  ): Promise<AskFromPart | null> {
    const event = await this.events.findById(
      id,
      context.chapterId,
      context.userId,
    );
    return {
      source: {
        id: 'from:event',
        title: `${ASK_FROM_SOURCE_TITLE}: an event`,
        text: `The member has this event open: ${eventHeadline(event, context)}. "This event" means it. To read more of it, open the event with the id event:${event.id}.`,
      },
      ref: {
        type: 'tool',
        name: 'from:event',
        reach: 'events',
        ...(eventLimitsAudience(event) ? { events: [event.id] } : {}),
      },
      label: 'The event you had open',
    };
  }

  private async task(
    id: string,
    context: AgentToolContext,
  ): Promise<AskFromPart | null> {
    const task = await this.tasks.findById(id, context.chapterId);
    const held = context.permissions;
    if (
      task.assignee_id !== context.userId &&
      !held.has(WILDCARD) &&
      !held.has(SystemPermissions.TASKS_MANAGE)
    ) {
      return null;
    }
    const whose =
      task.assignee_id === context.userId
        ? 'It is their own task.'
        : 'It is assigned to someone else.';
    return {
      source: {
        id: 'from:task',
        title: `${ASK_FROM_SOURCE_TITLE}: a task`,
        text: `The member has this task open: ${quoted(task.title)}, due ${whenDue(task, context.timeZone)}. ${whose} "This task" means it.`,
      },
      // A task is its assignee's and the officers', never the channel's.
      ref: { type: 'tool', name: 'from:task', reach: 'asker' },
      label: 'The task you had open',
    };
  }
}
