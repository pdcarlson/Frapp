import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  STANDARDS_MEETING_TYPE,
  eventOthersInvited,
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
import { sameAudience } from './meeting-draft-context.service';
import { MeetingService } from './meeting.service';
import { RbacService } from './rbac.service';

const TASK = 'agenda.suggest';

/**
 * How many posted minutes before the event are read to find those with the
 * same audience: the window tabled matters and the model's facts come from.
 */
const EARLIER_MINUTES_READ = 25;
/** Decided suggestions read to find the examples with the same audience. */
const DECIDED_READ = 60;

/** The earlier minutes with the same audience, newest first. */
interface SameAudienceMinutes {
  rows: Meeting[];
}

/**
 * Suggested agenda items (#5534, `spec/behavior/events.md` § Suggested
 * agenda items, `spec/behavior/meetings.md` § Tabled items).
 *
 * - **Who:** a member who may edit the event (`events:update`, checked by
 *   the route) and can see it. Everything is read as that member: only
 *   minutes they may read, of events they can see.
 * - **Which minutes:** posted, before the event starts, never Standards, and
 *   only of events that invite the same people by the same rule
 *   (`sameAudience`), so an officers-only meeting's matters never reach a
 *   meeting the whole chapter attends.
 * - **Tabled first,** re-read on every list, with no model: the newest
 *   Tabled entry of each matter, unless an agenda already took it up.
 * - **Then the model's,** written once per event when an editor first opens
 *   it, and again on Suggest again. Behind AI on the server, the chapter's
 *   meeting-notes switch and the member's yes (the gateway checks both, and
 *   records spend); without it the tabled matters still show.
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
    now: Date = new Date(),
  ): Promise<AgendaSuggestionList> {
    const event = await this.events.findById(eventId, chapterId, userId);
    if (!isUpcoming(event, now)) {
      return { suggestions: [], generated_at: null, ai_available: false };
    }
    const earlier = await this.sameAudienceMinutes(chapterId, event, userId);
    await this.syncTabled(chapterId, event, earlier);
    return this.view(chapterId, event, userId, earlier);
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
    now: Date = new Date(),
  ): Promise<AgendaSuggestionList> {
    const event = await this.events.findById(eventId, chapterId, userId);
    if (!isUpcoming(event, now)) {
      return { suggestions: [], generated_at: null, ai_available: false };
    }
    const earlier = await this.sameAudienceMinutes(chapterId, event, userId);
    await this.syncTabled(chapterId, event, earlier);
    if (await this.aiAvailable(chapterId, userId)) {
      await this.write(chapterId, event, userId, earlier, now);
    }
    return this.view(chapterId, event, userId, earlier);
  }

  /**
   * Adds an open suggestion to the end of the event's agenda and marks it
   * added. The agenda item's id is the suggestion's, so an Add sent twice
   * adds one item. Returns the agenda as saved.
   */
  async add(
    chapterId: string,
    eventId: string,
    suggestionId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<{ agenda: EventAgendaItem[] }> {
    await this.events.findById(eventId, chapterId, userId);
    const suggestion = await this.open(chapterId, eventId, suggestionId);
    const from = tabledFromOf(suggestion);
    const item: EventAgendaItem = {
      id: agendaItemIdOf(suggestion.id),
      text: suggestion.text,
      done: false,
      ...(from ? { tabled_from: from } : {}),
    };
    const agenda = await this.events.appendAgendaItem(eventId, chapterId, item);
    await this.repo.decide(chapterId, eventId, suggestion.id, {
      status: 'added',
      agenda_item_id: item.id,
      decided_by: userId,
      decided_at: now.toISOString(),
    });
    return { agenda };
  }

  /** Hides an open suggestion for this event, kept as an example. */
  async dismiss(
    chapterId: string,
    eventId: string,
    suggestionId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.events.findById(eventId, chapterId, userId);
    const suggestion = await this.open(chapterId, eventId, suggestionId);
    await this.repo.decide(chapterId, eventId, suggestion.id, {
      status: 'dismissed',
      agenda_item_id: null,
      decided_by: userId,
      decided_at: now.toISOString(),
    });
  }

  private async open(
    chapterId: string,
    eventId: string,
    suggestionId: string,
  ): Promise<EventAgendaSuggestion> {
    const row = (await this.repo.listForEvent(chapterId, eventId)).find(
      (entry) => entry.id === suggestionId && entry.status === 'open',
    );
    if (!row) throw new NotFoundException('Suggestion not found');
    return row;
  }

  /**
   * Posted minutes before the event that this member may read, of events
   * they can see that invite the same people by the same rule, newest
   * first. Never Standards; never the event's own minutes.
   */
  private async sameAudienceMinutes(
    chapterId: string,
    event: Event,
    userId: string,
  ): Promise<SameAudienceMinutes> {
    const rows = (
      await this.meetings.listPostedBefore(
        chapterId,
        userId,
        event.start_time,
        null,
        EARLIER_MINUTES_READ,
      )
    ).filter(
      (row) =>
        row.event_id !== null &&
        row.event_id !== event.id &&
        (row.meeting_type as string) !== STANDARDS_MEETING_TYPE,
    );
    if (rows.length === 0) return { rows: [] };
    const visible = new Map(
      (
        await this.events.findVisibleByIds(
          rows.map((row) => row.event_id as string),
          chapterId,
          userId,
        )
      ).map((visibleEvent) => [visibleEvent.id, visibleEvent]),
    );
    return {
      rows: rows.filter((row) => {
        const source = visible.get(row.event_id as string);
        return source !== undefined && sameAudience(source, event);
      }),
    };
  }

  /**
   * Brings the event's open tabled suggestions up to date: a matter now
   * found is written (once per key, whatever became of it before), and an
   * open one no longer found (taken up by another agenda, its minutes
   * changed) is taken back.
   */
  private async syncTabled(
    chapterId: string,
    event: Event,
    earlier: SameAudienceMinutes,
  ): Promise<void> {
    const minutes = earlier.rows.map(sourceOf);
    const all = tabledCandidates(minutes, event.agenda ?? []);
    const added = await this.repo.addedKeys(
      chapterId,
      all.map((candidate) => candidate.key),
    );
    const candidates = all.filter((candidate) => !added.has(candidate.key));
    const wanted = new Set(candidates.map((candidate) => candidate.key));
    const existing = await this.repo.listForEvent(chapterId, event.id);
    const stale = existing.filter(
      (row) =>
        row.kind === 'tabled' &&
        row.status === 'open' &&
        !wanted.has(row.dedupe_key),
    );
    await this.repo.deleteOpen(
      chapterId,
      event.id,
      stale.map((row) => row.id),
    );
    const have = new Set(existing.map((row) => row.dedupe_key));
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
      }));
    await this.repo.insertMany(drafts);
  }

  /** The model's suggestions for the event, written over its open ones. */
  private async write(
    chapterId: string,
    event: Event,
    userId: string,
    earlier: SameAudienceMinutes,
    now: Date,
  ): Promise<void> {
    const existing = await this.repo.listForEvent(chapterId, event.id);
    const facts = await this.facts(chapterId, event, userId, earlier, existing);
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
      await this.saveRun(chapterId, event.id, userId, now);
      return;
    }
    const taken = new Set(existing.map((row) => row.dedupe_key));
    const checked = checkAgendaSuggestions(generated.value, facts, taken);
    await this.repo.deleteOpen(
      chapterId,
      event.id,
      existing
        .filter((row) => row.kind === 'ai' && row.status === 'open')
        .map((row) => row.id),
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
      })),
    );
    await this.saveRun(chapterId, event.id, userId, now);
  }

  private saveRun(
    chapterId: string,
    eventId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    return this.repo.saveRun({
      event_id: eventId,
      chapter_id: chapterId,
      generated_by: userId,
      generated_at: now.toISOString(),
    });
  }

  /** What the model is told about the event, read as this member. */
  private async facts(
    chapterId: string,
    event: Event,
    userId: string,
    earlier: SameAudienceMinutes,
    existing: readonly EventAgendaSuggestion[],
  ): Promise<AgendaSuggestFacts> {
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

    const recent = earlier.rows.slice(0, AGENDA_SUGGEST_MINUTES_MAX);
    const examples = await this.examples(chapterId, event, userId, decided);
    return {
      event: {
        name: event.name,
        type: type?.name ?? null,
        day: dayOf(event.start_time),
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
        .filter((row) => row.kind === 'tabled')
        .map((row) => row.text),
      minutes: recent.map((row, index) => {
        const content = readMeetingContent(row.content);
        return {
          ref: `M${index + 1}`,
          meetingId: row.id,
          name: row.event_name,
          day: dayOf(row.event_start_time),
          gist: minutesGist(content),
          topics: capList(topicLines(content.discussion_log)),
          openItems: capList([
            ...content.action_items.map((item) => item.text),
            ...stillOpenItems(content.old_business).map((item) => item.text),
          ]),
          reports: capList(reportingOffices(content.officer_reports)),
        };
      }),
      examples,
    };
  }

  /**
   * The chapter's recently added and dismissed suggestions for events that
   * invite the same people, as the prompt's examples. Only of events this
   * member can see.
   */
  private async examples(
    chapterId: string,
    event: Event,
    userId: string,
    decided: readonly EventAgendaSuggestion[],
  ): Promise<AgendaSuggestFacts['examples']> {
    if (decided.length === 0) return { added: [], dismissed: [] };
    const visible = new Map(
      (
        await this.events.findVisibleByIds(
          decided.map((row) => row.event_id),
          chapterId,
          userId,
        )
      ).map((other) => [other.id, other]),
    );
    const alike = decided.filter((row) => {
      const other = visible.get(row.event_id);
      return other !== undefined && sameAudience(other, event);
    });
    const pick = (status: 'added' | 'dismissed') =>
      [
        ...new Set(
          alike.filter((row) => row.status === status).map((row) => row.text),
        ),
      ].slice(0, AGENDA_SUGGEST_EXAMPLES_MAX);
    return { added: pick('added'), dismissed: pick('dismissed') };
  }

  /** The open suggestions this member may see, tabled first. */
  private async view(
    chapterId: string,
    event: Event,
    userId: string,
    earlier: SameAudienceMinutes,
  ): Promise<AgendaSuggestionList> {
    const [rows, run, aiAvailable] = await Promise.all([
      this.repo.listForEvent(chapterId, event.id),
      this.repo.findRun(chapterId, event.id),
      this.aiAvailable(chapterId, userId),
    ]);
    // A suggestion drawn from minutes this member may not read isn't shown
    // to them, whoever's view wrote it.
    const readable = new Set(earlier.rows.map((row) => row.id));
    const shown = rows.filter(
      (row) =>
        row.status === 'open' &&
        (row.source_meeting_id === null || readable.has(row.source_meeting_id)),
    );
    const tabled = shown
      .filter((row) => row.kind === 'tabled')
      .sort((a, b) =>
        (a.tabled_start_time ?? '').localeCompare(b.tabled_start_time ?? ''),
      );
    const ai = shown.filter((row) => row.kind === 'ai');
    return {
      suggestions: [...tabled, ...ai].map(toView),
      generated_at: run?.generated_at ?? null,
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

/** Suggestions are for a meeting still to come. */
function isUpcoming(event: Event, now: Date): boolean {
  return Date.parse(event.end_time) > now.getTime();
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

/** A day as the model reads it: "Tuesday, 2026-11-11". */
function dayOf(iso: string): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(date);
  return `${weekday}, ${iso.slice(0, 10)}`;
}
