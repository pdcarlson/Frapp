import {
  Inject,
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type {
  IEventRepository,
  OccurrenceCarry,
} from '#domain/repositories/event.repository.interface';
import { Event } from '#domain/entities/event.entity';
import type { EventExcuse } from '#domain/entities/event-excuse.entity';
import {
  advanceRepeatRule,
  shiftRepeatRule,
  checkSeriesLength,
  isRepeatRule,
  seriesChildStarts,
} from '@repo/validation';
import {
  EventAnnouncementService,
  eventChangeOf,
} from './event-announcement.service';
import type { EventChange } from './event-announcement.service';
import { normalizeCheckInZone } from './event-input';
import { NotificationService } from './notification.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import type { UpdateEventInput } from './event-input';

/**
 * Fields whose change forces future instances to be regenerated rather than
 * patched, because they determine *when* the generated occurrences fall.
 *
 * Compared by value, not by presence: a client that PATCHes the whole event
 * object back (as the web editor did until #3667, and an older build or
 * another API caller still may) would otherwise trigger a destructive
 * regenerate on every save. Regeneration deletes rows, and `event_attendance` is
 * `on delete cascade`, so a needless regenerate is a data-loss bug.
 */
const RECURRENCE_DEFINING_FIELDS = [
  'recurrence_rule',
  'start_time',
  'end_time',
] as const satisfies readonly (keyof UpdateEventInput)[];

/**
 * Fields that are meaningful on a generated instance and therefore propagate
 * when a series is patched in place.
 *
 * `start_time` / `end_time` are excluded because each occurrence owns its own
 * times; `recurrence_rule` because only the parent carries one (children are
 * generated with `null`); `parent_event_id` because propagating it would
 * re-point the series at itself.
 */
function propagatableFields(
  input: UpdateEventInput,
): Omit<UpdateEventInput, 'start_time' | 'end_time' | 'recurrence_rule'> {
  const propagate: UpdateEventInput = { ...input };
  delete propagate.start_time;
  delete propagate.end_time;
  delete propagate.recurrence_rule;
  return propagate;
}

/**
 * How far a rebuilt meeting may sit from where an old one was expected to land
 * and still count as the same meeting, moved (#4620). Covers a structured
 * rule keeping its wall-clock time across a DST change, which moves an
 * instant by an hour, and stays well under the gap between two meetings of
 * any rule (a day, at the closest).
 */
const CARRY_TOLERANCE_MS = 3 * 60 * 60 * 1000;

/**
 * Pair each upcoming occurrence a series edit is about to delete with the
 * rebuilt one that replaces it, so its excuses can move there (#4620).
 *
 * An old meeting is expected to land where it was plus the shift the edit
 * moved the series by (`shiftMs`, zero when the start did not move), which is
 * what rescheduling a recurring meeting means (see `splitStartedHead`). It
 * pairs with the rebuilt meeting nearest that instant, within
 * `CARRY_TOLERANCE_MS`, each rebuilt meeting taken once. So a series moved an
 * hour later carries every excuse an hour later; weekly made every two weeks
 * carries the excuses on the meetings that stay; and a meeting with no
 * rebuilt one near it (its day left the rule, or it was individually moved)
 * carries nothing rather than a guess. Its members are told instead
 * (`tellDroppedExcuses`).
 *
 * A meeting the shifted pass leaves unpaired then tries its own instant, with
 * no shift. That is what a retried edit needs: when the parent write after a
 * committed swap fails, the old rows are already at the new times while the
 * parent still reads the old start, so the shift is counted again, and
 * without this pass a retried move of a day would carry nothing.
 */
export function pairReplacedOccurrences(
  old: readonly Event[],
  rebuilt: readonly Event[],
  shiftMs: number,
): OccurrenceCarry[] {
  const startOf = (row: Event) => new Date(row.start_time).getTime();
  const open = [...rebuilt];
  const pairs: OccurrenceCarry[] = [];
  let unpaired = [...old].sort((a, b) => startOf(a) - startOf(b));
  for (const shift of shiftMs === 0 ? [0] : [shiftMs, 0]) {
    const left: Event[] = [];
    for (const from of unpaired) {
      const expected = startOf(from) + shift;
      let best = -1;
      let bestGap = Infinity;
      open.forEach((row, i) => {
        const gap = Math.abs(startOf(row) - expected);
        if (gap <= CARRY_TOLERANCE_MS && gap < bestGap) {
          best = i;
          bestGap = gap;
        }
      });
      if (best === -1) {
        left.push(from);
        continue;
      }
      pairs.push({ from: from.id, to: open[best].id });
      open.splice(best, 1);
    }
    unpaired = left;
  }
  return pairs;
}

/**
 * Recurring events: materializing a parent's generated occurrences, and every
 * write that addresses a whole series (`scope:'series'` updates and deletes,
 * plus handing a series on when its head is canceled as a single instance).
 * Split out of `EventService` (#3270); `EventService` still owns validation
 * of the request and the single-row paths, and calls in here.
 */
@Injectable()
export class EventSeriesService {
  private readonly logger = new Logger(EventSeriesService.name);

  constructor(
    @Inject(EVENT_REPOSITORY) private readonly eventRepo: IEventRepository,
    private readonly announcements: EventAnnouncementService,
    private readonly notifications: NotificationService,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
  ) {}

  /**
   * Materialize the generated occurrences of a recurring parent, in one
   * insert: they all land or none do. The caller owns the parent row and
   * decides what a failure means for it (`EventService.create` deletes it).
   */
  async generateRecurringInstances(parent: Event): Promise<Event[]> {
    return this.eventRepo.createMany(this.buildOccurrencePayloads(parent));
  }

  /**
   * Swap a series' upcoming occurrences for freshly built ones (#3235).
   *
   * Inserts first, as one statement, and only then deletes the old rows by
   * the ids read before the insert. So when the replacement list is non-empty,
   * no failure leaves the head without upcoming occurrences. (An empty list,
   * from clearing the rule, deletes them on purpose; `updateSeries` checks the
   * count before it gets here.)
   *
   * A failed write is not taken at its word: an insert or delete can commit
   * and still report an error (a reset or timeout on the response). So on any
   * failure the head's occurrences are read back. If the old rows are gone and
   * every new one landed, the swap did happen: that is logged and the call
   * succeeds. Otherwise whatever new rows landed are deleted, which puts the
   * series back as it was, and the original error surfaces. Only when that
   * read or delete fails too can the series carry both sets, and that is
   * reported with the ids.
   *
   * `existingIds` are all of the head's occurrences before the swap, so rows
   * the insert added can be told apart from ones it did not touch.
   *
   * The old rows' excuses move to the rebuilt meetings that replace them
   * (`pairReplacedOccurrences`) in the same transaction as the delete, so a
   * failed delete leaves them on the old rows, where the recovery below keeps
   * them (#4620). The pending and approved excuses that had nowhere to go
   * are deleted with the rows, and their members are told as soon as that
   * commits (`tellDroppedExcuses`), not after the caller's later writes: those
   * can fail and leave the swap standing. A swap that only reads back as
   * committed tells nobody, since which excuses it dropped went with the lost
   * response; that is the one case an excuse goes without a word.
   */
  private async replaceOccurrences(swap: {
    headId: string;
    chapterId: string;
    existingIds: string[];
    old: Event[];
    replacements: Partial<Event>[];
    shiftMs: number;
    /** The series' name, for the push to members whose excuse was dropped. */
    name: string;
  }): Promise<void> {
    const { headId, chapterId, existingIds, old, replacements, shiftMs } = swap;
    const oldIds = old.map((row) => row.id);
    let dropped: EventExcuse[];
    try {
      const rebuilt = await this.eventRepo.createMany(replacements);
      dropped = await this.eventRepo.deleteReplacedOccurrences(
        oldIds,
        chapterId,
        pairReplacedOccurrences(old, rebuilt, shiftMs),
      );
    } catch (error) {
      let landedIds: string[] = [];
      try {
        const after = await this.eventRepo.findChildren(headId, chapterId);
        const existing = new Set(existingIds);
        const old = new Set(oldIds);
        landedIds = after
          .filter((row) => !existing.has(row.id))
          .map((row) => row.id);
        const oldLeft = after.some((row) => old.has(row.id));
        if (!oldLeft && landedIds.length === replacements.length) {
          reportCaughtFailure(this.logger, {
            level: 'warning',
            site: 'event-series-regenerate-committed',
            message: `Series regenerate of ${headId} reported a failure, but reading it back shows the swap landed; carrying on.`,
            error,
          });
          return;
        }
        if (landedIds.length > 0) {
          await this.eventRepo.deleteMany(landedIds, chapterId);
        }
      } catch (cleanupError) {
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'event-series-regenerate-cleanup',
          message: `Series regenerate of ${headId} failed, and so did putting its occurrences back. It may carry both the old and the new ones${landedIds.length > 0 ? ` (new: ${landedIds.join(', ')})` : ''}; check it by hand.`,
          error: cleanupError,
        });
      }
      throw error;
    }
    await this.tellDroppedExcuses(chapterId, {
      headId,
      name: swap.name,
      ended: replacements.length === 0,
      dropped,
    });
  }

  /**
   * Build the rows for a recurring parent's generated occurrences. Pure — no
   * writes — so a regenerate can be judged before anything is destroyed.
   *
   * When they fall is `seriesChildStarts` in `@repo/validation`, the same
   * stepper the Repeat controls caption a series from, so what an officer is
   * told and what gets written cannot drift apart. A structured rule steps in
   * its own zone, keeping the wall-clock time across DST (#3662); a legacy
   * token steps in UTC as it always did.
   *
   * For a legacy token, skipping rather than filtering is load-bearing: its
   * run is counted from `skipBefore`, not from the head. Filtering a fixed
   * window anchored on the parent's original `start_time` meant that once a
   * series grew older than that window — 12 weeks, or 6 months — every
   * candidate fell in the past and a rule change regenerated **nothing**,
   * leaving a parent advertising a rule with no occurrences behind it. A
   * structured rule's `COUNT` or `UNTIL` is fixed from the head, so for one
   * the past meetings are filtered out and only those still to come are made.
   */
  private buildOccurrencePayloads(
    parent: Event,
    skipBefore?: number,
  ): Partial<Event>[] {
    const starts = seriesChildStarts(
      parent.recurrence_rule,
      parent.start_time,
      skipBefore,
    );
    if (!starts) return [];

    // Derive each occurrence's end from its own start plus the parent's
    // duration. Clamping start and end independently against their own months
    // could invert the interval: a MONTHLY event running 2027-01-29T20:00Z to
    // 2027-01-30T08:00Z generated a February occurrence ending twelve hours
    // before it began, slipping past the `end <= start` guard that `create` and
    // `update` both enforce.
    const durationMs =
      new Date(parent.end_time).getTime() -
      new Date(parent.start_time).getTime();

    return starts.map((instanceStart) => ({
      chapter_id: parent.chapter_id,
      name: parent.name,
      description: parent.description,
      location: parent.location,
      start_time: instanceStart.toISOString(),
      end_time: new Date(instanceStart.getTime() + durationMs).toISOString(),
      point_value: parent.point_value,
      is_mandatory: parent.is_mandatory,
      recurrence_rule: null,
      parent_event_id: parent.id,
      required_role_ids: parent.required_role_ids,
      optional_role_ids: parent.optional_role_ids,
      excluded_role_ids: parent.excluded_role_ids,
      others_invited: parent.others_invited,
      notes: parent.notes,
      // The zone is part of "where this event is", so every occurrence needs
      // it — without this a weekly meeting's check-in geofence applied only to
      // the first date, and a series edit that patches future instances would
      // set a zone that a later regenerate silently dropped again.
      check_in_zone: parent.check_in_zone,
      check_in_zone_name: parent.check_in_zone_name,
      check_in_opens_minutes: parent.check_in_opens_minutes,
      // A weekly chapter meeting is a chapter meeting every week.
      event_type_id: parent.event_type_id,
      // Whoever made the series made each of its meetings.
      created_by: parent.created_by,
    }));
  }

  /**
   * Resolve the row a series operation should act on.
   *
   * A client may hold any occurrence of a series, so `scope:'series'` on a
   * generated child means "the series this belongs to". A child whose parent has
   * since been deleted has a dangling `parent_event_id` (the column is
   * `on delete set null`, but a row read before that fires still carries it), so
   * an unresolvable parent degrades to treating the child as its own series head
   * rather than 404-ing on a row the caller never named.
   */
  private async resolveSeriesParent(
    event: Event,
    chapterId: string,
  ): Promise<Event> {
    if (!event.parent_event_id) return event;
    const parent = await this.eventRepo.findById(
      event.parent_event_id,
      chapterId,
    );
    return parent ?? event;
  }

  /**
   * Split a series into the occurrences a write may touch and those it may not.
   *
   * The boundary is time, evaluated server-side — never a flag the caller sends.
   * `event_attendance.event_id` is `on delete cascade`, so letting a series
   * operation reach a past occurrence would not just edit history, it would
   * destroy the attendance record for a meeting that already happened.
   *
   * Children are not assumed to fall after their parent: an individually-edited
   * instance (which `spec/behavior/events.md` explicitly allows) can be moved
   * anywhere, so every row is partitioned on its own `start_time`.
   */
  private partitionByTime(
    events: Event[],
    now: number,
  ): { future: Event[]; past: Event[] } {
    const future: Event[] = [];
    const past: Event[] = [];
    for (const event of events) {
      if (new Date(event.start_time).getTime() > now) future.push(event);
      else past.push(event);
    }
    return { future, past };
  }

  /**
   * Apply an edit to a whole recurring series — the parent and every *future*
   * occurrence. Past occurrences are never in the write set.
   */
  async updateSeries(
    target: Event,
    chapterId: string,
    input: UpdateEventInput,
    actorId?: string,
  ): Promise<Event> {
    const parent = await this.resolveSeriesParent(target, chapterId);

    // A series edit issued against a *child* carries that child's times, not the
    // series anchor's. A client that round-trips the whole event object (both
    // apps did before they sent only what changed, #3667) sends a rename
    // saved from a later occurrence carrying that occurrence's
    // `start_time` — which is not a request to move the series, it is whichever
    // row the client happened to have open. Honouring it dragged the anchor onto
    // the child's date and rebuilt every future occurrence with fresh ids.
    const issuedFromChild = target.id !== parent.id;
    const effective: UpdateEventInput = { ...input };
    if (issuedFromChild) {
      delete effective.start_time;
      delete effective.end_time;
      // Dropping the times can empty the patch. Say so rather than reporting a
      // 200 for a request that wrote nothing anywhere.
      if (Object.keys(effective).length === 0) {
        throw new BadRequestException(
          'A series edit issued from a generated occurrence cannot move the series. Address the series head to change its times.',
        );
      }
    }

    // Re-validate against the row actually being written — a series edit lands
    // on the parent, and an individually-moved child can have entirely
    // different times, so a patch valid against the child can still invert the
    // parent's interval.
    if (effective.start_time || effective.end_time) {
      const start = new Date(effective.start_time ?? parent.start_time);
      const end = new Date(effective.end_time ?? parent.end_time);
      if (end <= start) {
        throw new BadRequestException(
          'end_time must be after start_time for the series',
        );
      }
    }

    const normalized: UpdateEventInput = {
      ...effective,
      ...(effective.check_in_zone !== undefined
        ? { check_in_zone: normalizeCheckInZone(effective.check_in_zone) }
        : {}),
    };

    // Compare instants rather than strings for the date fields: Postgres returns
    // `+00:00` where a client sends `Z`, and a spelling difference is not a
    // change. Treating it as one would delete and rebuild the future half of the
    // series on a no-op save, cascading away any attendance those rows carry.
    const hasChanged = (field: (typeof RECURRENCE_DEFINING_FIELDS)[number]) => {
      const next = effective[field];
      if (next === undefined) return false;
      const current = parent[field];
      if (field === 'recurrence_rule') return next !== current;
      if (typeof next !== 'string' || typeof current !== 'string') {
        return next !== current;
      }
      return new Date(next).getTime() !== new Date(current).getTime();
    };
    const regenerates = RECURRENCE_DEFINING_FIELDS.some(hasChanged);

    // `??` here would read an explicit `recurrence_rule: null` — the caller
    // ending the series — as "unchanged" and fall through to the parent's rule.
    // That was harmless while this value only gated the check below, but the
    // split path also *writes* it to the new head, where it would resurrect a
    // series the caller just cleared.
    const callerRule =
      normalized.recurrence_rule !== undefined
        ? normalized.recurrence_rule
        : parent.recurrence_rule;
    const keptRule = callerRule === parent.recurrence_rule;

    // Moving the head moves the series: a structured rule names its days, so
    // a kept rule's days move with the head (`shiftRepeatRule`), or a series
    // moved from Monday to Tuesday would rebuild on Mondays behind its new
    // Tuesday head. A legacy token steps from the head and needs nothing.
    const nextRule =
      keptRule && hasChanged('start_time')
        ? shiftRepeatRule(
            callerRule,
            parent.start_time,
            normalized.start_time as string,
          )
        : callerRule;

    // Refuse a rule this service cannot generate from *before* touching
    // anything. The old order deleted the whole future half of the series and
    // only then discovered it had nothing to rebuild with. The DTO already
    // checks the rule's shape; this also catches one that doesn't fit the
    // series' first meeting (an UNTIL before its second, or past the cap).
    //
    // A started head is checked in `splitStartedHead` instead, against the
    // meeting that becomes the series' first: the head itself is retired.
    const now = Date.now();
    const headStarted = new Date(parent.start_time).getTime() <= now;
    if (regenerates && nextRule) {
      if (!isRepeatRule(nextRule)) {
        throw new BadRequestException('recurrence_rule is not a repeat rule');
      }
      if (!headStarted) {
        const problem = checkSeriesLength(
          nextRule,
          normalized.start_time ?? parent.start_time,
        );
        if (problem) throw new BadRequestException(problem);
      }
    }

    // What members are told moved, judged against the series as it stood.
    const change = eventChangeOf(parent, normalized);

    // Resolve children before any write: `parent_event_id` is
    // `on delete set null`, so a parent removed first takes the pointers with it.
    const children = await this.eventRepo.findChildren(parent.id, chapterId);

    // How the caller moved the head, kept as a *shift* rather than as the
    // literal instants they sent. The split path below re-times a different
    // occurrence, and `null` duration means "leave each occurrence's own length
    // alone" — an individually-lengthened child must not silently inherit the
    // parent's duration from an edit that never mentioned time.
    const startShiftMs = hasChanged('start_time')
      ? new Date(normalized.start_time as string).getTime() -
        new Date(parent.start_time).getTime()
      : 0;
    const nextDurationMs =
      hasChanged('start_time') || hasChanged('end_time')
        ? new Date(normalized.end_time ?? parent.end_time).getTime() -
          new Date(normalized.start_time ?? parent.start_time).getTime()
        : null;

    // The head is both the series template and the series' own first
    // occurrence. Once it has started, writing the patch to it edits a meeting
    // that already happened, and its `event_attendance` rows then describe an
    // event as it never was.
    if (headStarted) {
      return this.splitStartedHead({
        parent,
        children,
        chapterId,
        normalized,
        regenerates,
        nextRule,
        keptRule,
        startShiftMs,
        nextDurationMs,
        now,
        change,
        actorId,
      });
    }

    const { future } = this.partitionByTime(children, now);

    let updatedParent: Event;
    if (regenerates) {
      // Occurrences first, then the parent (#3235). The parent's write is what
      // a retry compares against: had it landed first and the regenerate then
      // failed, the retried edit would read as "no change", skip the
      // regenerate, and leave the old schedule under the new rule for good.
      // In this order a failure anywhere before the parent write leaves a
      // retry that still regenerates, and replacing the occurrences again is
      // safe because it rebuilds whatever upcoming rows the parent has.
      const written: UpdateEventInput = {
        ...normalized,
        recurrence_rule: nextRule,
      };
      const template: Event = { ...parent, ...written };
      await this.replaceOccurrences({
        headId: parent.id,
        chapterId,
        existingIds: children.map((child) => child.id),
        old: future,
        replacements: this.buildOccurrencePayloads(template, now),
        shiftMs: startShiftMs,
        name: template.name,
      });
      updatedParent = await this.eventRepo.update(
        parent.id,
        chapterId,
        written,
      );
    } else {
      updatedParent = await this.eventRepo.update(
        parent.id,
        chapterId,
        normalized,
      );
      const propagate = propagatableFields(normalized);
      if (Object.keys(propagate).length > 0) {
        await this.eventRepo.updateMany(
          future.map((child) => child.id),
          chapterId,
          propagate,
        );
      }
    }

    await this.announcements.notifyEventUpdated(
      chapterId,
      updatedParent,
      change,
      actorId,
    );

    return updatedParent;
  }

  /**
   * Apply a `series` edit whose head has already started, by splitting the
   * head's two roles apart instead of trying to guard one of them.
   *
   * #1391 attempted the guard — restrict a started head's write to
   * `recurrence_rule` — and it was strictly worse in three measured ways, all
   * with the same root cause: **regeneration still read the parent as the
   * template.** A head-addressed reschedule was dropped from the parent write
   * but still counted as a regenerate, so the series was rebuilt from the
   * unchanged anchor and the requested move vanished along with every future
   * occurrence's id; non-time edits propagated to the children but not to the
   * template, so the next rule change resurrected the old name and dropped the
   * `check_in_zone`; and a child-issued time-only edit became a silent 200.
   *
   * So the template moves. The started head is retired into standalone history
   * — `recurrence_rule` cleared and **no other field written** — and the
   * earliest upcoming occurrence becomes the new head carrying the caller's
   * changes. From here on that row is what `buildOccurrencePayloads` reads, so
   * a later rule change regenerates from current values rather than stale ones.
   *
   * **The series head's id changes.** That is deliberate, and it is not new:
   * `delete` with `instance` scope on a series head already does it through
   * `promoteSuccessor`. The old id keeps resolving to the meeting that actually
   * took place, which is the right target for a chat event card, a notification
   * deep link (`data.target.eventId`) or an exported `.ics` — each was created
   * for that occurrence, not for the series.
   */
  private async splitStartedHead(args: {
    parent: Event;
    children: Event[];
    chapterId: string;
    normalized: UpdateEventInput;
    regenerates: boolean;
    nextRule: string | null;
    keptRule: boolean;
    startShiftMs: number;
    nextDurationMs: number | null;
    now: number;
    change: EventChange | null;
    actorId?: string;
  }): Promise<Event> {
    const {
      parent,
      children,
      chapterId,
      normalized,
      regenerates,
      nextRule,
      keptRule,
      startShiftMs,
      nextDurationMs,
      now,
      change,
      actorId,
    } = args;

    const { future, past } = this.partitionByTime(children, now);

    // Nothing upcoming means every row this edit could reach is history, and
    // the whole point here is not to rewrite that. Refuse out loud: #1391's
    // third regression was a silent 200 that wrote nothing anywhere.
    if (future.length === 0) {
      throw new BadRequestException(
        'This series has no upcoming occurrences, so a series edit would only rewrite meetings that have already happened. Edit an occurrence directly with instance scope.',
      );
    }

    const [successor, ...rest] = future;

    // Re-time by the caller's shift, never by the instants they sent. Their
    // `start_time` describes the *old* head and is in the past; writing it onto
    // the successor would anchor the series behind `now` — the exact failure
    // `promoteSuccessor`'s docblock records. Moving the head 18:00 -> 19:00
    // moves every upcoming occurrence an hour later, which is what
    // rescheduling a recurring meeting means.
    const retimed: Partial<Event> = {};
    if (startShiftMs !== 0 || nextDurationMs !== null) {
      const startMs = new Date(successor.start_time).getTime() + startShiftMs;
      if (startMs <= now) {
        throw new BadRequestException(
          'That change would move the next occurrence into the past. Shift the series by less, or edit the remaining occurrences individually.',
        );
      }
      const durationMs =
        nextDurationMs ??
        new Date(successor.end_time).getTime() -
          new Date(successor.start_time).getTime();
      retimed.start_time = new Date(startMs).toISOString();
      retimed.end_time = new Date(startMs + durationMs).toISOString();
    }

    const carried = propagatableFields(normalized);

    // The rule the new head carries. When the caller kept the rule it is
    // handed on from the retired head (`advanceRepeatRule`): a COUNT drops by
    // the meetings of the pattern before the new head, canceled ones
    // included, or the next regenerate would add that many at the end, and a
    // rule with fewer than two meetings left ends. Both starts move by the
    // caller's shift, as `nextRule`'s days already have. A rule the caller
    // changed is theirs as sent.
    const newHeadStart = retimed.start_time ?? successor.start_time;
    const seriesRule = keptRule
      ? advanceRepeatRule(
          nextRule,
          new Date(new Date(parent.start_time).getTime() + startShiftMs),
          newHeadStart,
        )
      : nextRule;

    // The successor is the series' first meeting from here, so a regenerated
    // rule must fit it, not the retired head: an UNTIL that leaves it no
    // second meeting would otherwise make a lone head that still carries a
    // rule. Checked before the first write.
    if (regenerates && seriesRule) {
      const problem = checkSeriesLength(seriesRule, newHeadStart);
      if (problem) throw new BadRequestException(problem);
    }

    // Retire the head. `recurrence_rule` and nothing else: every one of its own
    // fields keeps the value it had while the meeting was happening, so the
    // `event_attendance` rows hanging off it still describe it accurately.
    //
    // Retired *before* the successor is promoted, not after. These writes are
    // not in one transaction, and the two orders fail differently: retiring
    // first and then failing leaves a series with no head, which reads as "the
    // series ended" and is recoverable; promoting first and then failing leaves
    // the old head and the successor both carrying the rule — two live series
    // over the same occurrences.
    await this.eventRepo.update(parent.id, chapterId, {
      recurrence_rule: null,
    });

    // Past occurrences belong to the series that just ended. Detached, not
    // deleted — `event_attendance.event_id` is `on delete cascade`, and this is
    // exactly how `deleteSeries` and `promoteSuccessor` already treat them.
    if (past.length > 0) {
      await this.eventRepo.updateMany(
        past.map((child) => child.id),
        chapterId,
        { parent_event_id: null },
      );
    }

    // The successor becomes the series, carrying the caller's changes. A
    // `nextRule` of null means they cleared the rule: the series ends here and
    // this row survives as a standalone event with the edit applied, rather
    // than the edit landing nowhere.
    //
    // A regenerating edit keeps the *old* rule on the new head until its
    // occurrences are rebuilt, and writes the new rule last. The rule is what
    // a retry compares against: written first, a failed rebuild would leave a
    // head that already says MONTHLY over WEEKLY rows, and repeating the edit
    // would read as no change (#3235).
    let newHead = await this.eventRepo.update(successor.id, chapterId, {
      ...carried,
      ...retimed,
      recurrence_rule: regenerates
        ? advanceRepeatRule(
            parent.recurrence_rule,
            parent.start_time,
            successor.start_time,
          )
        : seriesRule,
      parent_event_id: null,
    });

    // The survivors are re-pointed at the new head before anything else, or
    // they would still hang off the row that just left the series and no
    // later series operation would find them. A regenerate replaces them
    // next, so it does not bother carrying the edit onto them.
    if (rest.length > 0) {
      await this.eventRepo.updateMany(
        rest.map((child) => child.id),
        chapterId,
        regenerates
          ? { parent_event_id: newHead.id }
          : { ...carried, parent_event_id: newHead.id },
      );
    }

    if (regenerates) {
      // If this fails, the split itself stands: the old head is retired, the
      // past detached, and the new head carries the caller's other changes
      // over the occurrences it already had, under the old rule. That is a
      // consistent series, just not regenerated; the request fails, and
      // repeating a rule change against the new head finishes the rebuild.
      await this.replaceOccurrences({
        headId: newHead.id,
        chapterId,
        existingIds: rest.map((child) => child.id),
        old: rest,
        replacements: this.buildOccurrencePayloads(
          { ...newHead, recurrence_rule: seriesRule },
          now,
        ),
        shiftMs: startShiftMs,
        name: newHead.name,
      });
      if (newHead.recurrence_rule !== seriesRule) {
        newHead = await this.eventRepo.update(newHead.id, chapterId, {
          recurrence_rule: seriesRule,
        });
      }
    }

    await this.announcements.notifyEventUpdated(
      chapterId,
      newHead,
      change,
      actorId,
    );

    return newHead;
  }

  /**
   * Tell each member whose pending or approved excuse went with a deleted
   * occurrence (no rebuilt meeting replaced it) that it's gone (#4620): to
   * send one again when the series was rescheduled, and that there is nothing
   * to do when it ended. Only current members: an excuse outlives its
   * sender's membership (it cascades with the user), and a push naming the
   * chapter's event must not reach someone who left. Best-effort, like every
   * push here: the swap has already landed.
   */
  private async tellDroppedExcuses(
    chapterId: string,
    swap: {
      headId: string;
      name: string;
      ended: boolean;
      dropped: readonly EventExcuse[];
    },
  ): Promise<void> {
    if (swap.dropped.length === 0) return;
    try {
      const current = new Set(
        (await this.memberRepo.findByChapter(chapterId)).map(
          (member) => member.user_id,
        ),
      );
      const members = [
        ...new Set(swap.dropped.map((excuse) => excuse.user_id)),
      ].filter((userId) => current.has(userId));
      if (members.length === 0) return;
      await this.notifications.notifyMembers(
        chapterId,
        members,
        swap.ended
          ? {
              title: 'Your excuse was removed',
              body: `${swap.name} no longer repeats, so the meeting your excuse was for is off the calendar. There's nothing more to do.`,
              priority: 'NORMAL',
              category: 'events',
              data: { target: { screen: 'events', eventId: swap.headId } },
            }
          : {
              title: 'Send your excuse again',
              body: `${swap.name} was rescheduled, and the meeting your excuse was for is no longer on the calendar. Send one again for any meeting you can't make.`,
              priority: 'NORMAL',
              category: 'events',
              data: { target: { screen: 'events', eventId: swap.headId } },
            },
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'event-series-dropped-excuses-notify',
        message: `Could not tell members their excuse for ${swap.headId} was dropped`,
        error,
      });
    }
  }

  /**
   * Run before an `instance`-scope delete removes `target`.
   *
   * Canceling one occurrence that happens to be the series head must not take
   * the series with it. `parent_event_id` is `on delete set null`, so without
   * this the remaining instances survive as unowned rows that no series
   * operation can ever reach again.
   */
  async handOffSeriesHead(target: Event, chapterId: string): Promise<void> {
    if (target.parent_event_id || !target.recurrence_rule) return;
    const children = await this.eventRepo.findChildren(target.id, chapterId);
    if (children.length > 0) {
      await this.promoteSuccessor(target, children, chapterId);
    }
  }

  /**
   * Hand a series to its earliest surviving occurrence, so deleting the head
   * cancels one occurrence rather than decapitating the series.
   *
   * The successor must be a *future* occurrence. `findChildren` returns
   * oldest-first across the whole series, so taking `children[0]` outright
   * promoted an occurrence that had already happened: it rewrote a completed
   * meeting to carry `recurrence_rule` and left the series anchored permanently
   * in the past, so every later regenerating edit built from a stale anchor.
   * Past occurrences are detached instead, exactly as `deleteSeries` treats
   * them. With no future occurrence there is no series left to hand on.
   */
  private async promoteSuccessor(
    parent: Event,
    children: Event[],
    chapterId: string,
  ): Promise<void> {
    const { future, past } = this.partitionByTime(children, Date.now());

    await this.eventRepo.updateMany(
      past.map((child) => child.id),
      chapterId,
      { parent_event_id: null },
    );

    if (future.length === 0) return;

    const [successor, ...rest] = future;

    // A COUNT drops by the meetings of the pattern before the successor
    // (`advanceRepeatRule`), so a later regenerate keeps the series' length
    // rather than growing it; a rule with fewer than two meetings left ends,
    // and the successor stands alone.
    await this.eventRepo.update(successor.id, chapterId, {
      recurrence_rule: advanceRepeatRule(
        parent.recurrence_rule,
        parent.start_time,
        successor.start_time,
      ),
      parent_event_id: null,
    });

    await this.eventRepo.updateMany(
      rest.map((child) => child.id),
      chapterId,
      { parent_event_id: successor.id },
    );
  }

  /**
   * Cancel a recurring series from now forward.
   *
   * Future occurrences are deleted. Occurrences that have already happened are
   * kept — deleting one would cascade its `event_attendance` rows away, erasing
   * the record of a meeting that took place. They are detached instead, leaving
   * each past occurrence a standalone historical event.
   */
  async deleteSeries(target: Event, chapterId: string): Promise<void> {
    const parent = await this.resolveSeriesParent(target, chapterId);
    const children = await this.eventRepo.findChildren(parent.id, chapterId);
    const now = Date.now();
    const { future, past } = this.partitionByTime(children, now);

    await this.eventRepo.deleteMany(
      future.map((child) => child.id),
      chapterId,
    );

    if (new Date(parent.start_time).getTime() <= now) {
      // The head itself already happened, so it is history too: end the series
      // in place rather than deleting the row and its attendance.
      await this.eventRepo.update(parent.id, chapterId, {
        recurrence_rule: null,
      });
      await this.eventRepo.updateMany(
        past.map((child) => child.id),
        chapterId,
        { parent_event_id: null },
      );
      return;
    }

    // The head is still upcoming, so it carries no attendance worth keeping.
    // Deleting it detaches any surviving past occurrence through the FK, which
    // is the same end state as the branch above.
    await this.eventRepo.delete(parent.id, chapterId);
  }
}
