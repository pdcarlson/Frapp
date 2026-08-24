import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DiscordExportFormatError,
  MAX_SUMMARISED_REACTIONS,
  buildImportPayload,
  collectRoles,
  parseExportPart,
  parseExportPreamble,
  resolveAuthorName,
  summariseReactions,
  toImportedAttachments,
  toImportedMessage,
  type DiscordExportMessage,
} from './discord-export';

const FIXTURES = join(__dirname, '../../../test/fixtures/discord');
const readFixture = (name: string) => readFileSync(join(FIXTURES, name));
const part000 = () => parseExportPart(readFixture('part-000.json'));
const byId = (id: string): DiscordExportMessage =>
  part000().messages.find((m) => m.id === id)!;

/** The importer's defaults, so each test states only what it is about. */
function mapMessage(
  message: DiscordExportMessage,
  overrides: Partial<Parameters<typeof toImportedMessage>[0]> = {},
) {
  return toImportedMessage({
    message,
    channelId: 'ch-signet-1',
    importId: 'imp-1',
    resolveAssetPath: () => null,
    resolveReplyTarget: () => null,
    attachmentCount: 0,
    ...overrides,
  });
}

describe('parseExportPreamble', () => {
  it('reads guild and channel out of a truncated head', () => {
    const head = readFixture('part-000.json').toString('utf8').slice(0, 700);
    const preamble = parseExportPreamble(head);

    expect(preamble?.channel.id).toBe('800000000000000001');
    expect(preamble?.channel.name).toBe('general');
    expect(preamble?.channel.category).toBe('General');
    expect(preamble?.guild.name).toBe('Tau Nu Chapter');
  });

  it('is not fooled by the word "messages" inside channel.topic', () => {
    // The fixture's topic contains the literal `"messages"`, so a naive cut on
    // the first occurrence truncates mid-object and yields nothing. This is the
    // whole reason the head parser exists as a tested function.
    const head = readFixture('part-000.json').toString('utf8').slice(0, 700);
    // Escaped in the raw JSON, which is exactly the form a naive
    // `indexOf('"messages"')` would still trip over after unescaping.
    expect(head).toContain('\\"messages\\" pinned above');
    expect(parseExportPreamble(head)?.channel.name).toBe('general');
  });

  it('returns null for something that is not an export', () => {
    expect(parseExportPreamble('{"hello":"world"}')).toBeNull();
    expect(parseExportPreamble('not json at all')).toBeNull();
  });
});

describe('parseExportPart', () => {
  it('parses a real export part', () => {
    const part = part000();
    expect(part.channel.id).toBe('800000000000000001');
    expect(part.messages).toHaveLength(8);
  });

  it('rejects malformed JSON with a typed error', () => {
    expect(() => parseExportPart(readFixture('malformed.json'))).toThrow(
      DiscordExportFormatError,
    );
  });

  it('rejects a JSON document that is not a DCE export', () => {
    const notAnExport = Buffer.from(JSON.stringify({ messages: [] }));
    expect(() => parseExportPart(notAnExport)).toThrow(
      /no channel id/i,
    );
  });
});

describe('toImportedMessage', () => {
  it('uses the Discord timestamp, never the import time', () => {
    // The single most consequential line in the importer: `created_at` defaults
    // to now(), so omitting it stamps a decade of history with the wall clock.
    expect(mapMessage(byId('900000000000000001'))?.created_at).toBe(
      '2019-04-01T10:00:00Z',
    );
  });

  it('never sets a sender and always names an author', () => {
    const row = mapMessage(byId('900000000000000001'));
    expect(row?.sender_id).toBeNull();
    // chat_messages_author_present: sender_id is not null OR author_name is not null
    expect(row?.author_name).toBe('Paul');
    expect(row?.author_external_id).toBe('600000000000000001');
  });

  it('falls back from nickname to username', () => {
    expect(mapMessage(byId('900000000000000002'))?.author_name).toBe(
      'treasurer',
    );
  });

  it('never leaves author_name empty, even with no author at all', () => {
    expect(resolveAuthorName(null)).toBe('Unknown Discord user');
    expect(resolveAuthorName({ nickname: null, name: null })).toBe(
      'Unknown Discord user',
    );
  });

  it('stamps the import id and attachment count into metadata', () => {
    const row = mapMessage(byId('900000000000000002'), { attachmentCount: 1 });
    expect(row?.metadata).toEqual({
      discord_import_id: 'imp-1',
      attachment_count: 1,
    });
  });

  it('leaves mentions empty even when the prose is full of @names', () => {
    // A mention overrides a per-channel mute in the push rules. Resolving these
    // would let an archive lift a mute a member deliberately set.
    const row = mapMessage(byId('900000000000000002'));
    expect(row?.content).toContain('@Paul');
    expect(row?.mentions).toEqual([]);
  });

  it('does not import pins, but records that Discord had one', () => {
    const row = mapMessage(byId('900000000000000002'));
    expect(row?.is_pinned).toBe(false);
    expect(row?.payload.was_pinned_at_source).toBe(true);
  });

  it('carries the edit timestamp through', () => {
    expect(mapMessage(byId('900000000000000002'))?.edited_at).toBe(
      '2019-04-01T10:06:30Z',
    );
  });

  it('resolves a reply whose target is inside the export', () => {
    const row = mapMessage(byId('900000000000000003'), {
      resolveReplyTarget: (id) =>
        id === '900000000000000002' ? 'signet-msg-2' : null,
    });
    expect(row?.reply_to_id).toBe('signet-msg-2');
    expect(row?.payload.reply_to_external_id).toBeUndefined();
  });

  it('keeps an out-of-export reply target on the payload instead of dropping it', () => {
    const row = mapMessage(byId('900000000000000004'));
    expect(row?.reply_to_id).toBeNull();
    expect(row?.payload.reply_to_external_id).toBe('999999999999999999');
  });

  it('maps an attachment-only message to empty content', () => {
    const row = mapMessage(byId('900000000000000003'), { attachmentCount: 1 });
    expect(row?.content).toBe('');
    expect(row?.author_name).toBe('Paul');
  });

  it('resolves an author avatar through the asset resolver', () => {
    const row = mapMessage(byId('900000000000000001'), {
      resolveAssetPath: (p) =>
        p === 'Guild_Files/avatar-paul-a1b2.png' ? 'stored/avatar.png' : null,
    });
    expect(row?.author_avatar_path).toBe('stored/avatar.png');
  });

  it('round-trips a non-Default message type rather than guessing at it', () => {
    const row = mapMessage(byId('900000000000000005'));
    expect(row?.payload.message_type).toBe('GuildMemberJoin');
    expect(row?.kind).toBe('imported');
    expect(row?.type).toBe('TEXT');
  });

  it('records that an author was a bot', () => {
    expect(mapMessage(byId('900000000000000006'))?.payload.author_is_bot).toBe(
      true,
    );
  });

  it('refuses a message that cannot be placed', () => {
    // No timestamp and no id are both unplaceable. A warning for the admin —
    // never a row with an invented value.
    expect(mapMessage(byId('900000000000000007'))).toBeNull();
    const noId = part000().messages.find((m) => m.id === null)!;
    expect(mapMessage(noId)).toBeNull();
  });
});

