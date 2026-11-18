import {
  MEETING_DRAFT_GAP_MAX_LENGTH,
  MEETING_TEXT_MAX_LENGTH,
  type MeetingDraftFollowUp,
  type MeetingDraftOutput,
  type MeetingFollowUpStatus,
} from '@repo/validation';

/**
 * What a minutes draft knows from before tonight (#5477, `spec/behavior/
 * meetings.md` § Drafting from notes, "What the draft knows from earlier
 * meetings"). Shawn, 2026-11-18: "Is there a world where when it's taking
 * minutes it can fill in details based off of past minutes and other
 * information it gets from frapp".
 *
 * The background is a small packet, never whole documents: the standing
 * reports and recurring topics of the last few posted minutes, last
 * meeting's action items, and tonight's agenda. It goes into the prompt in a
 * fence of its own, apart from the sources, and is never evidence of what
 * was said tonight:
 *
 * - nothing can be quoted from it, because a decision or action item is kept
 *   only with a line of tonight's sources (`verifyMinutesDraft`);
 * - where each carried item stands tonight is the model's reading, kept only
 *   with a quote Frapp finds in a source, else "not mentioned"
 *   (`checkFollowUps`), and the words that say so are Frapp's own
 *   (`followUpLines`);
 * - a drafted line that repeats the background but no source is taken out
 *   (`dropEchoes`).
 *
 * Which minutes it reads is the service's (`MeetingDraftContextService`):
 * only minutes the drafting officer may read, of the same type and audience.
 */

/** One earlier meeting, as the background carries it. */
export interface MinutesBackgroundMeeting {
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  /** The offices that reported, as its minutes led each report. */
  reports: string[];
  /** The topic lines of its discussion log, in order. */
  topics: string[];
}

/** One of last meeting's action items, carried into tonight's draft. */
export interface MinutesCarriedItem {
  /** How the prompt names it: "F1", "F2". */
  id: string;
  text: string;
  ownerUserId: string | null;
  /** The owner's roster name, when the owner is still a member. */
  ownerName: string | null;
  dueDate: string | null;
  /** The day of the meeting it was set at, `YYYY-MM-DD`. */
  fromDate: string;
}

/** A report given at recent meetings, expected again tonight. */
export interface MinutesStandingReport {
  /** How the prompt names it: "R1", "R2". */
  id: string;
  office: string;
  /** The newest meeting it was given at, `YYYY-MM-DD`. */
  lastDate: string;
}

export interface MinutesBackground {
  /** Newest first. */
  meetings: MinutesBackgroundMeeting[];
  carried: MinutesCarriedItem[];
  standingReports: MinutesStandingReport[];
}

/** The most earlier minutes a packet reads. */
export const BACKGROUND_MEETINGS_MAX = 3;
/** The most of last meeting's action items carried. */
export const CARRIED_ITEMS_MAX = 15;
/** The most standing reports named. */
export const STANDING_REPORTS_MAX = 12;
/** The most topic lines kept per earlier meeting. */
export const TOPICS_PER_MEETING_MAX = 12;
/** How long one carried line, report or topic may run in the prompt. */
const ITEM_MAX = 160;

/** Each background is fenced: `<background>` … `</background>`. */
export const BACKGROUND_OPEN = '<background>';
export const BACKGROUND_CLOSE = '</background>';
const BACKGROUND_TAG = /<\/?\s*background\b[^<>\n]*>/gi;
const BACKGROUND_WORD = /<\/?\s*background\b/gi;

/** A line of earlier minutes, safe inside the fence. */
function fenceSafe(text: string): string {
  return oneLine(text.replace(BACKGROUND_TAG, '').replace(BACKGROUND_WORD, ''))
    .replace(/<\/?\s*source\b[^<>\n]*>/gi, '')
    .replace(/<\/?\s*source\b/gi, '')
    .slice(0, ITEM_MAX)
    .trim();
}

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
  }
  return offices;
}

/**
 * The topic lines of a discussion log written as the outline (a topic on a
 * line of its own, its points as "- " bullets under it). A log with no
 * bullets has no topic lines this can tell apart, so it gives none.
 */
export function topicLines(discussionLog: string): string[] {
  const lines = discussionLog.split(/\r?\n/);
  const topics: string[] = [];
  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text || /^[-•*]\s/.test(text) || /^\s/.test(line)) return;
    const next = lines.slice(index + 1).find((l) => l.trim().length > 0);
    if (next && /^\s*[-•*]\s/.test(next)) topics.push(oneLine(text));
  });
  return topics;
}

/**
 * Standing reports: offices that reported at more than one of the earlier
 * minutes, or at the only one there is, newest first.
 */
