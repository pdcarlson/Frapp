import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  collectApiSources,
  REPOSITORY_SRC_ROOT,
} from '#test/helpers/repository-corpus';

/**
 * Static guard for the PGRST201 class of bug (#4087, and #746 before it).
 *
 * PostgREST refuses an embed named by table alone when more than one
 * relationship links the two tables. #4042 created exactly that between
 * `chat_messages` and `chat_channels`: `chat_messages.channel_id` and
 * `chat_channels.background_message_id`. (`chapters.chat_background_message_id`
 * is the only link between `chapters` and `chat_messages`; PostgREST does not
 * treat `chat_channels` as a junction between them, checked on the local stack
 * 2026-11-11, so that pair needs no hint.) The repository specs run against a
 * fake client that ignores the select projection, so a bare embed passed CI
 * and failed on every call in production.
 *
 * Each pair below must name one of its allowed constraints, wherever the
 * embed sits directly under its parent: in a statement that starts at
 * `.from('<parent>')`, or inside the column list of a `<parent>(...)` embed
 * from any other table. Naming the wrong FK resolves without error and scopes
 * rows by the wrong relationship, so the allowed list is exact, not "any
 * `_fkey`".
 *
 * This reads source text, so it sees only a projection written inline; one
 * built from a constant elsewhere slips past it, as does a `;` inside a string
 * mid-chain (comments are stripped first).
 * `test/integration/chat-message-channel-embed.integration-spec.ts` runs the
 * real queries against a local stack.
 */
interface AmbiguousPair {
  parent: string;
  embed: string;
  allowed: readonly string[];
}

const AMBIGUOUS_PAIRS: readonly AmbiguousPair[] = [
  // A message's own channel. The background FK from here would mean "channels
  // that use this message as their background", which is never a chapter scope.
  {
    parent: 'chat_messages',
    embed: 'chat_channels',
    allowed: ['chat_messages_channel_id_fkey'],
  },
  // From a channel both are real: its messages, or its background message.
  {
    parent: 'chat_channels',
    embed: 'chat_messages',
    allowed: [
      'chat_messages_channel_id_fkey',
      'chat_channels_background_message_id_fkey',
    ],
  },
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The text between the paren at `open` and its match. */
function balancedFrom(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/** Every embed of `pair.embed` directly under `pair.parent` that names none of its allowed FKs. */
function findUnhintedEmbeds(rawSource: string, pair: AmbiguousPair): string[] {
  const source = stripComments(rawSource);
  const scopes: string[] = [];

  const fromCall = new RegExp(
    `\\.from\\(\\s*['"\`]${pair.parent}['"\`]\\s*\\)`,
    'g',
  );
  for (const match of source.matchAll(fromCall)) {
    const start = match.index + match[0].length;
    const end = source.indexOf(';', start);
    scopes.push(source.slice(start, end === -1 ? undefined : end));
  }
  const parentEmbed = new RegExp(`\\b${pair.parent}(?:!\\w+)*\\s*\\(`, 'g');
  for (const match of source.matchAll(parentEmbed)) {
    scopes.push(balancedFrom(source, match.index + match[0].length - 1));
  }

  // `embed`, then any `!modifier` segments, then the paren of its column
  // list. A filter path (`chat_channels.chapter_id`) has no paren.
  const embedRef = new RegExp(`\\b${pair.embed}((?:!\\w+)*)\\s*\\(`, 'g');
  return scopes.flatMap((scope) =>
    [...scope.matchAll(embedRef)]
      .filter(
        (ref) => !ref[1].split('!').some((hint) => pair.allowed.includes(hint)),
      )
      .map((ref) => ref[0]),
  );
}

describe('embeds between tables with more than one relationship', () => {
  const [messageToChannel] = AMBIGUOUS_PAIRS;
  const check = (source: string) =>
    findUnhintedEmbeds(source, messageToChannel);

  it('flags a bare embed and accepts the channel_id hint', () => {
    expect(
      check(
        `this.supabase.from('chat_messages').select('id, chat_channels!inner(chapter_id)').eq('chat_channels.chapter_id', x);`,
      ),
    ).toEqual(['chat_channels!inner(']);
    expect(
      check(
        `this.supabase.from('chat_messages').select(\`*, chat_channels(chapter_id)\`);`,
      ),
    ).toEqual(['chat_channels(']);
    expect(
      check(
        `this.supabase.from('chat_messages').select('id, chat_channels!chat_messages_channel_id_fkey!inner(chapter_id)').eq('chat_channels.chapter_id', x);`,
      ),
    ).toEqual([]);
  });

  it('flags the wrong FK, which resolves without error', () => {
    expect(
      check(
        `this.supabase.from('chat_messages').select('id, chat_channels!chat_channels_background_message_id_fkey!inner(chapter_id)');`,
      ),
    ).toEqual([
      'chat_channels!chat_channels_background_message_id_fkey!inner(',
    ]);
  });

  it('flags an embed nested under a chat_messages embed from another table', () => {
    expect(
      check(
        `this.supabase.from('chat_message_bookmarks').select('id, message:chat_messages!inner(id, chat_channels(chapter_id))');`,
      ),
    ).toEqual(['chat_channels(']);
  });

  it('is not cut short by a semicolon in a mid-chain comment', () => {
    expect(
      check(
        `this.supabase\n  .from('chat_messages') // via the channel; see #4087\n  .select('id, chat_channels!inner(chapter_id)');`,
      ),
    ).toEqual(['chat_channels!inner(']);
  });

  it('leaves an embed from a table with one relationship alone', () => {
    expect(
      check(
        `this.supabase.from('chat_message_attachments').select('*, chat_channels!inner(chapter_id)');`,
      ),
    ).toEqual([]);
  });

  it('no API source embeds one without naming its FK', () => {
    const offenders = collectApiSources(
      (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
    ).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return AMBIGUOUS_PAIRS.flatMap((pair) =>
        findUnhintedEmbeds(source, pair).map(
          (ref) =>
            `${relative(REPOSITORY_SRC_ROOT, file)}: under ${pair.parent}, ${ref}`,
        ),
      );
    });
    expect(offenders).toEqual([]);
  });
});
