import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A question asked from a chat composer is answered to the asker alone
 * (#4713, `spec/behavior/ai.md` § Asking from a channel): nothing is written
 * to the channel. That holds for every door because the Ask route has no way
 * to post: nothing it runs can reach the code that writes a chat message.
 *
 * This reads the sources rather than running a question, so it also fails
 * the day someone wires a chat write into Ask for a different reason.
 */
const ASK_DIR = __dirname;

/** The modules that can create, edit or delete a chat message. */
const CHAT_WRITERS = [
  /\/chat\.service'/,
  /\/chat-thread\.service'/,
  /\/chat-form\.service'/,
  /\/chat-reaction\.service'/,
  /chat\.repository\.interface'/,
  /chat-thread\.repository\.interface'/,
  /\/system-message/,
];

describe('Ask never posts to a channel (#4713)', () => {
  const sources = readdirSync(ASK_DIR).filter(
    (name) => name.endsWith('.ts') && !name.includes('.spec.'),
  );

  it('has sources to read', () => {
    expect(sources).toContain('ask.service.ts');
    expect(sources).toContain('ask-conversation.service.ts');
  });

  it.each(sources)('%s imports nothing that writes a chat message', (name) => {
    const imports = readFileSync(join(ASK_DIR, name), 'utf8')
      .split('\n')
      .filter((line) => /\bfrom '/.test(line) || /^import '/.test(line));
    for (const writer of CHAT_WRITERS) {
      expect(imports.filter((line) => writer.test(line))).toEqual([]);
    }
  });
});
