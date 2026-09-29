import type {
  DiscordImportChannel,
  DiscordRoleMapping,
} from '../entities/discord-import.entity';
import {
  PRIVATE_CHANNEL,
  PRIVATE_CHANNEL_MENTION,
  UNKNOWN_CHANNEL_MENTION,
  UNKNOWN_ROLE_MENTION,
  UNKNOWN_USER_MENTION,
  importChannelMentions,
  inertName,
  mergeTargetIds,
  rewriteDiscordMentions,
  roleMentionNames,
  type DiscordMentionResolver,
} from './discord-mentions';

const USER = '264512362768236544';
const ROLE = '750151182395244584';
const CHANNEL = '800000000000000001';
const FRAPP_CHANNEL = '6f1c1c9e-0000-4000-8000-000000000001';

const resolver: DiscordMentionResolver = {
  userName: (id) => (id === USER ? 'NiravBanerji' : null),
  roleName: (id) => (id === ROLE ? 'Brothers' : null),
  channel: (id) =>
    id === CHANNEL ? { name: 'general', frappChannelId: FRAPP_CHANNEL } : null,
};

const rewrite = (content: string) => rewriteDiscordMentions(content, resolver);

describe('rewriteDiscordMentions', () => {
  it('names a role mention: the staging message that filed #2875', () => {
    expect(rewrite(`<@&${ROLE}> we need numbers now`)).toBe(
      '@Brothers we need numbers now',
    );
  });

  it('names a user mention in both of its spellings', () => {
    expect(rewrite(`<@${USER}>`)).toBe('@NiravBanerji');
    // `<@!id>` is the old nickname form; it names the same user.
    expect(rewrite(`hey <@!${USER}>!`)).toBe('hey @NiravBanerji!');
  });

  it('links a channel mention to the Frapp channel it landed in', () => {
    expect(rewrite(`see <#${CHANNEL}>`)).toBe(
      `see [#general](/chat?channel=${FRAPP_CHANNEL})`,
    );
  });

  it('writes a channel that has no Frapp channel yet as plain text', () => {
    const pending = rewriteDiscordMentions(`<#${CHANNEL}>`, {
      ...resolver,
      channel: () => ({ name: 'general', frappChannelId: null }),
    });
    expect(pending).toBe('#general');
  });

  it('writes a channel only some members can read without its name', () => {
    const hidden = rewriteDiscordMentions(`see <#${CHANNEL}>`, {
      ...resolver,
      channel: () => PRIVATE_CHANNEL,
    });
    expect(hidden).toBe(`see ${PRIVATE_CHANNEL_MENTION}`);
  });

  describe('a name is inserted as inert text', () => {
    it('so a nickname cannot plant a disguised link in someone else’s message', () => {
      const out = rewriteDiscordMentions(`<@${USER}> check this`, {
        ...resolver,
        userName: () => '[Verify](https://ev.il)',
      });
      expect(out).toBe('@Verify(https://ev.il) check this');
      expect(out).not.toContain('[');
    });

    it('so a backtick or an asterisk in a role name cannot reshape the message', () => {
      const out = rewriteDiscordMentions(`<@&${ROLE}> read \`this\``, {
        ...resolver,
        roleName: () => '`*Rush*',
      });
      expect(out).toBe('@Rush read `this`');
    });

    it('so a channel name cannot break its own link', () => {
      const out = rewriteDiscordMentions(`<#${CHANNEL}>`, {
        ...resolver,
        channel: () => ({ name: 'rush [2019]', frappChannelId: FRAPP_CHANNEL }),
      });
      expect(out).toBe(`[#rush 2019](/chat?channel=${FRAPP_CHANNEL})`);
    });

    it('so a nickname cannot make an autolink or escape what follows it', () => {
      expect(inertName('<https://ev.il>')).toBe('https://ev.il');
      expect(inertName('back\\slash')).toBe('backslash');
    });

    it('so an underscore at a name’s edge cannot italicise the rest of the message', () => {
      const out = rewriteDiscordMentions(
        `thanks <@${USER}> for the help, see file_`,
        { ...resolver, userName: () => '_Sam_' },
      );
      expect(out).toBe('thanks @Sam for the help, see file_');
      // One inside a word is inert, and common in usernames.
      expect(inertName('big_mike')).toBe('big_mike');
    });

    it('so a bidi control cannot reorder the words around it', () => {
      expect(inertName('ab\u202Ecd\u2066e\u2069')).toBe('abcde');
      // The joiner that holds an emoji sequence together stays.
      expect(inertName('👨\u200D👩\u200D👧')).toBe('👨\u200D👩\u200D👧');
    });

    it('and a name that is nothing but markup reads as unknown', () => {
      const out = rewriteDiscordMentions(`<@${USER}>`, {
        ...resolver,
        userName: () => '[]**',
      });
      expect(out).toBe(UNKNOWN_USER_MENTION);
    });
  });

  it('writes custom emoji, still and animated, as :name:', () => {
    expect(rewrite('gg <:pepehands:123456789012345678>')).toBe(
      'gg :pepehands:',
    );
    expect(rewrite('<a:party_parrot:123456789012345678>')).toBe(
      ':party_parrot:',
    );
  });

  it('writes a timestamp as an absolute UTC time, honouring date-only and time-only styles', () => {
    // 2024-09-29T17:15:00Z
    const at = 1727630100;
    expect(rewrite(`<t:${at}>`)).toBe('2024-09-29 17:15 UTC');
    expect(rewrite(`<t:${at}:F>`)).toBe('2024-09-29 17:15 UTC');
    // Relative would be relative to the reader's clock years later: absolute.
    expect(rewrite(`<t:${at}:R>`)).toBe('2024-09-29 17:15 UTC');
    expect(rewrite(`<t:${at}:D>`)).toBe('2024-09-29');
    expect(rewrite(`<t:${at}:t>`)).toBe('17:15 UTC');
  });

  it('leaves a timestamp Date cannot represent as written', () => {
    expect(rewrite('<t:999999999999999>')).toBe('<t:999999999999999>');
  });

  it('writes a slash-command mention as the command', () => {
    expect(rewrite('run </rush add:123456789012345678>')).toBe('run /rush add');
  });

  describe('an id nothing can name', () => {
    it('reads as a neutral placeholder, never the snowflake', () => {
      const out = rewrite('<@1> <@!2> <@&3> <#4>');
      expect(out).toBe(
        `${UNKNOWN_USER_MENTION} ${UNKNOWN_USER_MENTION} ${UNKNOWN_ROLE_MENTION} ${UNKNOWN_CHANNEL_MENTION}`,
      );
      expect(out).not.toMatch(/\d/);
    });
  });

  describe('code stays literal', () => {
    it('inside an inline code span', () => {
      expect(rewrite(`type \`<@&${ROLE}>\` to ping`)).toBe(
        `type \`<@&${ROLE}>\` to ping`,
      );
    });

    it('inside a fenced block, while the prose around it is named', () => {
      const body = `<@${USER}> try:\n\`\`\`\n<@${USER}> <#${CHANNEL}>\n\`\`\`\ndone <@&${ROLE}>`;
      expect(rewrite(body)).toBe(
        `@NiravBanerji try:\n\`\`\`\n<@${USER}> <#${CHANNEL}>\n\`\`\`\ndone @Brothers`,
      );
    });

    it('inside a double-backtick span', () => {
      expect(rewrite(`\`\`<@${USER}>\`\``)).toBe(`\`\`<@${USER}>\`\``);
    });

    it('closing only on a run of the same length, as CommonMark and Discord do', () => {
      // One backtick opens; the two after the token are not its closer.
      expect(rewrite(`\`<@${USER}>\`\``)).toBe('`@NiravBanerji``');
      // A longer run inside a span is part of its text.
      expect(rewrite(`\` \`\` <@${USER}> \``)).toBe(`\` \`\` <@${USER}> \``);
    });

    it('but not between escaped backticks, which are literal', () => {
      expect(rewrite(`\\\`<@${USER}>\\\``)).toBe('\\`@NiravBanerji\\`');
    });

    it('but not after an unclosed backtick, which is not code', () => {
      expect(rewrite(`\`oops <@${USER}>`)).toBe('`oops @NiravBanerji');
    });
  });

  it('leaves a backslash-escaped token as written, as Discord does', () => {
    expect(rewrite(`\\<@${USER}>`)).toBe(`\\<@${USER}>`);
  });

  it('names a token after an escaped backslash, which escapes only itself', () => {
    expect(rewrite(`C:\\\\<@${USER}>`)).toBe('C:\\\\@NiravBanerji');
  });

  it('leaves text with no token alone, angle brackets included', () => {
    const text = 'a < b and <https://example.com> and <@notanid> and <3';
    expect(rewrite(text)).toBe(text);
  });

  it('names every token in a message, not just the first', () => {
    expect(rewrite(`<@&${ROLE}><@${USER}> <@&${ROLE}>`)).toBe(
      '@Brothers@NiravBanerji @Brothers',
    );
  });

  it('stays linear on a body of unclosed backticks', () => {
    const body = `${'`'.repeat(1)}x`.repeat(20_000) + `<@${USER}>`;
    const started = Date.now();
    expect(rewrite(body).endsWith('@NiravBanerji')).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

function channelRow(
  overrides: Partial<DiscordImportChannel>,
): DiscordImportChannel {
  return {
    id: 'row',
    import_id: 'imp',
    discord_channel_id: CHANNEL,
    discord_channel_name: 'general',
    discord_category: null,
    mapping_action: 'create_new',
    target_channel_id: null,
    new_channel_name: null,
    new_channel_is_read_only: false,
    message_count: 0,
    imported_count: 0,
    status: 'pending',
    error: null,
    cursor_before_snowflake: null,
    parent_discord_channel_id: null,
    position: 0,
    readable: true,
    private_in_discord: false,
    new_channel_type: 'PUBLIC',
    new_channel_required_permissions: null,
    discord_reader_role_ids: null,
    new_channel_same_as_discord: false,
    ...overrides,
  };
}

describe('inertName', () => {
  it('keeps what reads as a name, underscores included', () => {
    expect(inertName('big_mike (VP)')).toBe('big_mike (VP)');
  });

  it('turns line breaks into spaces', () => {
    expect(inertName('two\nlines')).toBe('two lines');
  });
});

describe('importChannelMentions', () => {
  const NONE = new Set<string>();

  it('names a channel the import creates by its Frapp name, linked once it exists', () => {
    const row = channelRow({ new_channel_name: 'General Chat' });
    const lookup = importChannelMentions([row], NONE);
    expect(lookup(CHANNEL)).toEqual({
      name: 'General Chat',
      frappChannelId: null,
    });
    // The worker writes the target onto the same row object.
    row.target_channel_id = FRAPP_CHANNEL;
    expect(lookup(CHANNEL)).toEqual({
      name: 'General Chat',
      frappChannelId: FRAPP_CHANNEL,
    });
  });

  it('names a thread as itself, not by the name it inherits, and links it to where its parent landed', () => {
    const parent = channelRow({
      new_channel_name: 'General Chat',
      target_channel_id: FRAPP_CHANNEL,
    });
    // A thread row carries its parent's decision, new name included.
    const thread = channelRow({
      discord_channel_id: '800000000000000002',
      discord_channel_name: 'rush-week-plans',
      new_channel_name: 'General Chat',
      parent_discord_channel_id: CHANNEL,
    });
    expect(
      importChannelMentions([parent, thread], NONE)('800000000000000002'),
    ).toEqual({ name: 'rush-week-plans', frappChannelId: FRAPP_CHANNEL });
  });

  describe('is named only when its messages landed where every member reads', () => {
    it('not a channel the import creates restricted, nor a thread in one', () => {
      const gated = channelRow({
        new_channel_type: 'ROLE_GATED',
        new_channel_required_permissions: ['channels:read:exec'],
        private_in_discord: true,
        target_channel_id: FRAPP_CHANNEL,
      });
      const thread = channelRow({
        discord_channel_id: '800000000000000002',
        discord_channel_name: 'expel-vote',
        parent_discord_channel_id: CHANNEL,
        new_channel_type: 'ROLE_GATED',
      });
      const lookup = importChannelMentions([gated, thread], NONE);
      expect(lookup(CHANNEL)).toBe(PRIVATE_CHANNEL);
      expect(lookup('800000000000000002')).toBe(PRIVATE_CHANNEL);
    });

    it('but one the admin created for the whole chapter, however private it was in Discord', () => {
      const lookup = importChannelMentions(
        [channelRow({ private_in_discord: true, new_channel_type: 'PUBLIC' })],
        NONE,
      );
      expect(lookup(CHANNEL)).toEqual({
        name: 'general',
        frappChannelId: null,
      });
    });

    it('a merge only when the Frapp channel it merged into is whole-chapter', () => {
      const merged = channelRow({
        mapping_action: 'use_existing',
        target_channel_id: FRAPP_CHANNEL,
        private_in_discord: true,
      });
      expect(importChannelMentions([merged], NONE)(CHANNEL)).toBe(
        PRIVATE_CHANNEL,
      );
      expect(
        importChannelMentions([merged], new Set([FRAPP_CHANNEL]))(CHANNEL),
      ).toEqual({ name: 'general', frappChannelId: FRAPP_CHANNEL });
    });

    it('a skipped channel, which landed nowhere, only when Discord showed it to everyone', () => {
      for (const private_in_discord of [true, null]) {
        const lookup = importChannelMentions(
          [channelRow({ mapping_action: 'skip', private_in_discord })],
          NONE,
        );
        expect(lookup(CHANNEL)).toBe(PRIVATE_CHANNEL);
      }
      const open = importChannelMentions(
        [
          channelRow({
            mapping_action: 'skip',
            private_in_discord: false,
            target_channel_id: FRAPP_CHANNEL,
          }),
        ],
        NONE,
      );
      // Named, never linked.
      expect(open(CHANNEL)).toEqual({ name: 'general', frappChannelId: null });
    });

    it('and a private thread of a skipped channel is private', () => {
      const parent = channelRow({
        mapping_action: 'skip',
        private_in_discord: false,
      });
      const thread = channelRow({
        discord_channel_id: '800000000000000002',
        discord_channel_name: 'expel-vote',
        mapping_action: 'skip',
        parent_discord_channel_id: CHANNEL,
        private_in_discord: true,
      });
      expect(
        importChannelMentions([parent, thread], NONE)('800000000000000002'),
      ).toBe(PRIVATE_CHANNEL);
    });
  });

  it('knows nothing of a channel outside the import', () => {
    expect(importChannelMentions([channelRow({})], NONE)('1')).toBeNull();
  });
});

describe('mergeTargetIds', () => {
  it('lists each Frapp channel the import merges into, once', () => {
    expect(
      mergeTargetIds([
        channelRow({ mapping_action: 'use_existing', target_channel_id: 'a' }),
        channelRow({ mapping_action: 'use_existing', target_channel_id: 'a' }),
        channelRow({ mapping_action: 'create_new', target_channel_id: 'b' }),
        channelRow({ mapping_action: 'use_existing', target_channel_id: null }),
      ]),
    ).toEqual(['a']);
  });
});

describe('roleMentionNames', () => {
  const entry = (
    overrides: Partial<DiscordRoleMapping>,
  ): DiscordRoleMapping => ({
    discord_role_id: ROLE,
    discord_role_name: 'Brothers 🦁',
    action: 'ignore',
    frapp_role_id: null,
    new_role_name: null,
    read_permission: null,
    ...overrides,
  });

  it('reads a mapped role by its current Frapp name', () => {
    const names = roleMentionNames({
      roleMapping: [entry({ action: 'existing', frapp_role_id: 'r1' })],
      frappRoleNames: new Map([['r1', 'Member']]),
      guildId: null,
    });
    expect(names.get(ROLE)).toBe('Member');
  });

  it('reads an ignored role by its Discord name', () => {
    const names = roleMentionNames({
      roleMapping: [entry({})],
      frappRoleNames: new Map(),
      guildId: null,
    });
    expect(names.get(ROLE)).toBe('Brothers 🦁');
  });

  it('falls back to the name it was created with, then Discord, when the Frapp role is gone', () => {
    const created = roleMentionNames({
      roleMapping: [
        entry({
          action: 'new',
          frapp_role_id: 'gone',
          new_role_name: 'Brothers',
        }),
      ],
      frappRoleNames: new Map(),
      guildId: null,
    });
    expect(created.get(ROLE)).toBe('Brothers');
    const existing = roleMentionNames({
      roleMapping: [entry({ action: 'existing', frapp_role_id: 'gone' })],
      frappRoleNames: new Map(),
      guildId: null,
    });
    expect(existing.get(ROLE)).toBe('Brothers 🦁');
  });

  it('knows nothing of an entry whose only name is its id', () => {
    // What `parseRoleMapping` stores for an entry saved without a name.
    const names = roleMentionNames({
      roleMapping: [entry({ discord_role_name: ROLE })],
      frappRoleNames: new Map(),
      guildId: null,
    });
    expect(names.has(ROLE)).toBe(false);
  });

  it("reads @everyone's role, whose id is the guild's, as everyone", () => {
    const names = roleMentionNames({
      roleMapping: [],
      frappRoleNames: new Map(),
      guildId: '700000000000000000',
    });
    expect(names.get('700000000000000000')).toBe('everyone');
  });
});
