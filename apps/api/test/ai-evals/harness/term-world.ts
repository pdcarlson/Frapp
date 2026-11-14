/**
 * The term chapter behind Ask's real tools: every tool the agent loop may
 * call (`AGENT_READ_TOOLS`, `AGENT_PROPOSE_TOOLS`), built as the product
 * builds them, over the synthetic chapter's records instead of a database
 * (#4899, for the real-question set #4903).
 *
 * **What is the product's here**, and so is what a run grades: all 22 read
 * tools (their arguments, their wording, what each leaves out), the three
 * card tools and `ActService` behind them, `ChatCatchUpService` (which
 * messages a model may be shown: the channel the asker can open, the
 * author's yes), `ConversationScope`, `AskFromService`, and the retrieval
 * service over `eval-corpus.ts`.
 *
 * **What stands in for the database**, and so is NOT proven by a run: the
 * services under the chapter tools (`MemberService`, `TaskService`,
 * `EventService` and the rest) are replaced by the reads below, which
 * return the term chapter's records in each service's own shape. Who may
 * see which event or task is those services' rule and is covered by their
 * own specs. Message search by words is a plain every-word match, not the
 * app's full-text search.
 *
 * **What the term chapter does not record**, so a tool says little about it:
 * points are one total per member for the term (no month view, no ledger),
 * events run two hours, nobody is excused, and study hours are not kept.
 *
 * Ids. The tools read ids as the database's (`uuid` columns, and a model
 * passes back `meeting:<uuid>`), and the synthetic chapter's are words
 * (`syn-owen-hale`). `termId` turns one into the other, the same way every
 * time, and `TermWorld.documentFor` turns a cited source back.
 */