describe('summariseReactions', () => {
  it('keeps emoji and counts', () => {
    expect(summariseReactions(byId('900000000000000002'))).toEqual([
      { emoji: '🔥', name: 'fire', count: 4 },
      { emoji: '👍', name: 'thumbsup', count: 2 },
    ]);
  });

  it('never carries the reactor list', () => {
    // Both reaction tables require a real `users` row, so per-reactor
    // attribution is unrepresentable — and DCE's users[] is unbounded and
    // PII-shaped. Counts survive; identities are not invented.
    const summary = summariseReactions(byId('900000000000000002'));
    expect(JSON.stringify(summary)).not.toContain('600000000000000001');
  });

  it('drops zero-count and nameless reactions', () => {
    expect(
      summariseReactions({
        reactions: [
          { emoji: { name: '🔥', code: 'fire' }, count: 0 },
          { emoji: { name: null, code: null }, count: 3 },
        ],
      }),
    ).toEqual([]);
  });

  it('caps a pathological reaction list', () => {
    const many = Array.from({ length: 90 }, (_, i) => ({
      emoji: { name: `e${i}`, code: `e${i}` },
      count: 1,
    }));
    expect(summariseReactions({ reactions: many })).toHaveLength(
      MAX_SUMMARISED_REACTIONS,
    );
  });
});

describe('buildImportPayload', () => {
  it('records stickers and embed counts without storing the embeds', () => {
    const payload = buildImportPayload(byId('900000000000000003'), null);
    expect(payload.sticker_names).toEqual(['partyparrot']);
    expect(payload.embed_count).toBeUndefined();
    expect(buildImportPayload(byId('900000000000000002'), null).embed_count).toBe(
      1,
    );
  });

  it('omits optional keys rather than writing nulls', () => {
    const payload = buildImportPayload(byId('900000000000000001'), null);
    expect(Object.keys(payload).sort()).toEqual([
      'author_is_bot',
      'author_username',
      'message_type',
      'reactions',
      'source',
    ]);
  });
});

describe('toImportedAttachments', () => {
  const resolve = (p: string) =>
    p.includes('never-uploaded')
      ? null
      : { bucket: 'chat-archive', storage_path: `stored/${p}`, content_type: 'image/png' };

  it('maps an attachment onto the stored object, never the source url', () => {
    const { rows } = toImportedAttachments(byId('900000000000000002'), resolve);
    expect(rows).toHaveLength(1);
    expect(rows[0].bucket).toBe('chat-archive');
    expect(rows[0].filename).toBe('Rush Schedule (2019).pdf');
    expect(rows[0].byte_size).toBe(51234);
    expect(rows[0].external_url).toBeNull();
  });

  it('collapses two references to one object on the same message', () => {
    // chat_message_attachments is UNIQUE (message_id, bucket, storage_path) and
    // DCE deduplicates identical media, so without this the batch insert fails.
    const { rows } = toImportedAttachments(byId('900000000000000003'), resolve);
    expect(rows).toHaveLength(1);
  });

  it('reports a media reference with no uploaded file instead of dropping it', () => {
    const { rows, unresolved } = toImportedAttachments(
      byId('900000000000000006'),
      resolve,
    );
    expect(rows).toHaveLength(0);
    expect(unresolved).toEqual([
      'general [800000000000000001]_Files/never-uploaded.zip',
    ]);
  });
});

describe('collectRoles', () => {
  it('collects every distinct role named on any author', () => {
    const roles = collectRoles(part000().messages);
    expect([...roles.entries()].sort()).toEqual([
      ['500000000000000001', 'President'],
      ['500000000000000002', 'Brother'],
    ]);
  });
});
