import {
  MEETING_DRAFT_GAP_MAX_LENGTH,
  MEETING_TEXT_MAX_LENGTH,
  type MeetingDraftFollowUp,
  type MeetingDraftOutput,
  type MeetingFollowUpStatus,
} from '@repo/validation';
import { oneLine, unfenced } from './minutes-text';

/**
 * What a minutes draft knows from before tonight (#5477, `spec/behavior/
 * meetings.md` § Drafting from notes, "What the draft knows from earlier
 * meetings"). Shawn, 2026-11-18: "Is there a world where when it's taking
 * minutes it can fill in details based off of past minutes and other
 * information it gets from frapp".
 *
 * The background is a small packet, never whole documents: the offices that
 * reported and the topic names of the last few posted minutes, last
 * meeting's open action items, and tonight's agenda. It goes into the prompt
 * in a fence of its own, apart from the sources, and is never evidence of
 * what was said tonight:
 *
 * - nothing can be quoted from it, because a decision or action item is kept
 *   only with a line of tonight's sources (`verifyMinutesDraft`);
 * - where each carried item stands tonight is the model's reading, kept only
 *   with a quote Frapp finds in a source, else "not mentioned"
 *   (`checkFollowUps`), and the words that say so are Frapp's own
 *   (`followUpLines`);
 * - a drafted sentence that repeats a carried item, or names an earlier
 *   topic tonight's sources don't, is taken out (`echoChecker`).
 *
 * The packet carries no dates: the server only knows a meeting's start in
 * UTC, which is a day off for an evening meeting west of Greenwich, so a
 * date written from it would be wrong in the minutes. The review keeps the
 * start time itself for a screen to show in the reader's own time.
 *
 * Which minutes it reads is the service's (`MeetingDraftContextService`):
 * only minutes the drafting officer may read, of the same type and audience.
 */

/** One earlier meeting, as the background carries it. */
export interface MinutesBackgroundMeeting {
  /** The event's start, an ISO timestamp. Never written into a prompt. */
  startTime: string;
  name: string;
  /** Whether it is an earlier meeting of tonight's series. */
  sameSeries: boolean;
  /** The offices that reported, as its minutes led each report. */
  reports: string[];
  /** The topic lines of its discussion log, in order. */
  topics: string[];
}

/** One of last meeting's open action items, carried into tonight's draft. */
export interface MinutesCarriedItem {
  /** How the prompt names it: "F1", "F2". */
  id: string;
  text: string;
  ownerUserId: string | null;
  /** The owner's roster name, when the owner is still a member. */
  ownerName: string | null;
  dueDate: string | null;
  /** The start of the meeting whose minutes it is carried from. */
  fromStartTime: string;
}

/** A report given at recent meetings, expected again tonight. */
export interface MinutesStandingReport {
  /** How the prompt names it: "R1", "R2". */
  id: string;
  office: string;
  /** The start of the latest of those meetings it was given at. */
  lastStartTime: string;
}

export interface MinutesBackground {
  /**
   * Earlier meetings of tonight's series first, then other meetings of the
   * same kind, each group newest first. The first is "last meeting".
   */
  meetings: MinutesBackgroundMeeting[];
  carried: MinutesCarriedItem[];
  standingReports: MinutesStandingReport[];
}

/** The most earlier minutes a packet reads. */
export const BACKGROUND_MEETINGS_MAX = 3;
/** The most of last meeting's action items carried. */
export const CARRIED_ITEMS_MAX = 15;
/** The most standing reports named, and reports kept per earlier meeting. */
export const STANDING_REPORTS_MAX = 12;
/** The most topic lines kept per earlier meeting. */
export const TOPICS_PER_MEETING_MAX = 12;
/** How long one carried item, report or topic may run, in the prompt and the minutes. */
export const BACKGROUND_ITEM_MAX = 200;

/** Each background is fenced: `<background>` … `</background>`. */
export const BACKGROUND_OPEN = '<background>';
export const BACKGROUND_CLOSE = '</background>';
const BACKGROUND_TAG = /<\/?\s*background\b[^<>\n]*>/gi;
const BACKGROUND_WORD = /<\/?\s*background\b/gi;

/** A line of earlier minutes, safe inside the fence and short. */
function fenceSafe(text: string): string {
  return oneLine(
    unfenced(text.replace(BACKGROUND_TAG, '').replace(BACKGROUND_WORD, '')),
  )
    .slice(0, BACKGROUND_ITEM_MAX)
    .trim();
}

