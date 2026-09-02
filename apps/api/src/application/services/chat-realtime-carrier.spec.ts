import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The API emits nothing to Supabase Realtime Broadcast (#472).
 *
 * `ChatService.sendMessage` used to publish a `new_message` broadcast to a
 * bespoke `chapter:<channel_id>` topic — a leftover from the `chat-send` Edge
 * Function that ADR-11 retired. It was dead on both halves independently:
 * clients join `chat:channel:<id>` (ADR-10, `realtime-manager.ts`) and read
 * messages through Postgres Changes, and no `new_message` handler exists
 * anywhere outside `apps/api`. See the ADR-11 amendment (2026-09-02, #472).
 *
 * **Read this before citing an ADR at anyone.** No ADR forbids a message
 * broadcast. ADR-02 chose Broadcast *for* typing and presence; it does not
 * say messages may not also use it. ADR-10 rules out a bespoke topic *for
 * presence* and fixes the chat topic at `chat:channel:<id>`, because the push
 * worker reads Presence on that same topic — that part is load-bearing here.
 * So what this file pins is the **current architecture**, not a prohibition:
 * message delivery is the Postgres Changes subscription on `chat_messages`
 * (`spec/ui/resilience.md` §3.2), and the API emits no Broadcast at all.
 * Adding a real fast-path is a new design decision (#1613), needing a client
 * handler, de-duplication against the Postgres Changes echo of the same row,
 * and ADR-10's topic coupling respected. Failing this test means "you are
 * making that decision — go make it deliberately," not "you broke a rule."
 *
 * Broadcast is **not** reserved for typing repo-wide, and nothing here should
 * be read as saying so. Two other producers are legitimate and must not be
 * disturbed: `packages/chat-core/src/realtime-manager.ts` emits `typing` from
 * the client, and the **database** emits contentless change pings via
 * `realtime.send(…, 'change', …)` on `notif:<id>` / `events:<id>` /
 * `attendance:<id>` (`20260816140000_realtime_carrier_repair.sql`), consumed
 * by `apps/web/lib/realtime/use-realtime-table.ts`. That carrier was chosen
 * deliberately in #867 after a two-day silent-delivery bug; do not delete it
 * on the strength of a test that only ever looked at `apps/api/src`.
 *
 * Subscribing is untouched and must stay allowed: `chat-push-worker` and
 * `chat-bridge-worker` open `postgres_changes` subscriptions and Presence,
 * which is exactly how the sanctioned design works. Only *emitting* a
 * broadcast from the API is what this catches.
 *
 * Scope note, so the next reader does not overestimate this: it is a source
 * grep over `apps/api/src`, not a structural check. It catches the literal
 * re-introduction — including one moved into a sibling service, which a
 * file-scoped guard would have missed — but an emit written through an
 * indirection (a constant, a spread, a helper in another package) will slip
 * past. If a genuine sub-second broadcast path is ever wanted, that is #1613,
 * and it needs a client handler plus de-duplication against the Postgres
 * Changes echo, not a quiet re-add.
 *
 * Both checks require *emit context* rather than matching a bare string,
 * because a bare string produces false failures on unrelated code: this
 * codebase already writes `` `user:${id}` ``-style cache and throttle keys
 * (`custom-throttler.guard.ts`), so a future per-chapter throttle bucket
 * would otherwise fail a test about Realtime topics. Comments are stripped
 * first for the same reason — otherwise the doc block you are reading, which
 * has to spell the banned shapes out to explain them, would break the test
 * it documents.
 */
describe('API Realtime carrier', () => {
  const API_SRC = join(__dirname, '..', '..');

  /** Every non-spec `.ts` under apps/api/src, so a moved emit is still caught. */
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...sourceFiles(full));
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts')
      ) {
        out.push(full);
      }
    }
    return out;
  }

  const files = sourceFiles(API_SRC);

  /**
   * Drop block comments and whole-line `//` comments. Deliberately does not
   * touch trailing `//` — that would need real tokenizing to avoid mangling a
   * `https://` inside a string literal, and prose long enough to spell out a
   * banned shape lives in block or full-line comments anyway.
   */
  function stripComments(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');
  }

  const sources = files.map((f) => ({
    rel: f.slice(API_SRC.length + 1),
    code: stripComments(readFileSync(f, 'utf8')),
  }));

  it('is reading the real tree, not an empty one', () => {
    // Anchors the two greps below: a rename, a move, or a bad path would
    // otherwise make every `not.toMatch` pass vacuously.
    expect(files.length).toBeGreaterThan(100);
    const chatService = files.find((f) => f.endsWith('chat.service.ts'));
    expect(chatService).toBeDefined();
    expect(readFileSync(chatService as string, 'utf8')).toMatch(
      /export class ChatService/,
    );
  });

  it('emits no Realtime broadcast — delivery is Postgres Changes (#1613)', () => {
    // `.send(` is what makes this an emit. Subscribing stays allowed, so a
    // listener's `type: 'broadcast'` payload annotation must not fail here.
    const hits = sources.filter(
      ({ code }) =>
        /type:\s*(['"]broadcast['"]|REALTIME_LISTEN_TYPES\.BROADCAST)/.test(
          code,
        ) && /\.send\s*\(/.test(code),
    );
    expect(hits.map(({ rel }) => rel)).toEqual([]);
  });

  it('mints no bespoke chapter:<id> realtime topic (ADR-10 topic coupling)', () => {
    // Scoped to files that actually open a Realtime channel, so a
    // `chapter:<id>` cache or throttle key elsewhere is not a violation.
    const hits = sources.filter(
      ({ code }) =>
        /(`chapter:\$\{|['"]chapter:['"]\s*\+)/.test(code) &&
        /\.channel\s*\(/.test(code),
    );
    expect(hits.map(({ rel }) => rel)).toEqual([]);
  });
});
