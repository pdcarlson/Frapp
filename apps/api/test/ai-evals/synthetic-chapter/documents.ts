/**
 * The synthetic chapter's official sources: bylaws, house rules, a risk
 * policy, posted minutes and announcements, plus the calendar and task list
 * a tool would read. All invented (see `roster.ts`).
 *
 * Facts are planted where a question can find them, and some are planted
 * twice on purpose: the bylaws set dues and a later announcement changes the
 * late fee, so an answer has to prefer the newer official source.
 */
import type { CorpusDocument } from '../harness/types';
import { SYNTHETIC_CHAPTER } from './roster';

const doc = (
  id: string,
  sourceType: CorpusDocument['sourceType'],
  title: string,
  body: string,
  effectiveAt: string,
): CorpusDocument => ({
  id,
  chapterId: SYNTHETIC_CHAPTER,
  sourceType,
  title,
  body,
  effectiveAt,
  createdAt: effectiveAt,
});

export const BYLAWS = doc(
  'syn-doc-bylaws',
  'chapter_document',
  'Chapter bylaws (amended September 2026)',
  [
    'Bylaws of the Northfield College chapter of the Order of the Lantern. This chapter and this document are fictional.',
    '',
    'Article I. Name and purpose.',
    'Section 1. The chapter is the Northfield College chapter of the Order of the Lantern.',
    'Section 2. The chapter exists to support its members in scholarship, service and friendship, and to keep the chapter house a safe place to live.',
    '',
    'Article II. Membership.',
    'Section 1. A member is in good standing when their dues are paid, they have no open standards sanction, and their term grade point average is at least 2.5.',
    'Section 2. A member not in good standing may attend chapter meetings but may not vote or hold office.',
    'Section 3. A member who graduates becomes an alumnus. Alumni may post in #alumni and may attend events open to alumni.',
    '',
    'Article III. Officers.',
    'Section 1. The officers are the President, Vice President, Treasurer, Secretary and Risk Manager. Together they are the executive board.',
    'Section 2. Officers are elected at the last chapter meeting of the fall term and serve from January 1 to December 31.',
    'Section 3. The Treasurer keeps the chapter accounts, collects dues and reports the balance at every chapter meeting.',
    'Section 4. The Secretary keeps the minutes and posts them within seven days of each meeting.',
    'Section 5. The executive board may appoint chairs, including a Social Chair, a House Manager and a Philanthropy Chair. Chairs are not officers and do not sit on the executive board.',
    '',
    'Article IV. Meetings.',
    'Section 1. Chapter meeting is held every Sunday at 7pm in the chapter room during the academic term.',
    'Section 2. Quorum for a chapter vote is two-thirds of members in good standing.',
    'Section 3. A motion passes by a simple majority of those voting, except an amendment to these bylaws, which needs three-quarters.',
    '',
    'Article V. Dues and fees.',
    'Section 1. Dues are $350 per member per semester.',
    'Section 2. Dues are due 30 days after the first chapter meeting of the semester.',
    'Section 3. A member who has not paid by the due date owes a late fee of $25.',
    'Section 4. A member may ask the Treasurer for a payment plan of up to three installments. A member on a payment plan who keeps to it is in good standing.',
    '',
    'Article VI. Standards board.',
    'Section 1. The standards board hears matters of member conduct. It is the Vice President, who chairs it, and two members elected each fall.',
    'Section 2. Standards hearings are closed. Their records are kept by the Vice President and are not posted in chapter channels.',
    '',
    'Article VII. Amendments.',
    'Section 1. These bylaws may be amended by a three-quarters vote at a chapter meeting, after the amendment has been read at the previous chapter meeting.',
  ].join('\n'),
  '2026-09-13T00:00:00Z',
);

export const HOUSE_RULES = doc(
  'syn-doc-house-rules',
  'chapter_document',
  'House rules (2026)',
  [
    'House rules for the chapter house at 14 Alder Lane. Fictional.',
    '',
    'Quiet hours begin at 11pm Sunday through Thursday and at 1am on Friday and Saturday.',
    'Guests must leave by 2am unless a resident signs them in for the night with the House Manager.',
    'Chores rotate weekly. The rotation is posted in #house every Sunday night by the House Manager.',
    'A missed chore is made up the following week, and a second missed chore in a month is reported to the Vice President.',
    'The kitchen closes for cleaning at 10pm every night.',
    'Bikes are stored in the basement, never in the hallways.',
    'Report broken appliances in #house so the House Manager can schedule a repair.',
  ].join('\n'),
  '2026-08-15T00:00:00Z',
);

export const RISK_POLICY = doc(
  'syn-doc-risk-policy',
  'chapter_document',
  'Risk management policy (2026 revision)',
  [
    'Risk management policy. Fictional.',
    '',
    'Section 1. Every event with alcohol has two sober monitors named at least 48 hours before it starts.',
    'Section 2. The guest list for any social event closes 24 hours before the event.',
    'Section 3. No event may have more than 120 people in the chapter house at once.',
    'Section 4. The Risk Manager approves every social event in writing before it is announced.',
    'Section 5. Any incident at an event is reported to the Risk Manager within 12 hours.',
  ].join('\n'),
  '2026-08-01T00:00:00Z',
);