/** How Frapp heads the carried items it writes into the minutes. */
export const CARRIED_HEADING = 'Open action items carried from earlier minutes';

const STATUS_WORDS = {
  done: 'reported done tonight',
  carried: 'still open, carried over',
  not_mentioned: 'not mentioned tonight, confirm before posting',
} as const;

/**
 * The offices that reported in a minutes' officer reports: each line is "led
 * by their office" (`SECTION_GUIDE.officer_reports`), so the office is what
 * comes before the first colon or dash, when that is short enough to be a
 * name. A line with no such lead names no office.
 */
export function reportingOffices(officerReports: string): string[] {
  const offices: string[] = [];
  for (const raw of officerReports.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-•*]\s*/, '').trim();
    const lead = /^([^:–—]{2,40}?)\s*(?::|\s[-–—]\s)/.exec(line);
    if (!lead) continue;
    const office = oneLine(lead[1]);
    // A lead is a name, a few words, not a sentence.
    if (office.split(' ').length > 5 || /[.!?]$/.test(office)) continue;
    if (!offices.some((o) => o.toLowerCase() === office.toLowerCase())) {
      offices.push(office);
    }
    if (offices.length >= STANDING_REPORTS_MAX) break;
  }
  return offices;
}

/**
 * The topic lines of a discussion log written as the outline (a topic on a
 * line of its own, its points as "- " bullets under it). A log with no
 * bullets has no topic lines this can tell apart, so it gives none. Frapp's
 * own carried-items heading is not a topic.
 */
export function topicLines(discussionLog: string): string[] {
  const lines = discussionLog.split(/\r?\n/);
  const topics: string[] = [];
  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text || /^[-•*]\s/.test(text) || /^\s/.test(line)) return;
    if (text === CARRIED_HEADING) return;
    const next = lines.slice(index + 1).find((l) => l.trim().length > 0);
    if (next && /^\s*[-•*]\s/.test(next)) topics.push(oneLine(text));
  });
  return topics;
}

/** An item still open in a carried-items block Frapp wrote into earlier minutes. */
export interface StillOpenItem {
  text: string;
  ownerName: string | null;
}

const CARRIED_LINE = new RegExp(
  `^-\\s+(.+?)(?:\\s+\\(([^()]+)\\))?:\\s+(${STATUS_WORDS.carried}|${STATUS_WORDS.not_mentioned})\\.?$`,
);

/**
 * The items a carried-items block (`followUpLines`) left open: "still open,
 * carried over" or "not mentioned tonight". An item carried over is not one
 * of that meeting's own action items, so without this it would drop off the
 * meeting after. Only lines still in Frapp's own words are read; a line the
 * secretary rewrote, or marked done, is theirs and is not carried again.
 */
export function stillOpenItems(section: string): StillOpenItem[] {
  const lines = section.split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim() === CARRIED_HEADING);
  if (at < 0) return [];
  const open: StillOpenItem[] = [];
  for (const raw of lines.slice(at + 1)) {
    const line = raw.trim();
    if (!line) break;
    const match = CARRIED_LINE.exec(line);
    if (!match) continue;
    open.push({ text: match[1].trim(), ownerName: match[2]?.trim() ?? null });
  }
  return open;
}

/**
 * Standing reports: offices that reported at more than one of the earlier
 * minutes, or at the only one there is. Each carries the latest start it was
 * given at, whatever order the meetings come in.
 */
export function standingReportsOf(
  meetings: readonly MinutesBackgroundMeeting[],
): MinutesStandingReport[] {
  const seen = new Map<
    string,
    { office: string; count: number; lastStartTime: string }
  >();
  for (const meeting of meetings) {
    for (const office of meeting.reports) {
      const key = office.toLowerCase();
      const known = seen.get(key);
      if (!known) {
        seen.set(key, { office, count: 1, lastStartTime: meeting.startTime });
        continue;
      }
      known.count += 1;
      if (Date.parse(meeting.startTime) > Date.parse(known.lastStartTime)) {
        known.lastStartTime = meeting.startTime;
      }
    }
  }
  const needed = meetings.length > 1 ? 2 : 1;
  return [...seen.values()]
    .filter((report) => report.count >= needed)
    .slice(0, STANDING_REPORTS_MAX)
    .map((report, index) => ({
      id: `R${index + 1}`,
      office: report.office,
      lastStartTime: report.lastStartTime,
    }));
}

/** Whether the packet holds anything worth a prompt. */
export function hasBackground(
  background: MinutesBackground | undefined,
): background is MinutesBackground {
  return (
    !!background &&
    (background.meetings.length > 0 ||
      background.carried.length > 0 ||
      background.standingReports.length > 0)
  );
}

