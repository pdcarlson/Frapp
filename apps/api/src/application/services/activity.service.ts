import { Inject, Injectable, Logger } from '@nestjs/common';
import { can, checkInWindowBounds, isModuleEnabled } from '@repo/validation';
import {
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import type {
  IChatMessageActionRepository,
  IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type { ChannelType, ChatMessage } from '#domain/entities/chat.entity';
import type { Event } from '#domain/entities/event.entity';
import type { ServiceEntry } from '#domain/entities/service-entry.entity';
import { TaskStatus } from '#domain/entities/task.entity';
import type { TaskView } from '#domain/entities/task.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { AttendanceService } from './attendance.service';
import { BackworkService } from './backwork.service';
import { ChapterDocumentService } from './chapter-document.service';
import { ChatBlockService } from './chat-block.service';
import { ChatService } from './chat.service';
import { EventService } from './event.service';
import type { EnabledModules } from './module-gate';
import { RbacService } from './rbac.service';
import { ServiceEntryService } from './service-entry.service';
import { TaskService } from './task.service';

/** The sections of the read, as `unavailable` names them. */
export const ACTIVITY_SECTIONS = [
  'tasks',
  'hours_approvals',
  'polls',
  'coming_up',
  'files',
] as const;
export type ActivitySection = (typeof ACTIVITY_SECTIONS)[number];

/**
 * A task row. Carries what chat's task card reads from its message payload
 * (ids, both names, due date, reward), so a client can draw that same card
 * for a task whether or not a card for it was ever posted to a channel.
 */
export interface ActivityTask {
  id: string;
  title: string;
  due_date: string;
  /** Display status: `OVERDUE` for an open task past its due date. */
  status: TaskStatus;
  /** The status actually stored; what the next transition is checked against. */
  stored_status: TaskStatus;
  assignee_id: string;
  /** Empty when the member cannot be resolved (they have left). */
  assignee_name: string;
  created_by: string;
  /** Empty when the member cannot be resolved (they have left). */
  created_by_name: string;
  point_reward: number | null;
  completed_at: string | null;
  created_at: string;
}

/** A pending service entry, for a member who can approve it. */
export interface ActivityHoursEntry {
  id: string;
  user_id: string;
  /** Empty when the member cannot be resolved (they have left). */
  member_name: string;
  date: string;
  duration_minutes: number;
  description: string;
  created_at: string;
}

/**
 * A poll card, as a pointer to its chat message plus what a list row shows.
 *
 * No tallies: a client draws chat's own poll card from the message itself,
 * which it reads the way chat does (so the same access rule and the same live
 * updates apply), and the card counts the votes.
 */
export interface ActivityPoll {
  message_id: string;
  channel_id: string;
  /** The channel's name; a direct message's is server-generated, so use `channel_type`. */
  channel_name: string;
  channel_type: ChannelType;
  sender_id: string | null;
  question: string;
  option_count: number;
  closes_at: string;
  /** Set when its creator closed it early. */
  closed_at: string | null;
  is_closed: boolean;
  has_voted: boolean;
  created_at: string;
}

/** An upcoming event the member is invited to. */
export interface ActivityEvent {
  id: string;
  name: string;
  location: string | null;
  start_time: string;
  end_time: string;
  is_mandatory: boolean;
  point_value: number;
  check_in_opens_minutes: number;
  /** Whether the check-in window is open right now. */
  check_in_open: boolean;
  /**
   * Whether the member has an attendance row for it. Read only while check-in
   * is open; `null` otherwise, and when that read failed.
   */
  checked_in: boolean | null;
}

/** A file the member uploaded: a chapter document or a backwork resource. */
export interface ActivityFile {
  id: string;
  source: 'document' | 'backwork';
  title: string;
  created_at: string;
}

export interface ActivityView {
  needs_you: {
    /** Open tasks assigned to the caller, soonest due first. */
    tasks: ActivityTask[];
    /** Finished tasks the caller can confirm, longest waiting first. */
    task_confirmations: ActivityTask[];
    /** Pending service entries the caller can approve, oldest first. */
    hours_approvals: ActivityHoursEntry[];
    /** Open polls the caller can read and hasn't voted on, soonest closing first. */
    polls: ActivityPoll[];
  };
  /** Upcoming events, soonest first. */
  coming_up: ActivityEvent[];
  made_by_you: {
    polls: ActivityPoll[];
    tasks: ActivityTask[];
    files: ActivityFile[];
  };
  /**
   * How many things wait on the caller: every `needs_you` row, counted before
   * the per-list cap, plus events whose check-in is open and not yet used.
   */
  needs_you_count: number;
  /** Sections that could not be read this time and are served empty. */
  unavailable: ActivitySection[];
}

/** Rows each list carries. The count in `needs_you_count` is taken before it. */
const LIST_LIMIT = 25;
/** How many of the chapter's newest poll cards are checked for "open and unvoted". */
const POLL_SCAN_LIMIT = 100;
/** How far ahead "coming up" looks. */
const COMING_UP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const COMING_UP_LIMIT = 10;
/** `chat_message_actions.action_type` of a poll-card vote (ADR-07). */
const POLL_VOTE_ACTION_TYPE = 'vote';

interface PollCardFields {
  question: string;
  option_count: number;
  closes_at: string;
  closed_at: string | null;
  closes_at_ms: number;
}

/**
 * The fields of a poll card's payload this read uses, or `null` for a payload
 * no card can draw (no question, no options, or no parseable deadline). Such
 * a row is left out rather than listed as something to act on.
 */
function readPollCard(message: ChatMessage): PollCardFields | null {
  const payload = message.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const { question, options, closes_at, closed_at } = payload as Record<
    string,
    unknown
  >;
  if (typeof question !== 'string' || !Array.isArray(options)) return null;
  if (typeof closes_at !== 'string') return null;
  const closesAtMs = new Date(closes_at).getTime();
  if (Number.isNaN(closesAtMs)) return null;
  return {
    question,
    option_count: options.length,
    closes_at,
    closed_at: typeof closed_at === 'string' ? closed_at : null,
    closes_at_ms: closesAtMs,
  };
}

function byAscending<T>(keyOf: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => keyOf(a).localeCompare(keyOf(b));
}

function byNewest<T extends { created_at: string }>(a: T, b: T): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

type Settled<T> = { ok: true; value: T } | { ok: false };

/**
 * The Activity page's read (`spec/behavior/activity.md`): what waits on one
 * member and what they made, gathered from the modules that own each record.
 *
 * A read-only aggregation with no table of its own. Every row comes through
 * the owning module's service, and each section applies that module's own
 * rule for who may see it, because the sections do not share one:
 *
 * - **Tasks** are the caller's own; the chapter-wide list (for confirmations
 *   and "tasks you assigned") is read only for a `tasks:manage` holder, the
 *   rule `GET /v1/tasks` applies.
 * - **Hours approvals** need `service:approve`, and leave out the caller's own
 *   entries, which the approve route refuses.
 * - **Polls** are chat messages. A poll is listed only when its channel is in
 *   {@link ChatService.getChannels}, chat's own list of what the caller may
 *   read, and never when the caller has blocked its author.
 * - **Events** come through `EventService.findByChapter` with the viewer, so
 *   an event that leaves the member out contributes nothing.
 * - **Files** are the caller's own uploads, read only while they can still
 *   open that module.
 *
 * A module the chapter has switched off contributes nothing. The sections
 * are read independently: one that fails is served empty and named in
 * `unavailable`, rather than failing a page the others already answered for.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly taskService: TaskService,
    private readonly serviceEntryService: ServiceEntryService,
    private readonly eventService: EventService,
    private readonly attendanceService: AttendanceService,
    private readonly documentService: ChapterDocumentService,
    private readonly backworkService: BackworkService,
    private readonly chatService: ChatService,
    private readonly chatBlocks: ChatBlockService,
    private readonly rbacService: RbacService,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(CHAT_MESSAGE_ACTION_REPOSITORY)
    private readonly actionRepo: IChatMessageActionRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
  ) {}

  async getActivity(
    chapterId: string,
    userId: string,
    enabledModules: EnabledModules,
  ): Promise<ActivityView> {
    const permissions = await this.rbacService.getEffectivePermissions(
      chapterId,
      userId,
    );
    const on = (moduleKey: string) =>
      isModuleEnabled(enabledModules, moduleKey);
    const now = Date.now();

    const [tasks, hours, polls, events, files] = await Promise.all([
      this.settle('tasks', chapterId, () =>
        on('tasks')
          ? this.readTasks(chapterId, userId, permissions)
          : Promise.resolve({ mine: [], confirmations: [], assigned: [] }),
      ),
      this.settle('hours_approvals', chapterId, () =>
        on('hours') && can(SystemPermissions.SERVICE_APPROVE, permissions)
          ? this.readHoursApprovals(chapterId, userId)
          : Promise.resolve([]),
      ),
      this.settle('polls', chapterId, () =>
        on('polls')
          ? this.readPolls(chapterId, userId, now)
          : Promise.resolve({ unvoted: [], mine: [] }),
      ),
      this.settle('coming_up', chapterId, () =>
        on('events')
          ? this.readComingUp(chapterId, userId, now)
          : Promise.resolve([]),
      ),
      this.settle('files', chapterId, () =>
        this.readFiles(chapterId, userId, permissions, on),
      ),
    ]);

    const unavailable: ActivitySection[] = [];
    const valueOf = <T>(
      section: ActivitySection,
      result: Settled<T>,
      empty: T,
    ): T => {
      if (result.ok) return result.value;
      unavailable.push(section);
      return empty;
    };

    const taskLists = valueOf('tasks', tasks, {
      mine: [],
      confirmations: [],
      assigned: [],
    });
    const hoursApprovals = valueOf('hours_approvals', hours, []);
    const pollLists = valueOf('polls', polls, { unvoted: [], mine: [] });
    const comingUp = valueOf('coming_up', events, []);
    const myFiles = valueOf('files', files, []);

    const needsYouCount =
      taskLists.mine.length +
      taskLists.confirmations.length +
      hoursApprovals.length +
      pollLists.unvoted.length +
      comingUp.filter((event) => event.check_in_open && !event.checked_in)
        .length;

    return {
      needs_you: {
        tasks: taskLists.mine.slice(0, LIST_LIMIT),
        task_confirmations: taskLists.confirmations.slice(0, LIST_LIMIT),
        hours_approvals: hoursApprovals.slice(0, LIST_LIMIT),
        polls: pollLists.unvoted.slice(0, LIST_LIMIT),
      },
      coming_up: comingUp,
      made_by_you: {
        polls: pollLists.mine.slice(0, LIST_LIMIT),
        tasks: taskLists.assigned.slice(0, LIST_LIMIT),
        files: myFiles.slice(0, LIST_LIMIT),
      },
      needs_you_count: needsYouCount,
      unavailable,
    };
  }

  /** Run one section; a failure is logged and reported, never thrown. */
  private async settle<T>(
    section: ActivitySection,
    chapterId: string,
    read: () => Promise<T>,
  ): Promise<Settled<T>> {
    try {
      return { ok: true, value: await read() };
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Activity section '${section}' failed for chapter ${chapterId}`,
        error,
      );
      return { ok: false };
    }
  }

  private async readTasks(
    chapterId: string,
    userId: string,
    permissions: string[],
  ): Promise<{
    mine: ActivityTask[];
    confirmations: ActivityTask[];
    assigned: ActivityTask[];
  }> {
    const canManage = can(SystemPermissions.TASKS_MANAGE, permissions);
    // One read either way: a manager's chapter-wide list contains their own
    // tasks too, so it is not fetched beside the assignee list.
    const all = await this.taskService.list(chapterId, userId, canManage);

    const mine = all
      .filter(
        (task) =>
          task.assignee_id === userId &&
          task.stored_status !== TaskStatus.COMPLETED,
      )
      .sort(byAscending((task) => task.due_date));
    // Confirming your own completion is refused (`TaskService.confirmCompletion`,
    // the no-self-award rule), so it is not offered as waiting on you.
    const confirmations = canManage
      ? all
          .filter(
            (task) =>
              task.stored_status === TaskStatus.COMPLETED &&
              !task.confirmed_at &&
              task.assignee_id !== userId,
          )
          .sort(byAscending((task) => task.completed_at ?? task.created_at))
      : [];
    // Only while the caller can still read tasks they don't hold: a creator
    // who has lost `tasks:manage` gets a 403 from `GET /v1/tasks/:id`, and a
    // row that opens to a refusal is worse than no row.
    const assigned = canManage
      ? all.filter((task) => task.created_by === userId).sort(byNewest)
      : [];

    const names = await this.namesOf(
      [...mine, ...confirmations, ...assigned].flatMap((task) => [
        task.assignee_id,
        task.created_by,
      ]),
    );
    const toRow = (task: TaskView): ActivityTask => ({
      id: task.id,
      title: task.title,
      due_date: task.due_date,
      status: task.status,
      stored_status: task.stored_status,
      assignee_id: task.assignee_id,
      assignee_name: names.get(task.assignee_id) ?? '',
      created_by: task.created_by,
      created_by_name: names.get(task.created_by) ?? '',
      point_reward: task.point_reward,
      completed_at: task.completed_at,
      created_at: task.created_at,
    });
    return {
      mine: mine.map(toRow),
      confirmations: confirmations.map(toRow),
      assigned: assigned.map(toRow),
    };
  }

  private async readHoursApprovals(
    chapterId: string,
    userId: string,
  ): Promise<ActivityHoursEntry[]> {
    const pending = await this.serviceEntryService.findByChapterFiltered(
      chapterId,
      { status: 'PENDING' },
    );
    // An approver's own entry is not theirs to approve (`ServiceEntryService.approve`).
    const theirs = pending
      .filter((entry: ServiceEntry) => entry.user_id !== userId)
      .sort(byAscending((entry) => entry.created_at));
    const names = await this.namesOf(theirs.map((entry) => entry.user_id));
    return theirs.map((entry) => ({
      id: entry.id,
      user_id: entry.user_id,
      member_name: names.get(entry.user_id) ?? '',
      date: entry.date,
      duration_minutes: entry.duration_minutes,
      description: entry.description,
      created_at: entry.created_at,
    }));
  }

  private async readPolls(
    chapterId: string,
    userId: string,
    now: number,
  ): Promise<{ unvoted: ActivityPoll[]; mine: ActivityPoll[] }> {
    // The channel list is the access rule: `getChannels` is what chat itself
    // shows this caller, filtered through `ChannelAccessService`. A poll in a
    // channel that is not in it is never listed, whoever posted it; that
    // includes the caller's own poll in a channel they have since lost.
    //
    // The block list is read here and not defended against: "a block list
    // that cannot be read is not an empty block list", so a failure fails the
    // section (served empty and named `unavailable`) rather than listing a
    // blocked member's question.
    const [channels, recent, own, blockedUserIds] = await Promise.all([
      this.chatService.getChannels(chapterId, userId),
      this.messageRepo.findPollCardsByChapter(chapterId, {
        limit: POLL_SCAN_LIMIT,
      }),
      this.messageRepo.findPollCardsByChapter(chapterId, {
        senderId: userId,
        limit: LIST_LIMIT,
      }),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    const channelById = new Map(
      channels.map((channel) => [channel.id, channel]),
    );
    const blocked = new Set(blockedUserIds);

    const readable = (message: ChatMessage) =>
      channelById.has(message.channel_id);
    const openOthers = recent.filter((message) => {
      if (!readable(message) || message.sender_id === userId) return false;
      if (message.sender_id && blocked.has(message.sender_id)) return false;
      const card = readPollCard(message);
      return !!card && !card.closed_at && card.closes_at_ms > now;
    });
    const mine = own.filter(readable);

    const votedIds = new Set(
      await this.actionRepo.findActedMessageIds(
        [...openOthers, ...mine].map((message) => message.id),
        userId,
        POLL_VOTE_ACTION_TYPE,
      ),
    );

    const toRow = (message: ChatMessage): ActivityPoll | null => {
      const card = readPollCard(message);
      const channel = channelById.get(message.channel_id);
      if (!card || !channel) return null;
      return {
        message_id: message.id,
        channel_id: message.channel_id,
        channel_name: channel.name,
        channel_type: channel.type,
        sender_id: message.sender_id,
        question: card.question,
        option_count: card.option_count,
        closes_at: card.closes_at,
        closed_at: card.closed_at,
        is_closed: !!card.closed_at || card.closes_at_ms <= now,
        has_voted: votedIds.has(message.id),
        created_at: message.created_at,
      };
    };
    const rowsOf = (messages: ChatMessage[]): ActivityPoll[] =>
      messages.map(toRow).filter((row): row is ActivityPoll => row !== null);

    return {
      unvoted: rowsOf(openOthers)
        .filter((row) => !row.has_voted)
        .sort(
          (a, b) =>
            new Date(a.closes_at).getTime() - new Date(b.closes_at).getTime(),
        ),
      mine: rowsOf(mine),
    };
  }

  private async readComingUp(
    chapterId: string,
    userId: string,
    now: number,
  ): Promise<ActivityEvent[]> {
    // With the viewer, always: the row carries the event's name and location,
    // so a chapter-wide read would republish an event that leaves this member
    // out (`spec/behavior/events.md` § Attendance by role).
    const events = await this.eventService.findByChapter(chapterId, userId);
    const horizon = now + COMING_UP_WINDOW_MS;

    const upcoming = events
      .map((event) => ({ event, window: this.checkInWindowOf(event) }))
      .filter(
        ({ event, window }) =>
          window !== null &&
          window.closesAt > now &&
          new Date(event.start_time).getTime() <= horizon,
      )
      .sort(
        (a, b) =>
          new Date(a.event.start_time).getTime() -
          new Date(b.event.start_time).getTime(),
      )
      .slice(0, COMING_UP_LIMIT);

    return Promise.all(
      upcoming.map(async ({ event, window }): Promise<ActivityEvent> => {
        const checkInOpen = window !== null && window.opensAt <= now;
        return {
          id: event.id,
          name: event.name,
          location: event.location,
          start_time: event.start_time,
          end_time: event.end_time,
          is_mandatory: event.is_mandatory,
          point_value: event.point_value,
          check_in_opens_minutes: event.check_in_opens_minutes,
          check_in_open: checkInOpen,
          // Only for an event whose window is open, which is rarely more than
          // one: the answer is what decides whether it still needs the member.
          checked_in: checkInOpen
            ? await this.hasCheckedIn(event.id, userId, chapterId)
            : null,
        };
      }),
    );
  }

  /** The event's check-in window in epoch ms, or `null` when its times don't parse. */
  private checkInWindowOf(
    event: Event,
  ): { opensAt: number; closesAt: number } | null {
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }
    const { opensAt, closesAt } = checkInWindowBounds(
      start,
      end,
      event.check_in_opens_minutes,
    );
    return { opensAt: opensAt.getTime(), closesAt: closesAt.getTime() };
  }

  /**
   * `null` when the read fails: the event still lists, and it counts as
   * needing the member, which a failed read cannot rule out.
   */
  private async hasCheckedIn(
    eventId: string,
    userId: string,
    chapterId: string,
  ): Promise<boolean | null> {
    try {
      const attendance = await this.attendanceService.getMyAttendance(
        eventId,
        userId,
        chapterId,
      );
      return attendance !== null;
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Activity could not read attendance for event ${eventId}`,
        error,
      );
      return null;
    }
  }

  private async readFiles(
    chapterId: string,
    userId: string,
    permissions: string[],
    on: (moduleKey: string) => boolean,
  ): Promise<ActivityFile[]> {
    const canBackwork =
      can(SystemPermissions.BACKWORK_UPLOAD, permissions) ||
      can(SystemPermissions.BACKWORK_ADMIN, permissions);
    const [documents, backwork] = await Promise.all([
      on('documents')
        ? this.documentService.findByChapter(chapterId)
        : Promise.resolve([]),
      on('backwork') && canBackwork
        ? this.backworkService.findByChapter(chapterId)
        : Promise.resolve([]),
    ]);
    const files: ActivityFile[] = [
      ...documents
        .filter((document) => document.uploaded_by === userId)
        .map((document) => ({
          id: document.id,
          source: 'document' as const,
          title: document.title,
          created_at: document.created_at,
        })),
      ...backwork
        .filter((resource) => resource.uploader_id === userId)
        .map((resource) => ({
          id: resource.id,
          source: 'backwork' as const,
          title: resource.title ?? '',
          created_at: resource.created_at,
        })),
    ];
    return files.sort(byNewest);
  }

  /** Display names by user id. An id with no user row is simply absent. */
  private async namesOf(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const users = await this.userRepo.findDisplayIdentitiesByIds(unique);
    return new Map(users.map((user) => [user.id, user.display_name ?? '']));
  }
}
