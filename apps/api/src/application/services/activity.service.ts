import { Inject, Injectable, Logger } from '@nestjs/common';
import { can, checkInWindowBounds, isModuleEnabled } from '@repo/validation';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
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
import {
  CARD_VOTE_ACTION_TYPE,
  cardPollClosedEarly,
  cardVoteSelection,
  isPollClosed,
} from '#domain/utils/poll-vote-rules';
import type { CardPollPayload } from '#domain/utils/poll-vote-rules';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { BackworkService } from './backwork.service';
import { ChapterDocumentService } from './chapter-document.service';
import { maskBlockedMessages } from './chat-block-mask';
import type { MaskedChatMessage } from './chat-block-mask';
import { ChatBlockService } from './chat-block.service';
import { ChatService } from './chat.service';
import { EventService } from './event.service';
import { attendanceFor } from './event-role-targeting';
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
  /** When an officer confirmed the completion; `null` until then. */
  confirmed_at: string | null;
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
  /** When voting stops; `null` for a card posted with no usable deadline, which stays open. */
  closes_at: string | null;
  /** Set when its creator closed it early. */
  closed_at: string | null;
  is_closed: boolean;
  has_voted: boolean;
  created_at: string;
  /**
   * The poll's chat message, as `GET /v1/channels/{id}/messages` serves it,
   * so a client can hand it to chat's own poll card. Its votes are not in it:
   * a client reads `chat_message_actions` for the message the way chat does.
   */
  message: MaskedChatMessage;
}