import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import {
  DEFAULT_MEETING_SECTIONS,
  isModuleEnabled,
  type MeetingContent,
} from '@repo/validation';
import type { ChapterGroupView } from '../../../src/application/services/chapter-group.service';
import type {
  ChannelUnreadCount,
  ChatChannel,
  ChatChannelView,
} from '#domain/entities/chat.entity';
import type { Event } from '#domain/entities/event.entity';
import type { EventAttendance } from '#domain/entities/event-attendance.entity';
import type { FinancialInvoice } from '#domain/entities/financial-invoice.entity';
import type { Meeting } from '#domain/entities/meeting.entity';
import type { Member } from '#domain/entities/member.entity';
import type { Role } from '#domain/entities/role.entity';
import type {
  ServiceEntry,
  ServiceLeaderboardRow,
} from '#domain/entities/service-entry.entity';
import { TaskStatus, type TaskView } from '#domain/entities/task.entity';
import type {
  CatchUpMessageRow,
  CatchUpStretch,
  IChatCatchUpRepository,
} from '#domain/repositories/chat-catch-up.repository.interface';
import { actProposeTools } from '../../../src/application/services/act/act-agent-tools';
import { ActPeopleResolver } from '../../../src/application/services/act/act-people';
import { ActService } from '../../../src/application/services/act/act.service';
import {
  CreateEventActTool,
  CreateTaskActTool,
  GivePointsActTool,
} from '../../../src/application/services/act/act-tools';
import type { ActivityStanding } from '../../../src/application/services/activity-standing.service';
import type { AiGatewayService } from '../../../src/application/services/ai/ai-gateway.service';
import { AskFromService } from '../../../src/application/services/ask/agent/ask-from.service';
import type {
  AgentProposeTool,
  AgentReadTool,
} from '../../../src/application/services/ask/agent/agent-tool';
import { CHAPTER_AGENT_TOOLS } from '../../../src/application/services/ask/agent/tools-chapter';
import {
  CONVERSATION_AGENT_TOOLS,
  ConversationScope,
} from '../../../src/application/services/ask/agent/tools-conversations';
import type { MaskedChatMessage } from '../../../src/application/services/chat-block-mask';
import { ChatCatchUpService } from '../../../src/application/services/chat-catch-up/chat-catch-up.service';
import type { CorpusRetrievalService } from '../../../src/application/services/corpus/corpus-retrieval.service';
import type {
  MemberProfile,
  MemberRosterEntry,
} from '../../../src/application/services/member.service';
import type { MeetingView } from '../../../src/application/services/meeting.service';
import { CHAT_SOURCE_TYPE } from '../../../src/application/services/corpus/chat-message-corpus-source';
import {
  PHILANTHROPY_COMMITTEE,
  type TermChapter,
  type TermEvent,
  type TermTask,
} from '../synthetic-chapter/term';
import type { SyntheticMember } from '../synthetic-chapter/roster';
import { createEvalCorpus } from './eval-corpus';
import type {
  AgentInvocation,
  CorpusDocument,
  ProposedCard,
  RecordedToolCall,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** The term chapter gives an event a start and no end. */
const EVENT_HOURS = 2;
/** When the term's records begin: the first day of the fall term. */
const TERM_START = '2026-08-24T12:00:00.000Z';

/** A synthetic id as the database would hold it: the same uuid every time. */
export function termId(id: string): string {
  const hex = createHash('sha1').update(id).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

const UUID_IN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const quietly = <T>(value: T): Promise<T> => Promise.resolve(value);

function isChat(document: CorpusDocument): boolean {
  return document.sourceType === CHAT_SOURCE_TYPE;
}

export interface TermWorld {
  /** The chapter and the asker as the tools know them. */
  chapterId: string;
  userId: string;
  readTools: AgentReadTool[];
  proposeTools: AgentProposeTool[];
  /** Every tool call that ran, in order, under the tool's own name. */
  calls: RecordedToolCall[];
  /** Every card that was made, by the id the answer names it with. */
  cards: ReadonlyMap<string, ProposedCard>;
  retrieval: CorpusRetrievalService;
  from: AskFromService;
  /** What `AskService` reads beside its tools. */
  rbac: {
    getEffectivePermissions(): Promise<string[]>;
    findByChapter(): Promise<Role[]>;
  };
  members: { findByUserAndChapter(userId: string): Promise<Member> };
  users: {
    findDisplayIdentitiesByIds(
      ids: string[],
    ): Promise<{ id: string; display_name: string; avatar_url: null }[]>;
  };
  consent: {
    check(): Promise<{ allowed: true }>;
    chapterSwitchOn(): Promise<boolean>;
    chatAuthorsWhoSaidYes(
      chapterId: string,
      authorIds: readonly string[],
    ): Promise<Set<string>>;
  };
  /**
   * The corpus document a cited source stands for, by the synthetic
   * chapter's own id. Undefined for live data (a roster, a task list): the
   * tool call is its record.
   */
  documentFor(sourceId: string, quote: string): string | undefined;
}

/**
 * The chapter one question is asked of. `gateway` is the one the agent's
 * model calls go through, so the cards' name matching is metered with them.
 */
export function createTermWorld(
  invocation: AgentInvocation,
  chapter: TermChapter,
  gateway: AiGatewayService,
  embedGateway: AiGatewayService,
  now: Date,
): TermWorld {
  const { caller } = invocation;
  const chapterId = termId(chapter.chapterId);
  const userId = termId(caller.memberId);
  const stamp = TERM_START;

  // The synthetic id each uuid stands for, for anything a citation can name.
  const original = new Map<string, string>();
  const u = (id: string): string => {
    const mapped = termId(id);
    original.set(mapped, id);
    return mapped;
  };

  // ------------------------------------------------------------ the index
  const corpus = createEvalCorpus(
    {
      ...invocation,
      caller: {
        ...caller,
        memberId: userId,
        chapterId: termId(caller.chapterId),
        ...(caller.channelIds
          ? { channelIds: caller.channelIds.map(termId) }
          : {}),
      },
      corpus: invocation.corpus.map((document) => ({
        ...document,
        id: u(document.id),
        chapterId: termId(document.chapterId),
        ...(document.chat
          ? {
              chat: {
                ...document.chat,
                channelId: termId(document.chat.channelId),
                authorMemberId: termId(document.chat.authorMemberId),
              },
            }
          : {}),
      })),
    },
    embedGateway,
  );
  const here = invocation.corpus.filter(
    (document) => document.chapterId === chapter.chapterId,
  );

  // ----------------------------------------------------------- the people
  const roleNames = [...new Set(chapter.members.map((person) => person.role))];
  const roleId = (name: string) => termId(`role:${name}`);
  const roles: Role[] = roleNames.map((name, index) => ({
    id: roleId(name),
    chapter_id: chapterId,
    name,
    system_key:
      name === 'Member'
        ? 'MEMBER'
        : name === 'Alumni'
          ? 'ALUMNI'
          : name === 'President'
            ? 'PRESIDENT'
            : null,
    permissions: [],
    is_system: name === 'Member' || name === 'Alumni' || name === 'President',
    display_order: index,
    color: null,
    mentionable: true,
    tier_id: null,
    permission_overrides: {},
    created_at: stamp,
  }));
  const alumniRoleId = roleNames.includes('Alumni') ? roleId('Alumni') : null;
  const person = (id: string): SyntheticMember | undefined =>
    chapter.members.find((entry) => termId(entry.id) === id);
  const memberRow = (entry: SyntheticMember): Member => ({
    id: termId(`member:${entry.id}`),
    user_id: termId(entry.id),
    chapter_id: chapterId,
    role_ids: [roleId(entry.role)],
    custom_role_ids: [],
    has_completed_onboarding: true,
    dismissed_ops_nudges: [],
    pledge_class_id: null,
    order_number: null,
    created_at: stamp,
    updated_at: stamp,
  });
  const profiles: MemberProfile[] = chapter.members.map((entry) => ({
    id: termId(`member:${entry.id}`),
    user_id: termId(entry.id),
    chapter_id: chapterId,
    role_ids: [roleId(entry.role)],
    custom_role_ids: [],
    has_completed_onboarding: true,
    created_at: stamp,
    updated_at: stamp,
    display_name: entry.name,
    avatar_url: null,
    bio: null,
    graduation_year: null,
    major: null,
    current_city: null,
    current_company: null,
    // The profile carries contact details, as the product's does. No tool
    // may hand them to a model (`neverShown` on the questions that ask).
    email:
      chapter.contactDetails[entry.id]?.email ?? `${entry.id}@example.test`,
    phone: chapter.contactDetails[entry.id]?.phone ?? null,
    pledge_class_id: null,
    order_number: null,
    is_alumni: entry.role === 'Alumni',
  }));
  const roster: MemberRosterEntry[] = chapter.members.map((entry) => ({
    user_id: termId(entry.id),
    display_name: entry.name,
    avatar_url: null,
    role_color: null,
  }));
  const members = {
    findRosterByChapter: (asked: string) =>
      quietly(asked === chapterId ? roster : []),
    findProfilesByChapter: (asked: string) =>
      quietly(asked === chapterId ? profiles : []),
    findByUserAndChapter: (asked: string, inChapter: string) => {
      const entry = inChapter === chapterId ? person(asked) : undefined;
      if (!entry) throw new NotFoundException('Member not found');
      return quietly(memberRow(entry));
    },
  };
  const rbac = {
    findByChapter: (asked: string) => quietly(asked === chapterId ? roles : []),
    getAlumniRoleId: () => quietly(alumniRoleId),
    // The asker's own, as the invocation gives them. Nobody else asks.
    getEffectivePermissions: () => quietly(caller.permissions),
  };
  const group = (name: string, ids: readonly string[]): ChapterGroupView => ({
    id: termId(`group:${name}`),
    chapter_id: chapterId,
    kind: 'manual',
    name,
    color: null,
    mentionable: true,
    pledge_class_id: null,
    class_year: null,
    created_at: stamp,
    updated_at: stamp,
    member_ids: ids.map(termId),
  });
  const onRoster = (id: string) =>
    chapter.members.some((entry) => entry.id === id);
  const groups = {
    list: () =>
      quietly(
        [
          group(
            'Philanthropy committee',
            [...PHILANTHROPY_COMMITTEE].filter(onRoster),
          ),
          group(
            'Social committee',
            chapter.members
              .filter((entry) => entry.socialCommittee)
              .map((entry) => entry.id),
          ),
        ].filter((entry) => entry.member_ids.length > 0),
      ),
  };

  // ------------------------------------------------------------ the tasks
  const taskRow = (task: TermTask): TaskView => {
    const finished =
      task.status === 'done' || task.status === 'awaiting_approval';
    const stored = finished ? TaskStatus.COMPLETED : TaskStatus.TODO;
    // Past due from the day after its due day, as `TaskService` reads it.
    const pastDue =
      !finished &&
      Date.parse(`${task.due}T00:00:00.000Z`) + DAY_MS <= now.getTime();
    const dueNoon = `${task.due}T17:00:00.000Z`;
    return {
      id: u(task.id),
      chapter_id: chapterId,
      title: task.title,
      description: null,
      assignee_id: termId(task.assigneeId),
      created_by: termId(task.createdById),
      due_date: task.due,
      due_at: null,
      status: pastDue ? TaskStatus.OVERDUE : stored,
      stored_status: stored,
      point_reward: task.points > 0 ? task.points : null,
      points_awarded: task.status === 'done' && task.points > 0,
      completed_at: finished ? dueNoon : null,
      confirmed_at: task.status === 'done' ? dueNoon : null,
      sent_back_at: task.status === 'sent_back' ? dueNoon : null,
      proof_kind: 'none',
      proof_link: null,
      sent_back_reason: null,
      completion_note: null,
      created_at: stamp,
    };
  };
  const taskRows = chapter.tasks.map(taskRow);
  const tasks = {
    list: (
      asked: string,
      asker: string,
      isAdmin: boolean,
      options: { confirmed?: boolean; limit?: number } = {},
    ) =>
      quietly(
        taskRows
          .filter(
            (task) =>
              asked === chapterId &&
              (isAdmin || task.assignee_id === asker) &&
              (options.confirmed === undefined ||
                (task.confirmed_at !== null) === options.confirmed),
          )
          .slice(0, options.limit ?? taskRows.length),
      ),
    findById: (id: string, inChapter: string) => {
      const task =
        inChapter === chapterId
          ? taskRows.find((entry) => entry.id === id)
          : undefined;
      if (!task) throw new NotFoundException('Task not found');
      return quietly(task);
    },
  };

  // ----------------------------------------------------------- the events
  const eventRow = (termEvent: TermEvent): Event => ({
    id: u(termEvent.id),
    chapter_id: chapterId,
    name: termEvent.name,
    description: null,
    location: termEvent.place,
    start_time: new Date(termEvent.start).toISOString(),
    end_time: new Date(
      Date.parse(termEvent.start) + EVENT_HOURS * HOUR_MS,
    ).toISOString(),
    point_value: termEvent.points,
    is_mandatory: termEvent.required,
    recurrence_rule: null,
    parent_event_id: null,
    required_role_ids: null,
    optional_role_ids: null,
    excluded_role_ids: null,
    others_invited: null,
    notes: null,
    check_in_zone: null,
    check_in_zone_name: null,
    check_in_opens_minutes: 15,
    event_type_id: null,
    created_by: null,
    agenda: [],
    attachments: [],
    created_at: stamp,
  });
  const eventRows = chapter.events.map(eventRow);
  const eventOf = (id: string, inChapter: string): Event => {
    const found =
      inChapter === chapterId
        ? eventRows.find((entry) => entry.id === id)
        : undefined;
    if (!found) throw new NotFoundException('Event not found');
    return found;
  };
  const events = {
    findByChapter: (
      asked: string,
      _viewerId?: string,
      window?: { endsAfter: string; startsBefore: string },
    ) =>
      quietly(
        eventRows.filter(
          (entry) =>
            asked === chapterId &&
            (!window ||
              (Date.parse(entry.end_time) > Date.parse(window.endsAfter) &&
                Date.parse(entry.start_time) <
                  Date.parse(window.startsBefore))),
        ),
      ),
    findById: (id: string, inChapter: string) =>
      quietly(eventOf(id, inChapter)),
  };
  // Who came: every active member not marked absent, for an event the
  // chapter has taken attendance at. One it has not has no rows.
  const actives = chapter.members.filter((entry) => entry.role !== 'Alumni');
  const attendanceRows: EventAttendance[] = chapter.events.flatMap(
    (termEvent) => {
      if (!termEvent.absentIds) return [];
      const absent = new Set(termEvent.absentIds);
      return actives.map((entry) => ({
        id: termId(`attendance:${termEvent.id}:${entry.id}`),
        event_id: termId(termEvent.id),
        user_id: termId(entry.id),
        status: absent.has(entry.id)
          ? ('ABSENT' as const)
          : ('PRESENT' as const),
        check_in_time: absent.has(entry.id)
          ? null
          : new Date(termEvent.start).toISOString(),
        excuse_reason: null,
        marked_by: null,
        created_at: new Date(termEvent.start).toISOString(),
      }));
    },
  );
  const attendance = {
    getAttendance: (eventId: string, inChapter: string) => {
      eventOf(eventId, inChapter);
      return quietly(attendanceRows.filter((row) => row.event_id === eventId));
    },
    getMyAttendance: (eventId: string, asker: string, inChapter: string) => {
      eventOf(eventId, inChapter);
      return quietly(
        attendanceRows.find(
          (row) => row.event_id === eventId && row.user_id === asker,
        ) ?? null,
      );
    },
    getMyAttendanceForEvents: (
      asker: string,
      inChapter: string,
      asked: readonly Pick<Event, 'id' | 'chapter_id'>[],
    ) => {
      const ids = new Set(
        asked
          .filter((entry) => entry.chapter_id === inChapter)
          .map((entry) => entry.id),
      );
      return quietly(
        attendanceRows.filter(
          (row) => row.user_id === asker && ids.has(row.event_id),
        ),
      );
    },
  };
  const excuses = {
    getMine: () => quietly({ excuse: null, receiver: null }),
  };

  // ------------------------------------------- points, hours, dues, standing
  const pointsOf = (id: string): number => {
    const entry = person(id);
    return entry ? (chapter.points[entry.id] ?? 0) : 0;
  };
  const board = Object.entries(chapter.points)
    .map(([id, total]) => ({ user_id: termId(id), total }))
    .sort((a, b) => b.total - a.total);
  const points = {
    // One total for the term: the chapter keeps no ledger, so the month has
    // nothing of its own to show.
    getUserSummary: (
      _chapterId: string,
      asker: string,
      window: 'all' | 'semester' | 'month' = 'all',
    ) => {
      const balance = window === 'month' ? 0 : pointsOf(asker);
      return quietly({
        balance,
        transactions:
          balance === 0
            ? []
            : [
                {
                  id: termId(`points:${asker}`),
                  chapter_id: chapterId,
                  user_id: asker,
                  amount: balance,
                  category: 'MANUAL' as const,
                  description: 'Points this term',
                  metadata: {},
                  created_at: stamp,
                },
              ],
      });
    },
    getLeaderboard: (
      _chapterId: string,
      window: 'all' | 'semester' | 'month' = 'all',
    ) => quietly(window === 'month' ? [] : board),
  };
  const serviceRows: ServiceEntry[] = chapter.serviceEntries.map(
    (entry, index) => ({
      id: termId(`service:${index}`),
      chapter_id: chapterId,
      user_id: termId(entry.memberId),
      date: entry.day,
      duration_minutes: entry.hours * 60,
      description: entry.what,
      proof_path: null,
      status: entry.status === 'approved' ? 'APPROVED' : 'PENDING',
      reviewed_by: null,
      review_comment: null,
      points_awarded: false,
      awarded_points: null,
      created_at: `${entry.day}T17:00:00.000Z`,
    }),
  );
  const inDays = (row: ServiceEntry, from?: string, to?: string) =>
    (!from || row.date >= from) && (!to || row.date <= to);
  const service = {
    findByChapterFiltered: (
      _chapterId: string,
      filters: {
        status?: ServiceEntry['status'];
        startDate?: string;
        endDate?: string;
        userId?: string;
      },
    ) =>
      quietly(
        serviceRows.filter(
          (row) =>
            (!filters.userId || row.user_id === filters.userId) &&
            (!filters.status || row.status === filters.status) &&
            inDays(row, filters.startDate, filters.endDate),
        ),
      ),
    leaderboard: (
      _chapterId: string,
      range: { startDate?: string; endDate?: string } = {},
    ) => {
      const totals = new Map<string, ServiceLeaderboardRow>();
      for (const row of serviceRows) {
        if (row.status !== 'APPROVED') continue;
        if (!inDays(row, range.startDate, range.endDate)) continue;
        const held = totals.get(row.user_id) ?? {
          user_id: row.user_id,
          member_name: person(row.user_id)?.name ?? 'A member',
          total_minutes: 0,
          entry_count: 0,
        };
        held.total_minutes += row.duration_minutes;
        held.entry_count += 1;
        totals.set(row.user_id, held);
      }
      return quietly(
        [...totals.values()].sort((a, b) => b.total_minutes - a.total_minutes),
      );
    },
  };
  const invoices = {
    findByUser: (asker: string): Promise<FinancialInvoice[]> => {
      const entry = person(asker);
      const owed = entry ? chapter.unpaidDues[entry.id] : undefined;
      return quietly(
        owed === undefined
          ? []
          : [
              {
                id: termId(`invoice:${asker}`),
                chapter_id: chapterId,
                user_id: asker,
                title: 'Fall dues',
                description: null,
                amount: owed,
                status: 'OPEN',
                due_date: '2026-09-15',
                paid_at: null,
                stripe_payment_intent_id: null,
                created_at: stamp,
              },
            ],
      );
    },
  };
  const standing = {
    getStanding: (
      _chapterId: string,
      asker: string,
      enabledModules: Record<string, boolean> | null,
    ): Promise<ActivityStanding> => {
      const entry = person(asker);
      const required = chapter.events.filter(
        (termEvent) => termEvent.required && termEvent.absentIds,
      );
      const missed = required.filter((termEvent) =>
        (termEvent.absentIds ?? []).includes(entry?.id ?? ''),
      ).length;
      const mine = serviceRows.filter((row) => row.user_id === asker);
      const minutes = (status: ServiceEntry['status']) =>
        mine
          .filter((row) => row.status === status)
          .reduce((sum, row) => sum + row.duration_minutes, 0);
      const rank = board.findIndex((row) => row.user_id === asker);
      const on = (key: string) => isModuleEnabled(enabledModules, key);
      return quietly({
        points: on('points')
          ? {
              total: pointsOf(asker),
              rank: rank < 0 ? null : rank + 1,
              ranked: board.length,
              goal: chapter.requirement.points,
            }
          : null,
        required_events: on('events')
          ? {
              required: required.length,
              attended: required.length - missed,
              excused: 0,
            }
          : null,
        service: on('hours')
          ? {
              approved_minutes: minutes('APPROVED'),
              pending_minutes: minutes('PENDING'),
              goal_minutes: chapter.requirement.serviceHours * 60,
            }
          : null,
        // The term chapter keeps no study sessions.
        study: null,
        unavailable: [],
      });
    },
  };

  // ------------------------------------------------------------- the chat
  const openIds = new Set((caller.channelIds ?? []).map(termId));
  const channelName = (id: string): string =>
    (chapter.channelNames[id] ?? id).replace(/^#/, '');
  const channelIds = [
    ...new Set([
      ...Object.keys(chapter.channelNames),
      ...here.flatMap((document) =>
        document.chat ? [document.chat.channelId] : [],
      ),
    ]),
  ];
  const channelRows: ChatChannel[] = channelIds.map((id) => ({
    id: u(id),
    chapter_id: chapterId,
    name: channelName(id),
    description: null,
    type: 'PUBLIC',
    required_permissions: null,
    member_ids: null,
    category_id: null,
    who_can_see: null,
    who_can_post: null,
    is_read_only: false,
    created_at: stamp,
    archived_at: null,
    default_notification_level: null,
    is_default: false,
    is_audit_log: false,
    display_locked: false,
    created_by: null,
  }));
  // Only the asker's own list is known: `caller.channelIds`.
  const openTo = (asker: string): ChatChannel[] =>
    asker === userId ? channelRows.filter((row) => openIds.has(row.id)) : [];
  const channelReads = {
    list: (_chapterId: string, asker: string): Promise<ChatChannelView[]> =>
      quietly(openTo(asker).map((row) => ({ ...row, can_post: true }))),
    unreadCounts: (): Promise<ChannelUnreadCount[]> => quietly([]),
  };
  // Channel messages only. A direct message is not a row here: no tool, and
  // nothing a tool reads through, can reach one.
  const messageRows = here
    .filter((document) => isChat(document) && document.chat)
    .map((document) => ({
      id: u(document.id),
      channel_id: termId(document.chat!.channelId),
      sender_id: termId(document.chat!.authorMemberId),
      content: document.body,
      created_at: new Date(document.createdAt).toISOString(),
      thread_root_id: null,
      mentions: null,
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const asRow = (row: (typeof messageRows)[number]): CatchUpMessageRow => ({
    id: row.id,
    sender_id: row.sender_id,
    content: row.content,
    created_at: row.created_at,
    thread_root_id: null,
    mentions: null,
  });
  const stretchOf = (
    rows: typeof messageRows,
    limit: number,
    keep: 'newest' | 'oldest',
  ): CatchUpStretch => ({
    messages: (keep === 'newest'
      ? rows.slice(Math.max(rows.length - limit, 0))
      : rows.slice(0, limit)
    ).map(asRow),
    total: rows.length,
  });
  const stretches: IChatCatchUpRepository = {
    unreadStart: () => quietly(null),
    readChannelSince: (input) =>
      quietly(
        stretchOf(
          messageRows.filter(
            (row) =>
              input.chapterId === chapterId &&
              row.channel_id === input.channelId &&
              row.created_at >= new Date(input.since).toISOString(),
          ),
          input.limit,
          'newest',
        ),
      ),
    readThread: () => quietly(null),
    readChannelWindow: (input) =>
      quietly(
        stretchOf(
          messageRows.filter(
            (row) =>
              input.chapterId === chapterId &&
              row.channel_id === input.channelId &&
              (!input.from ||
                Date.parse(row.created_at) >= Date.parse(input.from)) &&
              (!input.before ||
                Date.parse(row.created_at) < Date.parse(input.before)),
          ),
          input.limit,
          input.keep,
        ),
      ),
    locateMessage: (input) => {
      const row =
        input.chapterId === chapterId
          ? messageRows.find((entry) => entry.id === input.messageId)
          : undefined;
      return quietly(
        row
          ? {
              channel_id: row.channel_id,
              created_at: row.created_at,
              thread_root_id: null,
            }
          : null,
      );
    },
  };
  const consent = {
    check: () => quietly({ allowed: true as const }),
    chapterSwitchOn: () => quietly(true),
    chatAuthorsWhoSaidYes: corpus.consent.chatAuthorsWhoSaidYes,
  };
  const users = {
    findDisplayIdentitiesByIds: (ids: string[]) =>
      quietly(
        ids.flatMap((id) => {
          const entry = person(id);
          return entry
            ? [{ id, display_name: entry.name, avatar_url: null }]
            : [];
        }),
      ),
  };
  const catchUp = new ChatCatchUpService(
    {
      assertChannelAccess: (
        channelId: string,
        inChapter: string,
        asker: string,
      ) => {
        const channel =
          inChapter === chapterId
            ? openTo(asker).find((row) => row.id === channelId)
            : undefined;
        if (!channel) throw new NotFoundException('Channel not found');
        return quietly(channel);
      },
    } as never,
    consent as never,
    gateway,
    stretches,
    { findBlockedUserIds: () => quietly([]) },
    users,
  );
  const wordsOf = (text: string): string[] =>
    text.toLowerCase().match(/[a-z0-9$#@']+/g) ?? [];
  const search = {
    // Every word of the query, anywhere in the message: a stand-in for the
    // app's full-text search, newest first.
    searchMessagesIn: (
      inChapter: string,
      asker: string,
      query: string,
      inChannels: readonly string[],
      filters: { fromUserId?: string; after?: string; before?: string } = {},
      limit = 20,
    ): Promise<MaskedChatMessage[]> => {
      const wanted = wordsOf(query);
      const narrowed = Boolean(
        filters.fromUserId ?? filters.after ?? filters.before,
      );
      if (inChapter !== chapterId || (wanted.length === 0 && !narrowed)) {
        return quietly([]);
      }
      const open = new Set(openTo(asker).map((row) => row.id));
      return quietly(
        messageRows
          .filter((row) => {
            const text = row.content.toLowerCase();
            return (
              inChannels.includes(row.channel_id) &&
              open.has(row.channel_id) &&
              (!filters.fromUserId || row.sender_id === filters.fromUserId) &&
              (!filters.after ||
                Date.parse(row.created_at) >= Date.parse(filters.after)) &&
              (!filters.before ||
                Date.parse(row.created_at) < Date.parse(filters.before)) &&
              wanted.every((word) => text.includes(word))
            );
          })
          .reverse()
          .slice(0, limit)
          .map((row) => ({
            id: row.id,
            channel_id: row.channel_id,
            sender_id: row.sender_id,
            content: row.content,
            type: 'TEXT',
            kind: 'text',
            reply_to_id: null,
            metadata: {},
            is_pinned: false,
            pinned_at: null,
            edited_at: null,
            is_deleted: false,
            mentions: null,
            thread_root_id: null,
            created_at: row.created_at,
            sender_blocked: false,
          })),
      );
    },
  };

  // ---------------------------------------------------------- the minutes
  // Minutes are written as lines. "Decision:" and "Action:" lines are the
  // minutes' own lists; the rest is the summary. No owner is recorded: the
  // line names them, as the secretary wrote it.
  const meetingRows = here
    .filter((document) => document.sourceType === 'meeting_minutes')
    .map((document) => {
      const lines = document.body.split('\n').map((line) => line.trim());
      const tagged = (tag: string) =>
        lines
          .filter((line) => line.startsWith(`${tag}:`))
          .map((line) => line.slice(tag.length + 1).trim());
      const content: MeetingContent = {
        summary: lines
          .filter(
            (line) =>
              !line.startsWith('Decision:') && !line.startsWith('Action:'),
          )
          .join('\n'),
        announcements: '',
        decisions: tagged('Decision').map((text) => ({ text, vote: null })),
        action_items: tagged('Action').map((text) => ({
          text,
          owner_user_id: null,
          due_date: null,
        })),
        officer_reports: '',
        old_business: '',
        new_business: '',
        discussion_log: '',
      };
      const held = new Date(
        document.effectiveAt ?? document.createdAt,
      ).toISOString();
      const meeting: Meeting = {
        id: u(document.id),
        chapter_id: chapterId,
        event_id: null,
        event_name: document.title,
        event_start_time: held,
        meeting_type: /exec/i.test(document.title) ? 'exec' : 'chapter',
        other_label: null,
        status: 'posted',
        content,
        created_by: null,
        updated_by: null,
        posted_by: null,
        posted_at: held,
        created_at: held,
        updated_at: held,
      };
      return { meeting, content };
    });
  const meetings = {
    list: (asked: string) =>
      quietly(asked === chapterId ? meetingRows.map((row) => row.meeting) : []),
    get: (asked: string, id: string): Promise<MeetingView> => {
      const row =
        asked === chapterId
          ? meetingRows.find((entry) => entry.meeting.id === id)
          : undefined;
      if (!row) throw new NotFoundException('Minutes not found');
      return quietly({
        meeting: row.meeting,
        content: row.content,
        sections: [...DEFAULT_MEETING_SECTIONS],
        attendees: null,
        event_end_time: null,
        can_edit: false,
        can_delete: false,
      });
    },
  };

  // ------------------------------------------------------------ the tools
  const scope = new ConversationScope(channelReads as never, members as never);
  const held: Record<string, unknown> = {
    MemberService: members,
    RbacService: rbac,
    ChapterGroupService: groups,
    TaskService: tasks,
    EventService: events,
    AttendanceService: attendance,
    EventExcuseService: excuses,
    PointsService: points,
    ActivityStandingService: standing,
    ServiceEntryService: service,
    FinancialInvoiceService: invoices,
    ChatChannelReadsService: channelReads,
    ConversationScope: scope,
    ChatCatchUpService: catchUp,
    SearchService: search,
    CorpusRetrievalService: corpus.retrieval,
    MeetingService: meetings,
  };
  // Each tool is given what its constructor asks for, by the class Nest
  // would inject, so a tool that gains a dependency fails here by name
  // instead of running with the wrong service in the slot.
  const build = <T>(tool: new (...args: never[]) => T): T => {
    const wanted = (Reflect.getMetadata('design:paramtypes', tool) ?? []) as {
      name: string;
    }[];
    const given = wanted.map((type) => {
      if (!(type.name in held)) {
        throw new Error(
          `${tool.name} needs ${type.name}, which the term world does not back yet`,
        );
      }
      return held[type.name];
    });
    return new tool(...(given as never[]));
  };

  const calls: RecordedToolCall[] = [];
  const cards = new Map<string, ProposedCard>();
  const readTools = [...CHAPTER_AGENT_TOOLS, ...CONVERSATION_AGENT_TOOLS].map(
    (tool): AgentReadTool => {
      const made = build<AgentReadTool>(tool);
      const run = made.run.bind(made);
      made.run = (args, context) => {
        calls.push({
          toolName: made.name,
          requiredPermission: made.permission,
          targetChapterId:
            context.chapterId === chapterId
              ? chapter.chapterId
              : context.chapterId,
          mutating: false,
        });
        return run(args, context);
      };
      return made;
    },
  );

  const titleOf = (payload: Record<string, unknown>, kind: string): string => {
    for (const key of ['title', 'name', 'reason']) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return kind;
  };
  const ownerOf = (payload: Record<string, unknown>): string | null => {
    const ids = [
      payload.assignee_id,
      ...(Array.isArray(payload.user_ids) ? payload.user_ids : []),
    ].filter((id): id is string => typeof id === 'string');
    const names = ids.flatMap((id) => person(id)?.name ?? []);
    return names.length > 0 ? names.join(', ') : null;
  };
  const suggestions = {
    withdrawSource: () => quietly(0),
    proposeBatch: (input: {
      proposals: { kind: string; payload: Record<string, unknown> }[];
    }) => {
      return quietly({
        created: input.proposals.map((proposal) => {
          const id = termId(`suggestion:${cards.size}`);
          cards.set(id, {
            kind: proposal.kind,
            title: titleOf(proposal.payload, proposal.kind),
            owner: ownerOf(proposal.payload),
          });
          return { id, ...proposal };
        }),
      });
    },
  };
  const people = new ActPeopleResolver(
    members as never,
    rbac as never,
    gateway,
  );
  const acting = [
    new GivePointsActTool(people, events as never, attendance as never),
    new CreateTaskActTool(people),
    new CreateEventActTool(),
  ];
  const act = new ActService(
    gateway,
    consent as never,
    rbac as never,
    suggestions as never,
    { track: () => quietly(undefined) } as never,
    acting,
  );
  const proposeTools = actProposeTools(acting, act).map(
    (tool): AgentProposeTool => {
      const propose = tool.propose.bind(tool);
      tool.propose = (args, context) => {
        calls.push({
          toolName: tool.name,
          requiredPermission: tool.permission,
          targetChapterId:
            context.chapterId === chapterId
              ? chapter.chapterId
              : context.chapterId,
          // A card changes nothing until the member approves it.
          mutating: false,
        });
        return propose(args, context);
      };
      return tool;
    },
  );

  return {
    chapterId,
    userId,
    readTools,
    proposeTools,
    calls,
    cards,
    retrieval: corpus.retrieval,
    from: new AskFromService(scope, events as never, tasks as never),
    rbac: {
      getEffectivePermissions: rbac.getEffectivePermissions,
      findByChapter: () => quietly(roles),
    },
    members: {
      findByUserAndChapter: (asked: string) =>
        members.findByUserAndChapter(asked, chapterId),
    },
    users,
    consent,
    documentFor(sourceId, quote) {
      const passage = corpus.documentFor(sourceId, quote);
      const candidates = [
        ...(passage ? [passage] : []),
        ...(sourceId.match(UUID_IN) ?? []),
      ];
      for (const id of candidates) {
        const found = original.get(id.toLowerCase());
        if (found && invocation.corpus.some((entry) => entry.id === found)) {
          return found;
        }
      }
      return undefined;
    },
  };
}