export function standingReportsOf(
  meetings: readonly MinutesBackgroundMeeting[],
): MinutesStandingReport[] {
  const seen = new Map<
    string,
    { office: string; count: number; lastDate: string }
  >();
  for (const meeting of meetings) {
    for (const office of meeting.reports) {
      const key = office.toLowerCase();
      const known = seen.get(key);
      if (known) known.count += 1;
      else seen.set(key, { office, count: 1, lastDate: meeting.date });
    }
  }
  const needed = meetings.length > 1 ? 2 : 1;
  return [...seen.values()]
    .filter((report) => report.count >= needed)
    .slice(0, STANDING_REPORTS_MAX)
    .map((report, index) => ({
      id: `R${index + 1}`,
      office: report.office,
      lastDate: report.lastDate,
    }));
}

/** Whether the packet holds anything worth a prompt. */
export function hasBackground(
  background: MinutesBackground | undefined,
): boolean {
  return (
    !!background &&
    (background.meetings.length > 0 ||
      background.carried.length > 0 ||
      background.standingReports.length > 0)
  );
}

/** The rules the drafter is given when there is a background. */
export const BACKGROUND_RULES = [
  `- The <background> block is from this chapter's earlier minutes, not from tonight. Use it only to recognise what tonight's sources are talking about and to spell names, offices, committees and places the way the chapter does. Never write anything from it as said, reported, decided or done tonight, never quote it, and never take a decision, action item, vote, name, number or date from it. A sentence in your draft must stand on tonight's sources alone.`,
  `- follow_ups: one entry per F and R id in the background. For an action item (F): "done" when a source says it was done, "carried" when a source says it is still open or moved, else "not_mentioned". For a standing report (R): "given" when a source has that report tonight, else "not_mentioned". quote is the line of the source that says so, copied character for character, and source its id; both null for not_mentioned. Never guess a status: with no line that says so, it is not_mentioned.`,
  '- Do not list last meeting’s action items yourself, in old_business, discussion_log or anywhere else: Frapp adds them with their status. A standing report with nothing in the sources is not written in officer_reports.',
].join('\n');

