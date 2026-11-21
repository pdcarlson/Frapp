import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AGENDA_SUGGESTIONS_TABLED_MAX,
  eventOthersInvited,
  isModuleEnabled,
  readMeetingContent,
  type AgendaSuggestion,
  type AgendaSuggestionList,
  type EventAgendaItem,
  type EventAgendaTabledFrom,
} from '@repo/validation';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import type { Event } from '#domain/entities/event.entity';
import type { EventAgendaSuggestion } from '#domain/entities/event-agenda-suggestion.entity';
import type { Meeting } from '#domain/entities/meeting.entity';
import {
  CHAPTER_REPOSITORY,
  type IChapterRepository,
} from '#domain/repositories/chapter.repository.interface';
import {
  EVENT_AGENDA_SUGGESTION_REPOSITORY,
  type EventAgendaSuggestionDraft,
  type IEventAgendaSuggestionRepository,
} from '#domain/repositories/event-agenda-suggestion.repository.interface';
import {
  EVENT_TYPE_REPOSITORY,
  type IEventTypeRepository,
} from '#domain/repositories/event-type.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  ROLE_TIER_REPOSITORY,
  type IRoleTierRepository,
} from '#domain/repositories/role-tier.repository.interface';
import { isAiEnabled } from '#domain/utils/ai-enabled';
import {
  AGENDA_SUGGEST_EXAMPLES_MAX,
  AGENDA_SUGGEST_MINUTES_MAX,
  AGENDA_SUGGEST_PROMPT_VERSION,
  AgendaSuggestOutputSchema,
  agendaSuggestMessages,
  agendaSuggestSystem,
  capList,
  checkAgendaSuggestions,
  minutesGist,
  rolePhrases,
  tabledCandidates,
  type AgendaRoleFact,
  type AgendaSourceMinutes,
  type AgendaSuggestFacts,
  type AgendaSuggestOutput,
} from '#domain/utils/agenda-suggestions';
import {
  reportingOffices,
  stillOpenItems,
  topicLines,
} from '#domain/utils/minutes-context';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { AiConsentService } from './ai/ai-consent.service';
import { AiGatewayService, type AiObjectResult } from './ai/ai-gateway.service';
import { EventService } from './event.service';
import {
  audienceKey,
  sameAudienceMinutes,
} from './meeting-draft-context.service';
import { MeetingService } from './meeting.service';
import { RbacService } from './rbac.service';

const TASK = 'agenda.suggest';

/** Decided suggestions read to find the examples with the same audience. */
const DECIDED_READ = 60;

/** What one list, refresh, Add or Dismiss works from. */
interface Context {
  chapterId: string;
  userId: string;
  event: Event;
  /** `audienceKey(event)`: rows written for another audience aren't read. */
  audience: string;
  /** Same-audience posted minutes this member may read, newest first. */
  earlier: Meeting[];
  /** The member's time zone, for the days the model is told. */
  timeZone: string;
}

/** When a call happens and in which zone; both default for production. */
export interface AgendaSuggestionOptions {
  now?: Date;
  timeZone?: string;
}

/**
 * Suggested agenda items (#5534, `spec/behavior/events.md` § Suggested
 * agenda items, `spec/behavior/meetings.md` § Tabled items).
 *
 * - **Who:** a member who may edit the event (`events:update`, checked by
 *   the route with the meetings module) and can see it, in a chapter with
 *   the events module on. Everything is read as that member: only minutes
 *   they may read, of events they can see.
 * - **Which minutes:** posted, before the event starts, never Standards, and
 *   only of events that invite the same people by the same rule
 *   (`sameAudienceMinutes`), so an officers-only meeting's matters never
 *   reach a meeting the whole chapter attends. Every row keeps the audience
 *   it was written for (`audience_key`) and is read only for an event that
 *   invites the same people now: an event whose audience changes starts
 *   over, and decided rows teach only meetings with their audience.
 * - **Tabled first,** re-read on every list, with no model: the newest
 *   Tabled entry of each matter, unless an agenda already took it up.
 * - **Then the model's,** written once per event and audience when an
 *   editor first opens it, and again on Suggest again. Behind AI on the
 *   server, the chapter's meeting-notes switch and the member's yes (the
 *   gateway checks both, and records spend); without it the tabled matters
 *   still show.
 * - **Add** puts the item on the agenda through `EventService`, a tabled
 *   one with its `tabled_from`; **Dismiss** hides it for this event. Both are
 *   kept, words and all, as the examples the next prompt reads.
 */
