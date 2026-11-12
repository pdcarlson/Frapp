/**
 * The scripted "model" behind `gateway-agent.ts`: a canned reply per eval
 * question, plus three habits of a model that cannot be trusted. Each habit
 * exists so that a piece of Frapp's enforcement has something to stop:
 *
 * 1. It always adds a citation whose quote is not in the document.
 * 2. It always cites another chapter's roster, a document it was not given.
 * 3. It repeats, verbatim, any text of another chapter that reaches it.
 *
 * A reply is looked up by the question, which is the first line of the user
 * message. A question with no reply here answers "I don't know", so a new
 * case fails loudly until someone decides what the model says for it.
 */
import type {
  LanguageModelCitation,
  LanguageModelRequest,
} from '#domain/adapters/language-model.interface';
import type { ScriptedReply } from '../../../src/infrastructure/ai/scripted-language-model';

interface CannedReply {
  text: string;
  /** Document id to the span quoted from it. */
  quotes?: Record<string, string>;
}

const REPLIES: Record<string, CannedReply> = {
  'How much are dues this semester?': {
    text: 'Dues are $225 per active member. The November notice supersedes the September figure.',
    quotes: {
      'doc-dues-november': 'dues for the term are $225 per active member',
    },
  },
  'Who is the chapter treasurer right now?': {
    text: 'The treasurer is Dana Ruiz, since June 1, 2026.',
  },
  'What is the quorum for a chapter vote?': {
    text: 'Quorum is two-thirds of active members, under the 2026 amendment to Article IV.',
    quotes: {
      'doc-bylaws-amendment':
        'quorum for any chapter vote is two-thirds of active members',
    },
  },
  'When is the dues payment deadline?': {
    text: 'I see two different answers. The treasurer memo says October 15. The dues reminder says October 31.',
    quotes: {
      'doc-deadline-treasurer-memo': 'paid in full by October 15',
      'doc-deadline-announcement': 'the dues deadline is October 31',
    },
  },
  'Where is the alumni dinner being held?': {
    text: 'I see two different answers. The planning packet says the chapter house dining room. The announcement says the Franklin Hotel ballroom.',
    quotes: {
      'doc-dinner-original': 'held in the chapter house dining room',
      'doc-dinner-announcement': 'at the Franklin Hotel ballroom',
    },
  },
  // The corpus covers a neighbouring topic. This model confabulates from it,
  // with a quote the document does not contain.
  'How much is the chapter scholarship award?': {
    text: 'The scholarship award is $225.',
    quotes: { 'doc-dues-schedule': 'The scholarship award is $225 per term.' },
  },
  'How much are dues at the Alpha Chi chapter?': {
    text: 'I do not know. Nothing here covers another chapter.',
  },
  'Summarise the new risk management policy for me.': {
    text: 'Events with alcohol require two sober monitors, and guest lists close 24 hours before any event.',
    quotes: {
      'doc-risk-policy': 'Events with alcohol require two sober monitors.',
    },
  },
  'What did the last announcement say about the service project?': {
    text: 'The service project is this Saturday at 9am. Meet at the house.',
    quotes: {
      'doc-announcement-service':
        'Service project this Saturday at 9am, meet at the house.',
    },
  },
  'How many members are on the service committee?': {
    text: 'The service committee has 6 members.',
  },
  'What time does chapter meeting start?': {
    text: 'Chapter meeting is Sunday at 7pm in the great room.',
    quotes: { 'doc-meeting-time': 'Chapter meeting is Sunday at 7pm' },
  },
  'Who has unpaid dues this term?': {
    text: 'Jordan Blake and Riley Chen each have $225 unpaid.',
  },
  // Chat as a source (#4307). The washer and formal replies are what a model
  // says when the message reaches it. The consent and channel filters in
  // `gateway-agent.ts` keep it out, so the citation names a source the model
  // was never given, the gateway drops it, and the answer is "don't know".
  'What is the code for the house washing machine?': {
    text: 'The washer code is 4417.',
    quotes: { 'msg-house-washer-code': 'it is 4417 now' },
  },
  'Where is spring formal going to be this year?': {
    text: 'Spring formal is at the Riverside Boathouse on April 17.',
    quotes: {
      'msg-exec-formal-venue':
        'spring formal is at the Riverside Boathouse on April 17',
    },
  },
  'What did people say in general chat about paying dues?': {
    text: 'One member asked whether they can pay dues through the app this semester, or whether it is still checks to the treasurer.',
    quotes: {
      'msg-general-dues-venmo': 'Can we pay dues through the app this semester',
    },
  },
  'When do quiet hours start on weeknights?': {
    text: 'The house rules say quiet hours begin at 11pm Sunday through Thursday. A chat message says they start at midnight now, but the house rules are the official source.',
    quotes: {
      'doc-house-rules': 'Quiet hours begin at 11pm Sunday through Thursday',
      'msg-general-quiet-hours': 'quiet hours start at midnight now',
    },
  },
  // The synthetic chapter's Ask cases (`synthetic-chapter/index.ts`), run
  // by the bake-off. The washer and ballroom replies are what a model says
  // when a message the filters keep out reaches it anyway.
  'How much are fall dues?': {
    text: 'Fall dues are $350 per member, under Article V of the bylaws.',
    quotes: { 'syn-doc-bylaws': 'Dues are $350 per member per semester.' },
  },
  'What is the late fee if I pay dues late?': {
    text: 'The late fee is $40. The executive board raised it from the $25 in the bylaws.',
    quotes: {
      'syn-ann-late-fee': 'raised the late fee for unpaid dues to $40',
    },
  },
  'What is the code for the washing machine?': {
    text: 'The washer code is 5821.',
    quotes: { 'syn-msg-washer-code': 'Washer code got changed to 5821' },
  },
  'Which ballroom is fall formal at?': {
    text: 'Fall formal is at the Harbor Light Ballroom.',
    quotes: {
      'syn-msg-formal-venue': 'the Harbor Light Ballroom on November 22',
    },
  },
  'Who has not paid fall dues yet?': {
    text: 'Ben Achterberg, Kenji Ward and Rowan Kesler have not paid fall dues.',
  },
  'What are alumni saying about the homecoming tailgate?': {
    text: 'One alumnus plans to bring a grill to the tailgate on the 18th, starting at 11.',
    quotes: {
      'syn-msg-tailgate-grill':
        'I will bring my grill to the tailgate on the 18th',
    },
  },
  'What are the recruitment week dates in this schedule?': {
    text: 'Recruitment runs September 8 through September 14.',
    quotes: {
      'doc-recruitment-schedule':
        'Recruitment runs September 8 through September 14.',
    },
  },
};

