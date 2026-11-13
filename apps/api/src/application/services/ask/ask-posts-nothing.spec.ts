import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A question asked from a chat composer is answered to the asker alone
 * (#4713, `spec/behavior/ai.md` § Asking from a channel): nothing is written
 * to the channel and nobody is notified. That holds for every door because
 * asking has no way to post: nothing it runs can reach the code that writes
 * a chat message or a notification.
 *
 * What asking runs is the route (`ask.controller.ts`), the answer lane (this
 * folder) and the request lane (`../act`), which only ever proposes a card.
 * Confirming a card is a different request, through the ordinary services.
 *
 * This reads the sources rather than running a question, so it also fails
 * the day someone wires a chat write into Ask for a different reason.
 */
const SERVICES = join(__dirname, '..');
const CONTROLLERS = join(
  __dirname,
  '..',
  '..',
  '..',
  'interface',
  'controllers',
);

/** The modules that can create, edit or delete a chat message, or notify. */
const WRITERS = [
  /\/chat\.service'/,
  /\/chat-thread\.service'/,
  /\/chat-form\.service'/,
  /\/chat-reaction\.service'/,
  /chat\.repository\.interface'/,
  /chat-thread\.repository\.interface'/,
  /chat-push-dispatch\.repository\.interface'/,
  /\/system-message/,
  /\/notification\.service'/,
  /notification\.repository\.interface'/,
];

function sourcesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.includes('.spec.'))
    .map((name) => join(dir, name));
}

describe('Asking never posts to a channel or notifies (#4713)', () => {
  const sources = [
    ...sourcesIn(join(SERVICES, 'ask')),
    ...sourcesIn(join(SERVICES, 'act')),
    join(CONTROLLERS, 'ask.controller.ts'),
  ];
  const named = sources.map((path) => path.slice(path.lastIndexOf('/') + 1));

  it('has sources to read', () => {
    expect(named).toContain('ask.service.ts');
    expect(named).toContain('ask-conversation.service.ts');
    expect(named).toContain('act.service.ts');
    expect(named).toContain('ask.controller.ts');
  });

  it.each(sources.map((path, index) => [named[index], path]))(
    '%s imports nothing that writes a chat message or a notification',
    (_name, path) => {
      const imports = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => /\bfrom '/.test(line) || /^import '/.test(line));
      for (const writer of WRITERS) {
        expect(imports.filter((line) => writer.test(line))).toEqual([]);
      }
    },
  );
});