/** The rules the drafter is given when there is a background. */
export const BACKGROUND_RULES = [
  `- The <background> block is from this chapter's earlier minutes, not from tonight. Use it only to recognise what tonight's sources are talking about and to spell names, offices, committees and places the way the chapter does. Never write anything from it as said, reported, decided or done tonight, never quote it, and never take a decision, action item, vote, name, number or date from it. A sentence in your draft must stand on tonight's sources alone, and a topic from it that tonight's sources don't discuss is not written at all.`,
  `- follow_ups: one entry per F and R id in the background. For an action item (F): "done" when a source says it was done, "carried" when a source says it is still open or moved, else "not_mentioned". For a standing report (R): "given" when a source has that report tonight, else "not_mentioned". quote is the line of the source that says so, copied character for character, and source its id; both null for not_mentioned. Never guess a status: with no line that says so, it is not_mentioned.`,
  '- Do not list last meeting’s action items yourself, in old_business, discussion_log or anywhere else: Frapp adds them with their status. A standing report with nothing in the sources is not written in officer_reports.',
].join('\n');

/** The background, fenced, as the drafter is shown it. Empty when there is none. */
export function backgroundBlock(
  background: MinutesBackground | undefined,
): string[] {
  if (!hasBackground(background)) return [];
  const lines: string[] = [BACKGROUND_OPEN];
  if (background.meetings.length > 0) {
    lines.push(
      'Earlier minutes of this kind of meeting (the first is last meeting):',
    );
    for (const meeting of background.meetings) {
      const topics = meeting.topics.map(fenceSafe).filter(Boolean);
      const reports = meeting.reports.map(fenceSafe).filter(Boolean);
      lines.push(
        `- ${fenceSafe(meeting.name)}${
          meeting.sameSeries ? ' (same series)' : ''
        }.${reports.length > 0 ? ` Reports: ${reports.join('; ')}.` : ''}${
          topics.length > 0 ? ` Topics: ${topics.join('; ')}.` : ''
        }`,
      );
    }
  }
  if (background.standingReports.length > 0) {
    lines.push('Standing reports (given at recent meetings):');
    for (const report of background.standingReports) {
      lines.push(`${report.id}. ${fenceSafe(report.office)}`);
    }
  }
  if (background.carried.length > 0) {
    lines.push('Open action items from last meeting:');
    for (const item of background.carried) {
      const owner = item.ownerName
        ? ` [owner: ${fenceSafe(item.ownerName)}]`
        : '';
      const due = item.dueDate ? ` [due ${item.dueDate}]` : '';
      lines.push(`${item.id}. ${fenceSafe(item.text)}${owner}${due}`);
    }
  }
  lines.push(BACKGROUND_CLOSE);
  return lines;
}

/**
 * The background as the notes pass is shown it: names and terms to spell,
 * nothing to write up.
 */
export function spellingLines(
  background: MinutesBackground | undefined,
): string[] {
  if (!hasBackground(background)) return [];
  const terms = [
    ...background.standingReports.map((report) => report.office),
    ...background.meetings.flatMap((meeting) => meeting.topics),
  ]
    .map(fenceSafe)
    .filter(Boolean);
  const unique = [...new Set(terms)].slice(0, 40);
  if (unique.length === 0) return [];
  return [
    'Offices and topics from this chapter’s earlier minutes, for spelling only. They are not from tonight: never write one up unless a source discusses it:',
    unique.join('; '),
    '',
  ];
}

type DraftedFollowUp = NonNullable<MeetingDraftOutput['follow_ups']>[number];

/** Finds the source a quote is a line of, as the draft's own check does. */
export type QuoteLocator = (
  quote: string,
  sourceId: string | undefined,
) => { label: string } | null;