/** An upcoming event the member is invited to. */
export interface ActivityEvent {
  id: string;
  name: string;
  location: string | null;
  start_time: string;
  end_time: string;
  /**
   * What the event asks of this member (`spec/behavior/events.md` §
   * Attendance by role), not the event's default: a role of theirs the event
   * lists decides it, and an alumnus the default alone would require is
   * optional.
   */
  attendance: 'required' | 'optional';
  point_value: number;
  check_in_opens_minutes: number;
  /**
   * Whether this member can check in right now: the window is open and
   * check-in would not refuse them (an alumnus no role of the event names).
   */
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

interface PollCardFields {
  question: string;
  option_count: number;
  closes_at: string | null;
  closed_at: string | null;
}

/**
 * The fields of a poll card's payload this read uses, or `null` for one chat's
 * card cannot draw. The rule is the clients' (`readPollPayload` in
 * `@repo/chat-core/polls`): a question, and two options with an id and a
 * label. Nothing validates a card on send, so the row a member acts on is
 * decided the way the card they will see is.
 */
function readPollCard(message: ChatMessage): PollCardFields | null {
  const payload = message.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const card = payload as CardPollPayload & { question?: unknown };
  const options: unknown = card.options;
  if (typeof card.question !== 'string' || !Array.isArray(options)) {
    return null;
  }
  const usable = options.filter((option: unknown) => {
    if (!option || typeof option !== 'object') return false;
    const { id, label } = option as { id?: unknown; label?: unknown };
    return typeof id === 'string' && typeof label === 'string';
  }).length;
  if (usable < 2) return null;
  return {
    question: card.question,
    option_count: usable,
    // Only a deadline that parses: one that does not is no deadline, the way
    // `isPollClosed` reads it.
    closes_at:
      typeof card.closes_at === 'string' &&
      !Number.isNaN(new Date(card.closes_at).getTime())
        ? card.closes_at
        : null,
    closed_at:
      cardPollClosedEarly(card) && typeof card.closed_at === 'string'
        ? card.closed_at
        : null,
  };
}

/**
 * Closed early, or past its deadline by the rule the vote path applies
 * (`isPollClosed`): a card with no deadline, or one that does not parse,
 * stays open, as it does for a vote.
 */
function pollCardClosed(card: PollCardFields, now: Date): boolean {
  return card.closed_at !== null || isPollClosed(card.closes_at, now);
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
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
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

  /**
   * Run one section; a failure is logged and reported, never thrown.
   *
   * At `error` level: the member sees the section named in `unavailable`
   * instead of its rows, the read a 5xx would have reported had it
   * propagated. A broken query behind one section (#4087) otherwise reads
   * as a quiet gap on the page for as long as it stays broken (#4096).
   */
  private async settle<T>(
    section: ActivitySection,
    chapterId: string,
    read: () => Promise<T>,
  ): Promise<Settled<T>> {
    try {
      return { ok: true, value: await read() };
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: `activity-section:${section.replace(/_/g, '-')}`,
        message: `Activity section '${section}' failed for chapter ${chapterId}`,
        error,
      });
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
    // The caller's own tasks come from the assignee-scoped read, never out
    // of the chapter-wide one: that one is unbounded and cut at the database's
    // row cap, so in a chapter with a long task history a manager's own open
    // task could fall outside it.
    const [own, all] = await Promise.all([
      this.taskService.list(chapterId, userId, false),
      canManage
        ? this.taskService.list(chapterId, userId, true)
        : Promise.resolve([]),
    ]);

    const mine = own
      .filter((task) => task.stored_status !== TaskStatus.COMPLETED)
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
      confirmed_at: task.confirmed_at,
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
    const nowDate = new Date(now);
    // No deadline sorts last: it is the least pressing.
    const closesAtMs = (row: ActivityPoll) =>
      row.closes_at ? new Date(row.closes_at).getTime() : Number.MAX_VALUE;
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
      return !!card && !pollCardClosed(card, nowDate);
    });
    const mine = own.filter(readable);

    // A vote row with no picks is a cleared vote, not a vote: a member who
    // clears every pick on a multi-choice card keeps the row with an empty
    // list (#3793), and the poll goes back to needing them.
    const voteRows = await this.actionRepo.findActionsOnMessages(
      [...openOthers, ...mine].map((message) => message.id),
      userId,
      CARD_VOTE_ACTION_TYPE,
    );
    const votedIds = new Set(
      voteRows
        .filter((row) => cardVoteSelection(row.payload ?? undefined).length > 0)
        .map((row) => row.message_id),
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
        is_closed: pollCardClosed(card, nowDate),
        has_voted: votedIds.has(message.id),
        created_at: message.created_at,
        // Through the mask every chat read uses, with the block list read
        // above. A blocked author's poll never reaches this line; the mask is
        // what gives the row chat's own shape (`sender_blocked` set).
        message: maskBlockedMessages([message], blocked)[0],
      };
    };
    const rowsOf = (messages: ChatMessage[]): ActivityPoll[] =>
      messages.map(toRow).filter((row): row is ActivityPoll => row !== null);

    return {
      unvoted: rowsOf(openOthers)
        .filter((row) => !row.has_voted)
        .sort((a, b) => closesAtMs(a) - closesAtMs(b)),
      mine: rowsOf(mine),
    };
  }

  private async readComingUp(
    chapterId: string,
    userId: string,
    now: number,
  ): Promise<ActivityEvent[]> {
    const horizon = now + COMING_UP_WINDOW_MS;
    // With the viewer, always: the row carries the event's name and location,
    // so a chapter-wide read would republish an event that leaves this member
    // out (`spec/behavior/events.md` § Attendance by role). Bounded to the
    // window in SQL, with a day's margin behind for the check-in grace, so
    // the chapter's whole event history is not read to keep ten rows.
    const [events, member, isAlumni] = await Promise.all([
      this.eventService.findByChapter(chapterId, userId, {
        endsAfter: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        startsBefore: new Date(horizon).toISOString(),
      }),
      this.memberRepo.findByUserAndChapter(userId, chapterId),
      this.rbacService.isAlumni(chapterId, userId),
    ]);
    const roleIds = member?.role_ids ?? [];

    const upcoming = events
      .map((event) => ({
        event,
        window: this.checkInWindowOf(event),
        // The viewer's own answer. The list read above exempts an
        // `events:update` holder from the role gate so they can find any
        // event to edit it; that is not an invitation, so an event that
        // leaves them out is not "coming up" for them.
        answer: attendanceFor(event, roleIds),
      }))
      .filter(
        ({ event, window, answer }) =>
          answer.status !== 'not_invited' &&
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
      upcoming.map(
        async ({ event, window, answer }): Promise<ActivityEvent> => {
          // `AttendanceService.checkIn` refuses an alumnus unless a role of
          // theirs is listed on the event (`spec/behavior/alumni.md`), and the
          // absence sweep never holds them to the default. So for them the
          // event is optional and is not something to check in to.
          const alumniByDefault = isAlumni && !answer.byRole;
          const checkInOpen =
            window !== null && window.opensAt <= now && !alumniByDefault;
          return {
            id: event.id,
            name: event.name,
            location: event.location,
            start_time: event.start_time,
            end_time: event.end_time,
            attendance:
              answer.status === 'required' && !alumniByDefault
                ? 'required'
                : 'optional',
            point_value: event.point_value,
            check_in_opens_minutes: event.check_in_opens_minutes,
            check_in_open: checkInOpen,
            // Only for an event the member can check in to right now, which
            // is rarely more than one: the answer is what decides whether it
            // still needs them.
            checked_in: checkInOpen
              ? await this.hasCheckedIn(event.id, userId)
              : null,
          };
        },
      ),
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
  ): Promise<boolean | null> {
    try {
      // The row itself, not `AttendanceService.getMyAttendance`: that one
      // re-reads the event and its visibility, which the list read above has
      // just settled for this member.
      const attendance = await this.attendanceRepo.findByEventAndUser(
        eventId,
        userId,
      );
      return attendance !== null;
    } catch (error) {
      // Per event, and the event still lists: a best-effort step the page
      // absorbs, so `warning`.
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'activity-attendance-read',
        message: `Activity could not read attendance for event ${eventId}`,
        error,
      });
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
      // Filtered to the uploader in SQL: a chapter-wide read is cut at the
      // database's row cap, and the caller's files could fall outside it.
      on('documents')
        ? this.documentService.findByChapter(chapterId, {
            uploaded_by: userId,
          })
        : Promise.resolve([]),
      on('backwork') && canBackwork
        ? this.backworkService.findByChapter(chapterId, {
            uploader_id: userId,
          })
        : Promise.resolve([]),
    ]);
    const files: ActivityFile[] = [
      ...documents.map((document) => ({
        id: document.id,
        source: 'document' as const,
        title: document.title,
        created_at: document.created_at,
      })),
      ...backwork.map((resource) => ({
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