@Injectable()
export class AgendaSuggestionService {
  private readonly logger = new Logger(AgendaSuggestionService.name);

  constructor(
    @Inject(EVENT_AGENDA_SUGGESTION_REPOSITORY)
    private readonly repo: IEventAgendaSuggestionRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
    @Inject(ROLE_TIER_REPOSITORY) private readonly tiers: IRoleTierRepository,
    @Inject(EVENT_TYPE_REPOSITORY)
    private readonly eventTypes: IEventTypeRepository,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapters: Pick<IChapterRepository, 'findById'>,
    private readonly events: EventService,
    private readonly meetings: MeetingService,
    private readonly rbac: RbacService,
    private readonly gateway: AiGatewayService,
    private readonly consent: AiConsentService,
  ) {}

  /** The event's Suggested list, its tabled matters brought up to date. */
  async list(
    chapterId: string,
    eventId: string,
    userId: string,
    options: AgendaSuggestionOptions = {},
  ): Promise<AgendaSuggestionList> {
    const context = await this.context(chapterId, eventId, userId, options);
    if (!context) return EMPTY;
    await this.syncTabled(context);
    return this.view(context);
  }

  /**
   * Asks the model for this event's suggestions, replacing the open ones it
   * wrote before; decided ones stay. Without AI, or when the call fails,
   * the list comes back as it was.
   */
  async refresh(
    chapterId: string,
    eventId: string,
    userId: string,
    options: AgendaSuggestionOptions = {},
  ): Promise<AgendaSuggestionList> {
    const context = await this.context(chapterId, eventId, userId, options);
    if (!context) return EMPTY;
    await this.syncTabled(context);
    if (await this.aiAvailable(chapterId, userId)) {
      await this.write(context, options.now ?? new Date());
    }
    return this.view(context);
  }

  /**
   * Adds an open suggestion this member can see to the end of the event's
   * agenda and marks it added. The agenda item's id is the suggestion's, so
   * an Add sent twice adds one item. Returns the agenda as saved.
   */
  async add(
    chapterId: string,
    eventId: string,
    suggestionId: string,
    userId: string,
    options: AgendaSuggestionOptions = {},
  ): Promise<{ agenda: EventAgendaItem[] }> {
    const context = await this.context(chapterId, eventId, userId, options);
    if (!context) throw new NotFoundException('Suggestion not found');
    const suggestion = await this.open(context, suggestionId);
    const from = tabledFromOf(suggestion);
    const item: EventAgendaItem = {
      id: agendaItemIdOf(suggestion.id),
      text: suggestion.text,
      done: false,
      ...(from ? { tabled_from: from } : {}),
    };
    const agenda = await this.events.appendAgendaItem(
      eventId,
      chapterId,
      item,
      options.now,
    );
    await this.repo.decide(chapterId, eventId, suggestion.id, {
      status: 'added',
      agenda_item_id: item.id,
      decided_by: userId,
      decided_at: (options.now ?? new Date()).toISOString(),
    });
    return { agenda };
  }

  /** Hides an open suggestion for this event, kept as an example. */
  async dismiss(
    chapterId: string,
    eventId: string,
    suggestionId: string,
    userId: string,
    options: AgendaSuggestionOptions = {},
  ): Promise<void> {
    const context = await this.context(chapterId, eventId, userId, options);
    if (!context) throw new NotFoundException('Suggestion not found');
    const suggestion = await this.open(context, suggestionId);
    await this.repo.decide(chapterId, eventId, suggestion.id, {
      status: 'dismissed',
      agenda_item_id: null,
      decided_by: userId,
      decided_at: (options.now ?? new Date()).toISOString(),
    });
  }