function idOf(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Where each carried item stands tonight. Of every answer the model gave for
 * an item (one per part of a long meeting, or a repeat), the last whose
 * status fits the item and whose quote is a line of a source is kept, so a
 * later part that settled it wins and a misquoted answer never hides a
 * grounded one. With none, it is `not_mentioned`.
 */
export function checkFollowUps(
  background: MinutesBackground | undefined,
  drafted: readonly DraftedFollowUp[] | undefined,
  locate: QuoteLocator,
): MeetingDraftFollowUp[] {
  if (!background) return [];
  const read = (
    id: string,
    allowed: readonly MeetingFollowUpStatus[],
  ): Pick<MeetingDraftFollowUp, 'status' | 'quote' | 'from'> => {
    const answers = (drafted ?? []).filter((entry) => idOf(entry.id) === id);
    for (let i = answers.length - 1; i >= 0; i -= 1) {
      const entry = answers[i];
      if (!allowed.includes(entry.status) || !entry.quote?.trim()) continue;
      const found = locate(entry.quote, entry.source ?? undefined);
      if (found) {
        return { status: entry.status, quote: entry.quote, from: found.label };
      }
    }
    return { status: 'not_mentioned', quote: null, from: null };
  };
  return [
    ...background.carried.map((item): MeetingDraftFollowUp => ({
      kind: 'action_item',
      text: item.text,
      owner_user_id: item.ownerUserId,
      from_meeting_start_time: item.fromStartTime,
      ...read(item.id, ['done', 'carried']),
    })),
    ...background.standingReports.map((report): MeetingDraftFollowUp => ({
      kind: 'report',
      text: report.office,
      owner_user_id: null,
      from_meeting_start_time: report.lastStartTime,
      ...read(report.id, ['given']),
    })),
  ];
}

/**
 * Every part's answers, in meeting order, for `checkFollowUps` to pick from:
 * a long meeting is drafted in parts and each part answers for itself.
 */
export function mergeFollowUps(
  parts: readonly MeetingDraftOutput[],
): DraftedFollowUp[] {
  return parts.flatMap((part) => part.follow_ups ?? []);
}

/**
 * Last meeting's open action items for the minutes, in Frapp's own words:
 * under one heading saying they are carried from earlier minutes, each with
 * where it stands. Nothing tonight said is invented here; an item no source
 * mentions says so and asks. `stillOpenItems` reads this back next meeting.
 */
export function followUpLines(
  followUps: readonly MeetingDraftFollowUp[],
  ownerName: (userId: string) => string | null,
): string {
  const items = followUps.filter((f) => f.kind === 'action_item');
  if (items.length === 0) return '';
  // A topic line and its bullets, the outline the discussion log is
  // written in, so it reads the same under old business or there.
  return [
    CARRIED_HEADING,
    ...items.map((item) => {
      const owner = item.owner_user_id ? ownerName(item.owner_user_id) : null;
      const status =
        item.status === 'done' || item.status === 'carried'
          ? STATUS_WORDS[item.status]
          : STATUS_WORDS.not_mentioned;
      const text = oneLine(item.text)
        .replace(/[()]/g, '')
        .slice(0, BACKGROUND_ITEM_MAX)
        .replace(/[.:\s]+$/, '');
      return `- ${text}${owner ? ` (${oneLine(owner)})` : ''}: ${status}.`;
    }),
  ].join('\n');
}

/**
 * The "To fill in" lines for carried items nothing tonight mentions: one
 * for action items and one for reports, so a long list never crowds out the
 * meeting's own questions.
 */
export function followUpGaps(
  followUps: readonly MeetingDraftFollowUp[],
): string[] {
  const quiet = followUps.filter((f) => f.status === 'not_mentioned');
  const items = quiet.filter((f) => f.kind === 'action_item');
  const reports = quiet.filter((f) => f.kind === 'report');
  const gaps: string[] = [];
  if (items.length === 1) {
    gaps.push(
      `Last meeting's action item "${oneLine(items[0].text)}" isn't mentioned in tonight's notes. Is it done, or carried over?`,
    );
  } else if (items.length > 1) {
    gaps.push(
      `${items.length} of last meeting's action items aren't mentioned in tonight's notes. Each is listed in the minutes; mark whether it is done or carried over.`,
    );
  }
  if (reports.length > 0) {
    const names = reports.map((r) => oneLine(r.text));
    gaps.push(
      names.length === 1
        ? `The ${names[0]} usually reports, and there's no report in tonight's notes. Was one given?`
        : `These usually report, and there's no report from them in tonight's notes: ${names.join(', ')}. Were they given?`,
    );
  }
  return gaps.map((gap) => gap.slice(0, MEETING_DRAFT_GAP_MAX_LENGTH).trim());
}

/**
 * A section with Frapp's carried-item lines after what the draft wrote:
 * old business when the chapter's template has it, else the discussion log.
 * When both don't fit, the drafted section gives up whole lines from its
 * end, never part of one, and `cut` says so for "To fill in".
 */
export function withFollowUpLines(
  section: string,
  lines: string,
): { text: string; cut: boolean } {
  if (!lines) return { text: section, cut: false };
  const written = section.trim();
  const joined = written ? `${written}\n\n${lines}` : lines;
  if (joined.length <= MEETING_TEXT_MAX_LENGTH) {
    return { text: joined, cut: false };
  }
  const room = MEETING_TEXT_MAX_LENGTH - lines.length - 2;
  const kept: string[] = [];
  let used = 0;
  for (const line of written.split('\n')) {
    if (used + line.length + 1 > room) break;
    kept.push(line);
    used += line.length + 1;
  }
  const head = kept.join('\n').trim();
  return {
    text: (head ? `${head}\n\n${lines}` : lines).slice(
      0,
      MEETING_TEXT_MAX_LENGTH,
    ),
    cut: true,
  };
}

/** Words in a run that count as repeating a carried item rather than sharing a phrase. */
const ECHO_WORDS = 6;

/** Words too common to tell whether a topic was discussed. */
const COMMON = new Set([
  'about',
  'after',
  'again',
  'also',
  'from',
  'have',
  'into',
  'last',
  'meeting',
  'next',
  'over',
  'that',
  'their',
  'them',
  'they',
  'this',
  'update',
  'week',
  'with',
]);

function words(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w.length > 0);
}