export const MINUTES_SEPT_7 = doc(
  'syn-minutes-2026-09-07',
  'meeting_minutes',
  'Chapter meeting minutes, September 7, 2026',
  [
    'Chapter meeting, Sunday, September 7, 2026, 7pm, chapter room. 31 members present; quorum met.',
    'Treasurer report: the chapter account holds $18,420. Dues for the fall are due October 7, 30 days after this meeting.',
    'Decision: the chapter will hold its fall philanthropy run on October 25, raising money for the Northfield food pantry. Passed 27 to 2.',
    'Decision: the bylaws amendment to add the Risk Manager to the executive board was read for the first time.',
    'Action: Nate Lindqvist will book the park pavilion for the run by September 20.',
    'Action: Caleb Osei will post the fall chore rotation in #house by September 10.',
  ].join('\n'),
  '2026-09-07T23:00:00Z',
);

export const MINUTES_SEPT_14 = doc(
  'syn-minutes-2026-09-14',
  'meeting_minutes',
  'Chapter meeting minutes, September 14, 2026',
  [
    'Chapter meeting, Sunday, September 14, 2026, 7pm, chapter room. 33 members present; quorum met.',
    'Decision: the bylaws amendment adding the Risk Manager to the executive board passed 30 to 1, above the three-quarters needed.',
    'Decision: homecoming tailgate will be on October 18, behind the chapter house, alumni invited.',
    'Treasurer report: 9 members have paid fall dues so far.',
    'Action: Dante Reyes will send the tailgate invitation to alumni by October 1.',
  ].join('\n'),
  '2026-09-14T23:00:00Z',
);

export const MINUTES_OCT_5 = doc(
  'syn-minutes-2026-10-05',
  'meeting_minutes',
  'Chapter meeting minutes, October 5, 2026',
  [
    'Chapter meeting, Sunday, October 5, 2026, 7pm, chapter room. 29 members present; quorum met.',
    'Treasurer report: 24 members have paid fall dues. Dues are due Tuesday, October 7.',
    'Decision: the chapter will buy a second washing machine for the basement, up to $900. Passed 25 to 4.',
    'Decision: the philanthropy run moves from the park to the college track because the pavilion was already booked.',
    'Action: Caleb Osei will get two quotes for the washing machine by October 15.',
    'Action: Wes Tanaka will name the sober monitors for the tailgate by October 16.',
  ].join('\n'),
  '2026-10-05T23:00:00Z',
);

export const ANNOUNCEMENTS: readonly CorpusDocument[] = [
  doc(
    'syn-ann-dues-reminder',
    'announcement',
    'Fall dues reminder',
    'Fall dues of $350 are due Tuesday, October 7. Pay the Treasurer by check or ask Priya Natarajan about a payment plan.',
    '2026-09-28T15:00:00Z',
  ),
  doc(
    'syn-ann-late-fee',
    'announcement',
    'Late fee change',
    'The executive board has raised the late fee for unpaid dues to $40, starting with fall dues. This replaces the $25 in the bylaws until the chapter votes on an amendment.',
    '2026-10-01T15:00:00Z',
  ),
  doc(
    'syn-ann-tailgate',
    'announcement',
    'Homecoming tailgate',
    'Homecoming tailgate is Saturday, October 18, from 11am behind the house. Alumni are welcome. Sober monitors will be named by October 16.',
    '2026-10-03T15:00:00Z',
  ),
  doc(
    'syn-ann-philanthropy-run',
    'announcement',
    'Philanthropy run moved',
    'The fall philanthropy run on October 25 is now at the college track, not the park. Check-in opens at 8:30am.',
    '2026-10-06T15:00:00Z',
  ),
  doc(
    'syn-ann-elections',
    'announcement',
    'Officer elections',
    'Officer elections are at chapter meeting on December 7. Nominations close November 30. Ask Eli Sorensen how to nominate someone.',
    '2026-11-02T15:00:00Z',
  ),
];

export const OFFICIAL_SOURCES: readonly CorpusDocument[] = [
  BYLAWS,
  HOUSE_RULES,
  RISK_POLICY,
  MINUTES_SEPT_7,
  MINUTES_SEPT_14,
  MINUTES_OCT_5,
  ...ANNOUNCEMENTS,
];

/** The calendar, as an events tool would return it. Structured data, never embedded. */
export const CALENDAR_TOOL_TEXT = [
  'October 18, 2026, 11am: Homecoming tailgate, behind the house. Required: no.',
  'October 25, 2026, 9am: Fall philanthropy run, college track. Required: yes.',
  'November 9, 2026, 6pm: Study night, library room 210. Required: no.',
  'November 22, 2026, 8pm: Fall formal, ballroom to be announced. Required: no.',
  'December 7, 2026, 7pm: Chapter meeting with officer elections. Required: yes.',
].join('\n');

/** The open tasks, as a tasks tool would return them. */
export const TASKS_TOOL_TEXT = [
  'Get two quotes for the basement washing machine. Owner: Caleb Osei. Due October 15, 2026.',
  'Name sober monitors for the tailgate. Owner: Wes Tanaka. Due October 16, 2026.',
  'Print run bibs. Owner: Nate Lindqvist. Due October 23, 2026.',
  'Collect nominations for officer elections. Owner: Eli Sorensen. Due November 30, 2026.',
].join('\n');