  /**
   * The event as this member sees it and its same-audience earlier minutes;
   * null for a meeting that has started (its agenda takes check-offs only,
   * Paul 2026-11-20), or a chapter with Events off, which are offered
   * nothing.
   */
  private async context(
    chapterId: string,
    eventId: string,
    userId: string,
    options: AgendaSuggestionOptions,
  ): Promise<Context | null> {
    const [event, chapter] = await Promise.all([
      this.events.findById(eventId, chapterId, userId),
      this.chapters.findById(chapterId),
    ]);
    if (!chapter || !isModuleEnabled(chapter.enabled_modules, 'events')) {
      return null;
    }
    const now = options.now ?? new Date();
    if (Date.parse(event.start_time) <= now.getTime()) return null;
    const earlier = await sameAudienceMinutes(this.meetings, this.events, {
      chapterId,
      userId,
      tonight: event,
      meetingType: null,
    });
    return {
      chapterId,
      userId,
      event,
      audience: audienceKey(event),
      earlier: earlier.map((entry) => entry.row),
      timeZone: validTimeZone(options.timeZone),
    };
  }

  /**
   * The open suggestions of the event this member may see: written for the
   * event's audience as it is now, and drawn from minutes they may read.
   */
  private visible(
    context: Context,
    rows: readonly EventAgendaSuggestion[],
  ): EventAgendaSuggestion[] {
    const readable = new Set(context.earlier.map((row) => row.id));
    return rows.filter(
      (row) =>
        row.status === 'open' &&
        row.audience_key === context.audience &&
        (row.source_meeting_id === null || readable.has(row.source_meeting_id)),
    );
  }

  private async open(
    context: Context,
    suggestionId: string,
  ): Promise<EventAgendaSuggestion> {
    const rows = await this.repo.listForEvent(
      context.chapterId,
      context.event.id,
    );
    const row = this.visible(context, rows).find(
      (entry) => entry.id === suggestionId,
    );
    if (!row) throw new NotFoundException('Suggestion not found');
    return row;
  }

  /**
   * Brings the event's open tabled suggestions up to date: a matter now
   * found is written (once per key, whatever became of it before), and an
   * open one no longer found (taken up by another agenda, its minutes
   * changed, or the event's audience changed) is taken back.
   */
  private async syncTabled(context: Context): Promise<void> {
    const { chapterId, event } = context;
    const minutes = context.earlier.map(sourceOf);
    const agenda = event.agenda ?? [];
    const all = tabledCandidates(minutes, agenda, new Set(), Infinity);
    const existing = await this.repo.listForEvent(chapterId, event.id);
    const added = await this.repo.addedKeys(
      chapterId,
      all.map((candidate) => candidate.key),
    );
    // Taken up by an agenda, or decided for this event: neither takes one of
    // the places, so the next matters still show.
    const excluded = new Set([
      ...added,
      ...existing
        .filter((row) => row.status !== 'open')
        .map((row) => row.dedupe_key),
    ]);
    const candidates = tabledCandidates(
      minutes,
      agenda,
      excluded,
      AGENDA_SUGGESTIONS_TABLED_MAX,
    );
    const wanted = new Set(candidates.map((candidate) => candidate.key));
    const stale = existing.filter(
      (row) =>
        row.kind === 'tabled' &&
        row.status === 'open' &&
        (!wanted.has(row.dedupe_key) || row.audience_key !== context.audience),
    );
    await this.repo.deleteOpen(
      chapterId,
      event.id,
      stale.map((row) => row.id),
    );
    const staleIds = new Set(stale.map((row) => row.id));
    const have = new Set(
      existing
        .filter((row) => !staleIds.has(row.id))
        .map((row) => row.dedupe_key),
    );
    const drafts: EventAgendaSuggestionDraft[] = candidates
      .filter((candidate) => !have.has(candidate.key))
      .map((candidate) => ({
        chapter_id: chapterId,
        event_id: event.id,
        kind: 'tabled',
        text: candidate.text,
        reason: null,
        source_meeting_id: candidate.sourceMeetingId,
        tabled_meeting_id: candidate.tabledFrom.meeting_id,
        tabled_start_time: candidate.tabledFrom.start_time,
        tabled_times: candidate.tabledFrom.times,
        dedupe_key: candidate.key,
        audience_key: context.audience,
      }));
    await this.repo.insertMany(drafts);
  }