function shingles(list: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + ECHO_WORDS <= list.length; i += 1) {
    out.add(list.slice(i, i + ECHO_WORDS).join(' '));
  }
  return out;
}

/** A topic's telling words: four letters or more, and not common. */
function tellingWords(topic: string): string[] {
  return [
    ...new Set(words(topic).filter((w) => w.length >= 4 && !COMMON.has(w))),
  ];
}

/** The sentences of one line, each with the space after it. */
function sentencesOf(line: string): string[] {
  const found = line.match(/[^.!?]+(?:[.!?]+["')\]]*\s*|$)/g);
  return found && found.join('') === line ? found : [line];
}

/**
 * The check that keeps earlier minutes out of tonight's text, built once
 * per draft from the background and tonight's sources. A drafted sentence
 * goes when it
 *
 * - repeats a carried action item (six words in a row of it) that no
 *   source says, or
 * - names an earlier topic (two telling words or more) when tonight's
 *   sources hold fewer than half of that topic's telling words, so a topic
 *   tonight never discussed isn't written up as if it were.
 *
 * Only the sentence goes, never the rest of its line; a line left empty
 * goes with it. A topic tonight's sources do discuss can still be spelled
 * the way earlier minutes spelled it.
 */
export function echoChecker(
  background: MinutesBackground | undefined,
  sourcesText: string,
): (section: string) => { text: string; dropped: number } {
  const unchanged = (section: string) => ({ text: section, dropped: 0 });
  if (!hasBackground(background)) return unchanged;
  const claims = new Set<string>();
  for (const item of background.carried) {
    for (const run of shingles(words(item.text))) claims.add(run);
  }
  const sourceWords = words(sourcesText);
  const said = shingles(sourceWords);
  const heard = new Set(sourceWords);
  const topics = [
    ...new Set(background.meetings.flatMap((meeting) => meeting.topics)),
  ]
    .map((topic) => ({
      phrase: words(topic).join(' '),
      telling: tellingWords(topic),
    }))
    .filter(
      (topic) =>
        topic.telling.length >= 2 &&
        topic.telling.filter((w) => heard.has(w)).length * 2 <
          topic.telling.length,
    );
  if (claims.size === 0 && topics.length === 0) return unchanged;

  const echoes = (sentence: string): boolean => {
    const list = words(sentence);
    for (const run of shingles(list)) {
      if (claims.has(run) && !said.has(run)) return true;
    }
    const joined = ` ${list.join(' ')} `;
    return topics.some((topic) => joined.includes(` ${topic.phrase} `));
  };

  return (section: string) => {
    if (!section.trim()) return unchanged(section);
    let dropped = 0;
    const kept: string[] = [];
    for (const line of section.split('\n')) {
      const sentences = sentencesOf(line);
      const left = sentences.filter((sentence) => {
        if (!echoes(sentence)) return true;
        dropped += 1;
        return false;
      });
      if (left.length === sentences.length) {
        kept.push(line);
        continue;
      }
      const marker = /^\s*[-•*]\s+/.exec(line)?.[0] ?? '';
      const body = left
        .join('')
        .replace(/^\s*[-•*]\s+/, '')
        .trim();
      // A bullet whose words all went goes whole, marker and all; one that
      // kept some keeps its marker and indent.
      if (body) kept.push(`${marker}${body}`);
    }
    return {
      text: kept
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      dropped,
    };
  };
}
