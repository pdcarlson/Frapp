import type { DiscordRoleMapping } from '../entities/discord-import.entity';
import { mentionRewriter, planPeopleRemap } from './discord-people-backfill';

const profile = (userId: string, nick: string | null) => ({
  userId,
  nick,
  guildAvatar: null,
  globalName: null,
  username: null,
  avatar: null,
});

const role = (
  id: string,
  name: string,
  overrides: Partial<DiscordRoleMapping> = {},
): DiscordRoleMapping => ({
  discord_role_id: id,
  discord_role_name: name,
  action: 'ignore',
  frapp_role_id: null,
  new_role_name: null,
  read_permission: null,
  ...overrides,
});

describe('planPeopleRemap', () => {
  it('renames authors to their nickname and maps their old mention text', () => {
    const plan = planPeopleRemap({
      authors: [
        { discordUserId: '1', recordedName: 'Pinstripe' },
        { discordUserId: '2', recordedName: 'tristo123' },
        { discordUserId: '3', recordedName: 'Shawn Klein' },
      ],
      profiles: new Map([
        ['1', profile('1', 'Moiz Steenhuis')],
        ['2', profile('2', 'Tristan Hatton')],
        ['3', profile('3', null)],
      ]),
      roleMapping: [],
      frappRoleNames: new Map(),
    });

    expect(plan.authorNames).toEqual(
      new Map([
        ['1', 'Moiz Steenhuis'],
        ['2', 'Tristan Hatton'],
      ]),
    );
    expect(plan.mentions).toEqual(
      new Map([
        ['@Pinstripe', '@MoizSteenhuis'],
        ['@tristo123', '@TristanHatton'],
        ['@Shawn Klein', '@ShawnKlein'],
      ]),
    );
  });

  it('keeps a departed author by their account name, and leaves an unread one alone', () => {
    const plan = planPeopleRemap({
      authors: [
        { discordUserId: '1', recordedName: 'Old Timer' },
        { discordUserId: '2', recordedName: 'Unread Person' },
      ],
      profiles: new Map([['1', null]]),
      roleMapping: [],
      frappRoleNames: new Map(),
    });
    expect(plan.authorNames.size).toBe(0);
    expect(plan.mentions).toEqual(new Map([['@Old Timer', '@OldTimer']]));
  });

  it('maps a role from its Frapp name back to its Discord name', () => {
    const plan = planPeopleRemap({
      authors: [],
      profiles: new Map(),
      roleMapping: [
        role('10', 'Brothers', { action: 'existing', frapp_role_id: 'm' }),
        role('11', 'New Members', { action: 'existing', frapp_role_id: 'n' }),
        role('12', 'Recording Committee', {
          action: 'new',
          frapp_role_id: 'r',
          new_role_name: 'Recording Committee',
        }),
      ],
      frappRoleNames: new Map([
        ['m', 'Member'],
        ['n', 'New Member'],
        ['r', 'Recording Committee'],
      ]),
    });
    expect(plan.mentions).toEqual(
      new Map([
        ['@Member', '@Brothers'],
        ['@New Member', '@NewMembers'],
        ['@NewMember', '@NewMembers'],
        ['@Recording Committee', '@RecordingCommittee'],
      ]),
    );
  });

  it('leaves a name several roles or people shared, since the text cannot say which', () => {
    const plan = planPeopleRemap({
      authors: [],
      profiles: new Map(),
      roleMapping: [
        role('1', 'Recording Secretary', {
          action: 'existing',
          frapp_role_id: 's',
        }),
        role('2', 'Field Secretary', {
          action: 'existing',
          frapp_role_id: 's',
        }),
      ],
      frappRoleNames: new Map([['s', 'Secretary']]),
    });
    expect(plan.mentions.has('@Secretary')).toBe(false);
  });
});

describe('planPeopleRemap, run twice', () => {
  it("leaves an old name that is someone else's new name, so a second run changes nothing", () => {
    // A's account name is B's nickname: `@Moiz` may already mean B.
    const plan = planPeopleRemap({
      authors: [
        { discordUserId: '1', recordedName: 'Moiz' },
        { discordUserId: '2', recordedName: 'Pinstripe' },
      ],
      profiles: new Map([
        ['1', profile('1', 'Big Moiz')],
        ['2', profile('2', 'Moiz')],
      ]),
      roleMapping: [],
      frappRoleNames: new Map(),
    });
    expect(plan.mentions).toEqual(new Map([['@Pinstripe', '@Moiz']]));

    const rewrite = mentionRewriter(plan.mentions);
    const once = rewrite('@Pinstripe and @Moiz');
    expect(rewrite(once)).toBe(once);
  });
});

describe('mentionRewriter', () => {
  const rewrite = mentionRewriter(
    new Map([
      ['@Member', '@Brothers'],
      ['@New Member', '@NewMembers'],
      ['@Shawn Klein', '@ShawnKlein'],
      ['@Brothers', '@Wrong'],
    ]),
  );

  it('rewrites each old mention once, never a replacement again', () => {
    expect(rewrite('@Member your sober brothers\n@Shawn Klein \n@Jèst')).toBe(
      '@Brothers your sober brothers\n@ShawnKlein \n@Jèst',
    );
  });

  it('prefers the longer name and leaves words that only start the same', () => {
    expect(rewrite('@New Member @Members x@Member mail@Member.')).toBe(
      '@NewMembers @Members x@Member mail@Member.',
    );
  });

  it('rewrites a mention followed by punctuation', () => {
    expect(rewrite('thanks @Member!')).toBe('thanks @Brothers!');
  });
});