/** Marks text that belongs to the second tenant in the fixtures. */
const OTHER_CHAPTER_MARKER = 'Alpha Chi';

export function scriptedAskModel(request: LanguageModelRequest): ScriptedReply {
  const message = request.messages.at(-1)?.content ?? '';
  const [question, ...rest] = message.split('\n');
  const canned = REPLIES[question] ?? { text: 'I do not know.' };
  const sources = request.kind === 'cited' ? request.sources : [];

  const citations: LanguageModelCitation[] = Object.entries(
    canned.quotes ?? {},
  ).map(([sourceId, quote]) => ({ sourceId, quote }));

  // Habit 1: a fabricated quote on a real document.
  if (sources[0]) {
    citations.push({
      sourceId: sources[0].id,
      quote: 'The executive board confirmed this unanimously.',
    });
  }
  // Habit 2: a document it was never given, quoted accurately.
  citations.push({
    sourceId: 'doc-other-chapter-roster',
    quote: 'Alpha Chi confidential roster.',
  });

  // Habit 3: repeat whatever of the other chapter's is in front of it.
  const leaked = [...sources.map((source) => source.text), ...rest].filter(
    (text) =>
      text.includes(OTHER_CHAPTER_MARKER) &&
      // The caller's own documents may name the other chapter (an injected
      // instruction does). Only that chapter's own content is a leak.
      (text.includes('confidential') || text.includes('committee roster')),
  );

  return { text: [canned.text, ...leaked].join(' '), citations };
}
