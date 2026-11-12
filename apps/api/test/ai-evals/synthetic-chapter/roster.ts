/**
 * The synthetic chapter's people and channels.
 *
 * Everything here is invented. The chapter, the college, the town and every
 * name are made up for this file; none is a real member's, and the repo is
 * public, so none may ever be. A name that turns out to match a real person
 * does so by chance, and should be changed if anyone asks.
 */
import { CHANNEL } from '../cases/fixtures';

/** The synthetic chapter's id. Its own tenant, apart from the cases' fixtures. */
export const SYNTHETIC_CHAPTER = 'chapter-synthetic-lantern';

export const SYNTHETIC_CHAPTER_NAME =
  'Order of the Lantern, Northfield College chapter (fictional)';

export type SyntheticRole =
  | 'President'
  | 'Vice President'
  | 'Treasurer'
  | 'Secretary'
  | 'Social Chair'
  | 'House Manager'
  | 'Risk Manager'
  | 'Philanthropy Chair'
  | 'Member'
  | 'Alumni';

export interface SyntheticMember {
  id: string;
  name: string;
  role: SyntheticRole;
  /**
   * The answer on the AI consent sheet: yes, no, or never answered. Only yes
   * lets a member's chat messages reach a model; unanswered counts as no.
   */
  consent: 'yes' | 'no' | 'unanswered';
  /** On the social committee, which opens `#social-committee`. */
  socialCommittee?: boolean;
}

export const SOCIAL_COMMITTEE_CHANNEL = 'channel-social-committee';

/** Officers who sit on the Exec board tier, which opens `#exec`. */
export const EXEC_ROLES: ReadonlySet<SyntheticRole> = new Set([
  'President',
  'Vice President',
  'Treasurer',
  'Secretary',
  'Risk Manager',
]);

const m = (
  id: string,
  name: string,
  role: SyntheticRole,
  consent: SyntheticMember['consent'] = 'yes',
  socialCommittee = false,
): SyntheticMember => ({ id, name, role, consent, socialCommittee });

/**
 * Forty people: a full exec board, chairs, members and a few alumni. Two
 * members share the first name Jordan, on purpose: a suggested task for
 * "Jordan" must leave the owner blank (`meetings.md` § Suggested tasks).
 */
export const ROSTER: readonly SyntheticMember[] = [
  m('syn-owen-hale', 'Owen Hale', 'President'),
  m('syn-marcus-bell', 'Marcus Bell', 'Vice President'),
  m('syn-priya-natarajan', 'Priya Natarajan', 'Treasurer'),
  m('syn-eli-sorensen', 'Eli Sorensen', 'Secretary'),
  m('syn-dante-reyes', 'Dante Reyes', 'Social Chair', 'yes', true),
  m('syn-caleb-osei', 'Caleb Osei', 'House Manager'),
  m('syn-wes-tanaka', 'Wes Tanaka', 'Risk Manager'),
  m('syn-nate-lindqvist', 'Nate Lindqvist', 'Philanthropy Chair'),
  m('syn-jordan-pike', 'Jordan Pike', 'Member', 'yes', true),
  m('syn-jordan-mbeki', 'Jordan Mbeki', 'Member'),
  m('syn-theo-marsh', 'Theo Marsh', 'Member', 'no'),
  m('syn-sam-okafor', 'Sam Okafor', 'Member', 'yes', true),
  m('syn-luis-carvalho', 'Luis Carvalho', 'Member'),
  m('syn-ben-achterberg', 'Ben Achterberg', 'Member', 'unanswered'),
  m('syn-ravi-menon', 'Ravi Menon', 'Member'),
  m('syn-isaac-feld', 'Isaac Feld', 'Member', 'yes', true),
  m('syn-harlan-voss', 'Harlan Voss', 'Member', 'no'),
  m('syn-milo-grant', 'Milo Grant', 'Member'),
  m('syn-andre-baptiste', 'Andre Baptiste', 'Member'),
  m('syn-kenji-ward', 'Kenji Ward', 'Member', 'unanswered'),
  m('syn-tobias-lund', 'Tobias Lund', 'Member'),
  m('syn-felix-adeyemi', 'Felix Adeyemi', 'Member', 'yes', true),
  m('syn-grady-holm', 'Grady Holm', 'Member'),
  m('syn-cyrus-farahani', 'Cyrus Farahani', 'Member'),
  m('syn-declan-shea', 'Declan Shea', 'Member', 'no'),
  m('syn-micah-stroud', 'Micah Stroud', 'Member'),
  m('syn-arlo-whitcomb', 'Arlo Whitcomb', 'Member'),
  m('syn-rowan-kesler', 'Rowan Kesler', 'Member'),
  m('syn-emmett-quade', 'Emmett Quade', 'Member'),
  m('syn-silas-varga', 'Silas Varga', 'Member', 'unanswered'),
  m('syn-jonah-ibarra', 'Jonah Ibarra', 'Member'),
  m('syn-leo-castellan', 'Leo Castellan', 'Member'),
  m('syn-nikhil-rao', 'Nikhil Rao', 'Member'),
  m('syn-otto-brandt', 'Otto Brandt', 'Member'),
  m('syn-quinn-albright', 'Quinn Albright', 'Member'),
  m('syn-reid-hargrove', 'Reid Hargrove', 'Member'),
  m('syn-gil-fairbanks', 'Gil Fairbanks', 'Alumni'),
  m('syn-howard-pruitt', 'Howard Pruitt', 'Alumni', 'no'),
  m('syn-vince-delacroix', 'Vince Delacroix', 'Alumni'),
  m('syn-abe-lindgren', 'Abe Lindgren', 'Alumni'),
];

export function member(id: string): SyntheticMember {
  const found = ROSTER.find((person) => person.id === id);
  if (!found) throw new Error(`No synthetic member ${id}`);
  return found;
}

/** The chat channels a member of this role can open, by the defaults. */
export function channelsFor(person: SyntheticMember): string[] {
  if (person.role === 'Alumni') {
    return [CHANNEL.announcements, CHANNEL.alumni];
  }
  return [
    CHANNEL.announcements,
    CHANNEL.general,
    CHANNEL.house,
    CHANNEL.alumni,
    ...(EXEC_ROLES.has(person.role) ? [CHANNEL.exec] : []),
    ...(person.socialCommittee || person.role === 'Social Chair'
      ? [SOCIAL_COMMITTEE_CHANNEL]
      : []),
  ];
}

export const CHANNEL_NAMES: Readonly<Record<string, string>> = {
  [CHANNEL.announcements]: '#announcements',
  [CHANNEL.general]: '#general',
  [CHANNEL.house]: '#house',
  [CHANNEL.alumni]: '#alumni',
  [CHANNEL.exec]: '#exec',
  [SOCIAL_COMMITTEE_CHANNEL]: '#social-committee',
};

/** The roster as the minutes drafter is given it: names and roles. */
export function rosterText(): string {
  return ROSTER.filter((person) => person.role !== 'Alumni')
    .map((person) => `${person.name} (${person.role})`)
    .join('\n');
}