/** The background, fenced, as the drafter is shown it. Empty when there is none. */
export function backgroundBlock(
  background: MinutesBackground | undefined,
): string[] {
  if (!background || !hasBackground(background)) return [];
  const lines: string[] = [BACKGROUND_OPEN];
  if (background.meetings.length > 0) {
    lines.push('Earlier minutes of this kind of meeting, newest first:');
    for (const meeting of background.meetings) {
      const topics = meeting.topics.map(fenceSafe).filter(Boolean);
      const reports = meeting.reports.map(fenceSafe).filter(Boolean);
      lines.push(
        `- ${meeting.date}, ${fenceSafe(meeting.name)}.${
          reports.length > 0 ? ` Reports: ${reports.join('; ')}.` : ''
        }${topics.length > 0 ? ` Topics: ${topics.join('; ')}.` : ''}`,
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
    lines.push(
      `Action items from the last meeting (${background.carried[0].fromDate}):`,
    );
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
  if (!background || !hasBackground(background)) return [];
  const terms = [
    ...background.standingReports.map((report) => report.office),
    ...background.meetings.flatMap((meeting) => meeting.topics),
  ]
    .map(fenceSafe)
    .filter(Boolean);
  const unique = [...new Set(terms)].slice(0, 40);
  if (unique.length === 0) return [];
  return [
    'Offices and topics from this chapter’s earlier minutes, for spelling only. They are not from tonight: never write them up unless a source says them:',
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

/**
 * Where each carried item stands tonight. The model's status is kept only
 * when its quote is a line of a source; any other status, a status that
 * doesn't fit the kind, and an item the model left out are `not_mentioned`.
 */
export function checkFollowUps(
  background: MinutesBackground | undefined,
  drafted: readonly DraftedFollowUp[] | undefined,
  locate: QuoteLocator,
): MeetingDraftFollowUp[] {
  if (!background) return [];
  const byId = new Map<string, DraftedFollowUp>();
  for (const entry of drafted ?? []) {
    const id = entry.id.toUpperCase().replace(/[^A-Z0-9]/g, '');
    // The first grounded answer for an id wins over a later one.
    if (!byId.has(id) || byId.get(id)?.status === 'not_mentioned') {
      byId.set(id, entry);
    }
  }
  const read = (
    id: string,
    allowed: readonly MeetingFollowUpStatus[],
  ): Pick<MeetingDraftFollowUp, 'status' | 'quote' | 'from'> => {
    const entry = byId.get(id);
    if (!entry || !allowed.includes(entry.status) || !entry.quote?.trim()) {
      return { status: 'not_mentioned', quote: null, from: null };
    }
    const found = locate(entry.quote, entry.source ?? undefined);
    if (!found) return { status: 'not_mentioned', quote: null, from: null };
    return { status: entry.status, quote: entry.quote, from: found.label };
  };
  return [
    ...background.carried.map((item): MeetingDraftFollowUp => ({
      kind: 'action_item',
      text: item.text,
      owner_user_id: item.ownerUserId,
      from_meeting_date: item.fromDate,
      ...read(item.id, ['done', 'carried']),
    })),
    ...background.standingReports.map((report): MeetingDraftFollowUp => ({
      kind: 'report',
      text: report.office,
      owner_user_id: null,
      from_meeting_date: report.lastDate,
      ...read(report.id, ['given']),
    })),
  ];
}

/**
 * The parts' follow-ups as one list (a long meeting is drafted in parts):
 * for each id, the first answer that isn't `not_mentioned`, so a part that
 * heard the report wins over one that didn't.
 */
export function mergeFollowUps(
  parts: readonly MeetingDraftOutput[],
): DraftedFollowUp[] {
  const byId = new Map<string, DraftedFollowUp>();
  for (const part of parts) {
    for (const entry of part.follow_ups ?? []) {
      const known = byId.get(entry.id);
      if (
        !known ||
        (known.status === 'not_mentioned' && entry.status !== 'not_mentioned')
      ) {
        byId.set(entry.id, entry);
      }
    }
  }
  return [...byId.values()];
}

const STATUS_WORDS: Readonly<
  Record<'done' | 'carried' | 'not_mentioned', string>
> = {
  done: 'reported done tonight',
  carried: 'still open, carried over',
  not_mentioned: 'not mentioned tonight, confirm before posting',
};

/**
 * Last meeting's action items for the minutes, in Frapp's own words: each
 * marked as from those minutes, with where it stands. Nothing tonight said
 * is invented here; an item no source mentions says so and asks.
 */
export function followUpLines(
  followUps: readonly MeetingDraftFollowUp[],
  ownerName: (userId: string) => string | null,
): string {
  const items = followUps.filter((f) => f.kind === 'action_item');
  if (items.length === 0) return '';
  const date = items[0].from_meeting_date;
  // A topic line and its bullets, the outline the discussion log is
  // written in, so it reads the same under old business or there.
  return [
    `Open action items from the ${date} minutes`,
    ...items.map((item) => {
      const owner = item.owner_user_id ? ownerName(item.owner_user_id) : null;
      const status =
        STATUS_WORDS[item.status as keyof typeof STATUS_WORDS] ??
        STATUS_WORDS.not_mentioned;
      return `- ${oneLine(item.text)}${owner ? ` (${owner})` : ''}: ${status}.`;
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
 */
export function withFollowUpLines(section: string, lines: string): string {
  if (!lines) return section;
  const written = section.trim();
  const joined = written ? `${written}\n\n${lines}` : lines;
  if (joined.length <= MEETING_TEXT_MAX_LENGTH) return joined;
  // The carried lines are what the officer has to check, so they stay.
  const room = MEETING_TEXT_MAX_LENGTH - lines.length - 2;
  return room > 0
    ? `${written.slice(0, room).trim()}\n\n${lines}`
    : lines.slice(0, MEETING_TEXT_MAX_LENGTH);
}

/** Words in a run that count as repeating a line rather than sharing a phrase. */
const ECHO_WORDS = 6;

function words(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w.length > 0);
}

function shingles(text: string): Set<string> {
  const list = words(text);
  const out = new Set<string>();
  for (let i = 0; i + ECHO_WORDS <= list.length; i += 1) {
    out.add(list.slice(i, i + ECHO_WORDS).join(' '));
  }
  return out;
}

/**
 * A drafted text section with every line that repeats the background but no
 * source taken out: a run of six words that is in the background and in no
 * source. A line that names a topic or an office in passing shares fewer
 * words and stays, and so does one tonight's sources also say. Returns the
 * section and how many lines went.
 */
export function dropEchoes(
  section: string,
  backgroundText: string,
  sourcesText: string,
): { text: string; dropped: number } {
  if (!section.trim() || !backgroundText.trim()) {
    return { text: section, dropped: 0 };
  }
  const background = shingles(backgroundText);
  if (background.size === 0) return { text: section, dropped: 0 };
  const said = shingles(sourcesText);
  let dropped = 0;
  const kept = section.split('\n').filter((line) => {
    for (const run of shingles(line)) {
      if (background.has(run) && !said.has(run)) {
        dropped += 1;
        return false;
      }
    }
    return true;
  });
  return {
    text: kept
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    dropped,
  };
}

/**
 * What the background claims, as one text for `dropEchoes`: the carried
 * action items. Topic and office names are not claims but spellings, and a
 * topic of tonight's titled the way earlier minutes titled it is what the
 * background is for, so they are not compared.
 */
export function backgroundText(
  background: MinutesBackground | undefined,
): string {
  if (!background) return '';
  return background.carried.map((item) => item.text).join('\n');
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