  /** The model's suggestions for the event, written over its open ones. */
  private async write(context: Context, now: Date): Promise<void> {
    const { chapterId, event, userId } = context;
    const existing = await this.repo.listForEvent(chapterId, event.id);
    const replaced = existing.filter(
      (row) => row.kind === 'ai' && row.status === 'open',
    );
    const facts = await this.facts(context, existing);
    let generated: AiObjectResult<AgendaSuggestOutput>;
    try {
      generated = await this.gateway.generateObject(
        TASK,
        {
          promptVersion: AGENDA_SUGGEST_PROMPT_VERSION,
          system: agendaSuggestSystem(),
          messages: agendaSuggestMessages(facts),
          schema: AgendaSuggestOutputSchema,
        },
        { chapterId, actingUserId: userId },
      );
    } catch (error) {
      // A provider outage or a timeout: the list stays as it was, and the
      // next Suggest again tries again.
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'agenda-suggest',
        message: 'Agenda suggestions: the model call failed; list unchanged',
        error,
      });
      return;
    }
    if (generated.status !== 'ok') {
      // Off for this member or chapter since the check, the cap reached, a
      // refusal, or an answer that wasn't the shape asked for. Counted,
      // never quoted.
      this.logger.warn(`agenda suggestions not written (${generated.status})`);
      if (generated.status === 'unavailable') return;
      await this.saveRun(context, now);
      return;
    }
    // The open items this run replaces may come back: only what is decided,
    // or tabled, is already taken.
    const replacedIds = new Set(replaced.map((row) => row.id));
    const taken = new Set(
      existing
        .filter((row) => !replacedIds.has(row.id))
        .map((row) => row.dedupe_key),
    );
    const checked = checkAgendaSuggestions(generated.value, facts, taken);
    await this.repo.deleteOpen(
      chapterId,
      event.id,
      replaced.map((row) => row.id),
    );
    await this.repo.insertMany(
      checked.map((item) => ({
        chapter_id: chapterId,
        event_id: event.id,
        kind: 'ai' as const,
        text: item.text,
        reason: item.reason,
        source_meeting_id: item.sourceMeetingId,
        tabled_meeting_id: null,
        tabled_start_time: null,
        tabled_times: null,
        dedupe_key: item.key,
        audience_key: context.audience,
      })),
    );
    await this.saveRun(context, now);
  }

  private saveRun(context: Context, now: Date): Promise<void> {
    return this.repo.saveRun({
      event_id: context.event.id,
      chapter_id: context.chapterId,
      generated_by: context.userId,
      generated_at: now.toISOString(),
      audience_key: context.audience,
    });
  }

  /** What the model is told about the event, read as this member. */
  private async facts(
    context: Context,
    existing: readonly EventAgendaSuggestion[],
  ): Promise<AgendaSuggestFacts> {
    const { chapterId, event } = context;
    const [roles, tiers, identities, type, decided] = await Promise.all([
      this.rbac.findByChapter(chapterId),
      this.tiers.findByChapter(chapterId),
      this.members.findChapterMemberIdentities(chapterId),
      event.event_type_id
        ? this.eventTypes.findById(event.event_type_id, chapterId)
        : Promise.resolve(null),
      this.repo.listDecided(chapterId, DECIDED_READ),
    ]);
    const tierNames = new Map(tiers.map((tier) => [tier.id, tier.name]));
    const holders = new Map<string, number>();
    for (const member of identities) {
      for (const roleId of new Set(member.role_ids)) {
        holders.set(roleId, (holders.get(roleId) ?? 0) + 1);
      }
    }
    const byId = new Map(roles.map((role) => [role.id, role]));
    const roleFacts = (ids: readonly string[] | null): AgendaRoleFact[] =>
      [...new Set(ids ?? [])].flatMap((id) => {
        const role = byId.get(id);
        return role
          ? [
              {
                name: role.name,
                tier: role.tier_id
                  ? (tierNames.get(role.tier_id) ?? null)
                  : null,
                members: holders.get(id) ?? 0,
                does: rolePhrases(role.permissions),
              },
            ]
          : [];
      });

    const recent = context.earlier.slice(0, AGENDA_SUGGEST_MINUTES_MAX);
    const day = (iso: string) => dayOf(iso, context.timeZone);
    return {
      event: {
        name: event.name,
        type: type?.name ?? null,
        day: day(event.start_time),
        description: event.description,
      },
      audience: {
        required: roleFacts(event.required_role_ids),
        invited: roleFacts(event.optional_role_ids),
        leftOut: roleFacts(event.excluded_role_ids).map((role) => role.name),
        everyoneElse: eventOthersInvited(event),
      },
      agenda: (event.agenda ?? []).map((item) => item.text),
      tabled: existing
        .filter((row) => row.kind === 'tabled' && row.status === 'open')
        .map((row) => row.text),
      minutes: recent.map((row, index) => {
        const content = readMeetingContent(row.content);
        return {
          ref: `M${index + 1}`,
          meetingId: row.id,
          name: row.event_name,
          day: day(row.event_start_time),
          gist: minutesGist(content),
          topics: capList(topicLines(content.discussion_log)),
          // Only the last meeting's: what it assigned, and what it still
          // lists as open. An older meeting's may be done since.
          openItems:
            index === 0
              ? capList([
                  ...content.action_items.map((item) => item.text),
                  ...stillOpenItems(content.old_business).map(
                    (item) => item.text,
                  ),
                ])
              : [],
          reports: capList(reportingOffices(content.officer_reports)),
        };
      }),
      examples: examplesOf(decided, context.audience),
    };
  }

  /** The open suggestions this member may see, tabled first. */
  private async view(context: Context): Promise<AgendaSuggestionList> {
    const { chapterId, event, userId } = context;
    const [rows, run, aiAvailable] = await Promise.all([
      this.repo.listForEvent(chapterId, event.id),
      this.repo.findRun(chapterId, event.id),
      this.aiAvailable(chapterId, userId),
    ]);
    const shown = this.visible(context, rows);
    const tabled = shown
      .filter((row) => row.kind === 'tabled')
      .sort((a, b) =>
        (a.tabled_start_time ?? '').localeCompare(b.tabled_start_time ?? ''),
      );
    const ai = shown.filter((row) => row.kind === 'ai');
    return {
      suggestions: [...tabled, ...ai].map(toView),
      // A run for the audience the event had before counts as none.
      generated_at:
        run && run.audience_key === context.audience ? run.generated_at : null,
      ai_available: aiAvailable,
    };
  }

  /** Whether the model may write for this member: AI, switch and yes. */
  private async aiAvailable(
    chapterId: string,
    userId: string,
  ): Promise<boolean> {
    if (!isAiEnabled()) return false;
    const entry = aiCatalogEntry(TASK);
    const decision = await this.consent.check({
      chapterId,
      actingUserId: userId,
      task: TASK,
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: AGENDA_SUGGEST_PROMPT_VERSION,
    });
    return decision.allowed;
  }
}

