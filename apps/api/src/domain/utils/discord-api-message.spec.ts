import {
  EMPTY_CONTENT_TALLY,
  MIN_AUTHORED_MESSAGES_FOR_CONTENT_CHECK,
  discordAttachmentKey,
  isLikelyMissingMessageContentIntent,
  tallyMessageContent,
  toExportShapeMessage,
  type DiscordApiMessage,
} from './discord-api-message';
import { toImportedMessage } from './discord-export';

const CHANNEL = 'signet-channel-1';
const IMPORT = 'import-1';

function apiMessage(
  overrides: Partial<DiscordApiMessage> = {},
): DiscordApiMessage {
  return {
    id: '1000000000000000001',
    channel_id: '900000000000000001',
    type: 0,
    content: 'ship it',
    timestamp: '2019-03-04T18:22:11.000+00:00',
    edited_timestamp: null,
    pinned: false,
    author: {
      id: '2000000000000000002',
      username: 'pdcarlson',
      global_name: 'Paul',
      bot: false,
    },
    member: { nick: 'Prez', roles: ['3000000000000000003'] },
    attachments: [],
    embeds: [],
    ...overrides,
  };
}

describe('toExportShapeMessage', () => {
  it('feeds the phase-2 mapper, so an API message maps exactly like a DCE one', () => {
    // The whole point of the adapter: no second importer. What comes out of it
    // must be consumable by `toImportedMessage` with no bot-specific branch.
    const row = toImportedMessage({
      message: toExportShapeMessage(apiMessage()),
      channelId: CHANNEL,
      importId: IMPORT,
      resolveAssetPath: () => null,
      resolveReplyTarget: () => null,
      attachmentCount: 0,
    });

    expect(row).not.toBeNull();
    // THE line the whole feature turns on — history keeps its own date.
    expect(row!.created_at).toBe('2019-03-04T18:22:11.000+00:00');
    expect(row!.sender_id).toBeNull();
    expect(row!.kind).toBe('imported');
    expect(row!.external_message_id).toBe('1000000000000000001');
    expect(row!.metadata.discord_import_id).toBe(IMPORT);
  });

  it('prefers the server nickname, which is what the channel actually showed', () => {
    const shaped = toExportShapeMessage(apiMessage());
    expect(shaped.author?.nickname).toBe('Prez');

    const row = toImportedMessage({
      message: shaped,
      channelId: CHANNEL,
      importId: IMPORT,
      resolveAssetPath: () => null,
      resolveReplyTarget: () => null,
      attachmentCount: 0,
    });
    expect(row!.author_name).toBe('Prez');
  });

  it('falls back to the display name, then the handle, never to the handle first', () => {
    const noNick = toExportShapeMessage(apiMessage({ member: null }));
    expect(noNick.author?.name).toBe('Paul');

    const noGlobal = toExportShapeMessage(
      apiMessage({
        member: null,
        author: { id: '2', username: 'pdcarlson', global_name: null },
      }),
    );
    expect(noGlobal.author?.name).toBe('pdcarlson');
  });

  it('never invents an author name, because a NOT NULL CHECK depends on it', () => {
    const row = toImportedMessage({
      message: toExportShapeMessage(apiMessage({ author: null, member: null })),
      channelId: CHANNEL,
      importId: IMPORT,
      resolveAssetPath: () => null,
      resolveReplyTarget: () => null,
      attachmentCount: 0,
    });
    expect(row!.author_name).toBe('Unknown Discord user');
  });

  it('names the numeric message type, so both paths store the same string', () => {
    expect(toExportShapeMessage(apiMessage({ type: 0 })).type).toBe('Default');
    expect(toExportShapeMessage(apiMessage({ type: 19 })).type).toBe('Reply');
    // An unknown type keeps the fact rather than dropping it to null.
    expect(toExportShapeMessage(apiMessage({ type: 44 })).type).toBe('44');
  });

  it('expands role ids into named roles, which the API only gives per-guild', () => {
    const shaped = toExportShapeMessage(apiMessage(), {
      roleNamesById: new Map([['3000000000000000003', 'Exec']]),
    });
    expect(shaped.author?.roles).toEqual([
      { id: '3000000000000000003', name: 'Exec' },
    ]);
  });

  it('falls back to the bare id when the guild did not name a role', () => {
    const shaped = toExportShapeMessage(apiMessage());
    expect(shaped.author?.roles).toEqual([
      { id: '3000000000000000003', name: '3000000000000000003' },
    ]);
  });

  it('maps a reply reference so the importer can resolve it', () => {
    const shaped = toExportShapeMessage(
      apiMessage({
        type: 19,
        message_reference: {
          message_id: '999',
          channel_id: '900000000000000001',
          guild_id: '800',
        },
      }),
    );
    expect(shaped.reference?.messageId).toBe('999');

    const row = toImportedMessage({
      message: shaped,
      channelId: CHANNEL,
      importId: IMPORT,
      resolveAssetPath: () => null,
      resolveReplyTarget: (id) => (id === '999' ? 'signet-msg-999' : null),
      attachmentCount: 0,
    });
    expect(row!.reply_to_id).toBe('signet-msg-999');
  });

  it('records a Discord pin as a fact without spending a Signet pin slot', () => {
    const row = toImportedMessage({
      message: toExportShapeMessage(apiMessage({ pinned: true })),
      channelId: CHANNEL,
      importId: IMPORT,
      resolveAssetPath: () => null,
      resolveReplyTarget: () => null,
      attachmentCount: 0,
    });
    expect(row!.is_pinned).toBe(false);
    expect(row!.payload.was_pinned_at_source).toBe(true);
  });

  it('never resolves mentions, so an archive cannot lift a member’s mute', () => {
    const row = toImportedMessage({
      message: toExportShapeMessage(
        apiMessage({ content: 'hey @everyone and <@2000000000000000002>' }),
      ),
      channelId: CHANNEL,
      importId: IMPORT,
      resolveAssetPath: () => null,
      resolveReplyTarget: () => null,
      attachmentCount: 0,
    });
    expect(row!.mentions).toEqual([]);
  });

  it('summarises reactions to emoji and count, inventing no identities', () => {
    const shaped = toExportShapeMessage(
      apiMessage({
        reactions: [
          { count: 3, emoji: { id: null, name: '🔥' } },
          { count: 0, emoji: { id: null, name: '💀' } },
        ],
      }),
    );
    const row = toImportedMessage({
      message: shaped,
      channelId: CHANNEL,
      importId: IMPORT,
      resolveAssetPath: () => null,
      resolveReplyTarget: () => null,
      attachmentCount: 0,
    });
    // Zero-count reactions are dropped; no per-reactor data survives.
    expect(row!.payload.reactions).toEqual([
      { emoji: '🔥', name: null, count: 3 },
    ]);
  });

  it('drops a message with no id or no timestamp rather than inventing one', () => {
    for (const broken of [
      apiMessage({ id: null }),
      apiMessage({ timestamp: null }),
    ]) {
      const row = toImportedMessage({
        message: toExportShapeMessage(broken),
        channelId: CHANNEL,
        importId: IMPORT,
        resolveAssetPath: () => null,
        resolveReplyTarget: () => null,
        attachmentCount: 0,
      });
      expect(row).toBeNull();
    }
  });
});

