import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Static guard for the PGRST201 class of bug (#4087, and #746 before it).
 *
 * PostgREST refuses an embed named by table alone when more than one
 * relationship links the two tables. #4042 created exactly that between
 * `chat_messages` and `chat_channels` (`chat_messages.channel_id` and
 * `chat_channels.background_message_id`) and between `chapters` and
 * `chat_messages` (`chapters.chat_background_message_id`, plus the path through
 * `chat_channels`). The repository specs run against a fake client that ignores
 * the select projection, so a bare embed passed CI and failed on every call in
 * production. Each pair below must name its FK (`!<constraint>_fkey`).
 *
 * This reads source text, so it sees only a select written inline after
 * `.from('<table>')` in the same statement; a projection built from a constant
 * elsewhere slips past it. `test/integration/chat-message-channel-embed.integration-spec.ts`
 * runs the real queries against a local stack.
 */
const AMBIGUOUS_PAIRS: ReadonlyArray<readonly [from: string, embed: string]> = [
  ['chat_messages', 'chat_channels'],
  ['chat_channels', 'chat_messages'],
  ['chapters', 'chat_messages'],
  ['chat_messages', 'chapters'],
];

const SRC_ROOT = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Every bare embed of `embed` inside a statement that starts at `.from('<from>')`. */
function findBareEmbeds(source: string, from: string, embed: string): string[] {
  const found: string[] = [];
  const fromCall = new RegExp(`\\.from\\(\\s*['"\`]${from}['"\`]\\s*\\)`, 'g');
  // `embed`, then any `!modifier` segments, then the opening paren of its
  // column list. A filter path (`chat_channels.chapter_id`) has no paren.
  const embedRef = new RegExp(`\\b${embed}((?:!\\w+)*)\\s*\\(`, 'g');
  for (const match of source.matchAll(fromCall)) {
    const start = match.index + match[0].length;
    const end = source.indexOf(';', start);
    const statement = source.slice(start, end === -1 ? undefined : end);
    for (const ref of statement.matchAll(embedRef)) {
      const hints = ref[1].split('!').filter(Boolean);
      if (!hints.some((hint) => hint.endsWith('_fkey'))) found.push(ref[0]);
    }
  }
  return found;
}

describe('embeds between tables with more than one relationship', () => {
  it('flags a bare embed and accepts a hinted one', () => {
    const bare = `this.supabase.from('chat_messages').select('id, chat_channels!inner(chapter_id)').eq('chat_channels.chapter_id', x);`;
    const hinted = `this.supabase.from('chat_messages').select('id, chat_channels!chat_messages_channel_id_fkey!inner(chapter_id)').eq('chat_channels.chapter_id', x);`;
    const plain = `this.supabase.from('chat_messages').select(\`*, chat_channels(chapter_id)\`);`;
    expect(findBareEmbeds(bare, 'chat_messages', 'chat_channels')).toEqual([
      'chat_channels!inner(',
    ]);
    expect(findBareEmbeds(hinted, 'chat_messages', 'chat_channels')).toEqual(
      [],
    );
    expect(findBareEmbeds(plain, 'chat_messages', 'chat_channels')).toEqual([
      'chat_channels(',
    ]);
  });

  it('no API source embeds one by table name alone', () => {
    const offenders = sourceFiles(SRC_ROOT).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return AMBIGUOUS_PAIRS.flatMap(([from, embed]) =>
        findBareEmbeds(source, from, embed).map(
          (ref) => `${relative(SRC_ROOT, file)}: from ${from}, ${ref}`,
        ),
      );
    });
    expect(offenders).toEqual([]);
  });
});