const EMPTY: AgendaSuggestionList = {
  suggestions: [],
  generated_at: null,
  ai_available: false,
};

/**
 * The chapter's recently added and dismissed suggestions written for this
 * audience, as the prompt's examples. The same audience shows to the same
 * members, so they are never drawn from a meeting this member can't see.
 */
export function examplesOf(
  decided: readonly EventAgendaSuggestion[],
  audience: string,
): AgendaSuggestFacts['examples'] {
  const alike = decided.filter((row) => row.audience_key === audience);
  const pick = (status: 'added' | 'dismissed') =>
    [
      ...new Set(
        alike.filter((row) => row.status === status).map((row) => row.text),
      ),
    ].slice(0, AGENDA_SUGGEST_EXAMPLES_MAX);
  return { added: pick('added'), dismissed: pick('dismissed') };
}

function sourceOf(row: Meeting): AgendaSourceMinutes {
  return {
    id: row.id,
    event_name: row.event_name,
    event_start_time: row.event_start_time,
    content: readMeetingContent(row.content),
  };
}

function tabledFromOf(
  row: EventAgendaSuggestion,
): EventAgendaTabledFrom | null {
  return row.kind === 'tabled' &&
    row.tabled_meeting_id &&
    row.tabled_start_time &&
    row.tabled_times
    ? {
        meeting_id: row.tabled_meeting_id,
        start_time: row.tabled_start_time,
        times: row.tabled_times,
      }
    : null;
}

/** The agenda item a suggestion becomes: one per suggestion. */
export function agendaItemIdOf(suggestionId: string): string {
  return `s-${suggestionId}`;
}

function toView(row: EventAgendaSuggestion): AgendaSuggestion {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    tabled_from: tabledFromOf(row),
    source_meeting_id: row.source_meeting_id,
    reason: row.reason,
  };
}

/** The member's zone when the device sent a real one; UTC otherwise. */
function validTimeZone(zone: string | undefined): string {
  if (!zone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

/**
 * A day as the model reads it, in the member's zone: "Tuesday, November 11,
 * 2026", so an evening meeting west of Greenwich is still its own day.
 */
export function dayOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}