describe('discordAttachmentKey', () => {
  it('is stable across the signed CDN parameters that rotate', () => {
    // The same object, read twice, arrives with different `?ex=&is=&hm=`
    // values. Keying on the URL would re-upload every attachment on resume.
    const first = discordAttachmentKey({
      id: '77',
      filename: 'composite.png',
      url: 'https://cdn.discordapp.com/attachments/1/77/composite.png?ex=aaa&is=bbb&hm=ccc',
    });
    const second = discordAttachmentKey({
      id: '77',
      filename: 'composite.png',
      url: 'https://cdn.discordapp.com/attachments/1/77/composite.png?ex=zzz&is=yyy&hm=xxx',
    });
    expect(first).toBe('77/composite.png');
    expect(second).toBe(first);
  });

  it('returns null without an id, since there is then no stable key', () => {
    expect(discordAttachmentKey({ filename: 'x.png' })).toBeNull();
  });

  it('is what the mapper writes into `url`, so the manifest lookup is shared', () => {
    const shaped = toExportShapeMessage(
      apiMessage({
        attachments: [
          {
            id: '77',
            filename: 'composite.png',
            size: 1234,
            url: 'https://cdn.discordapp.com/attachments/1/77/composite.png?ex=aaa',
            content_type: 'image/png',
          },
        ],
      }),
    );
    // Not the CDN URL — the manifest key, exactly where DCE puts its
    // export-relative path, so `toImportedAttachments` needs no branch.
    expect(shaped.attachments?.[0]?.url).toBe('77/composite.png');
    expect(shaped.attachments?.[0]?.fileSizeBytes).toBe(1234);
  });
});

describe('the missing Message Content Intent check', () => {
  const blank = (type: number): DiscordApiMessage => ({
    id: '1',
    type,
    timestamp: '2020-01-01T00:00:00Z',
    content: '',
    attachments: [],
    embeds: [],
    author: { id: '2', username: 'x' },
  });

  it('trips when enough authored messages come back with nothing in them', () => {
    let tally = { ...EMPTY_CONTENT_TALLY };
    tally = tallyMessageContent(
      tally,
      Array.from({ length: MIN_AUTHORED_MESSAGES_FOR_CONTENT_CHECK }, () =>
        blank(0),
      ),
    );
    expect(isLikelyMissingMessageContentIntent(tally)).toBe(true);
  });

  it('does not trip below the sample size — a quiet channel is not a broken bot', () => {
    let tally = { ...EMPTY_CONTENT_TALLY };
    tally = tallyMessageContent(
      tally,
      Array.from({ length: MIN_AUTHORED_MESSAGES_FOR_CONTENT_CHECK - 1 }, () =>
        blank(0),
      ),
    );
    expect(isLikelyMissingMessageContentIntent(tally)).toBe(false);
  });

  it('ignores system messages, so a #welcome full of join notices is safe', () => {
    // Type 7 is GUILD_MEMBER_JOIN: legitimately empty, and a channel full of
    // them would otherwise look exactly like a bot with no intent.
    let tally = { ...EMPTY_CONTENT_TALLY };
    tally = tallyMessageContent(
      tally,
      Array.from({ length: 200 }, () => blank(7)),
    );
    expect(tally.authored).toBe(0);
    expect(isLikelyMissingMessageContentIntent(tally)).toBe(false);
  });

  it('clears permanently once a single message proves content is readable', () => {
    let tally = { ...EMPTY_CONTENT_TALLY };
    tally = tallyMessageContent(tally, [
      ...Array.from({ length: 100 }, () => blank(0)),
      { ...blank(0), content: 'a real message' },
    ]);
    expect(isLikelyMissingMessageContentIntent(tally)).toBe(false);
  });

  it('counts an attachment or an embed as substance, not just text', () => {
    // A bot without the intent gets empty attachments AND embeds too, so
    // either one present means the intent is fine and the channel is just
    // image-heavy.
    for (const substantive of [
      { ...blank(0), attachments: [{ id: '1', filename: 'a.png' }] },
      { ...blank(0), embeds: [{}] },
    ]) {
      let tally = { ...EMPTY_CONTENT_TALLY };
      tally = tallyMessageContent(tally, [
        ...Array.from({ length: 100 }, () => blank(0)),
        substantive,
      ]);
      expect(isLikelyMissingMessageContentIntent(tally)).toBe(false);
    }
  });
});
