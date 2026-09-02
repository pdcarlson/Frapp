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
 * Subscribing is untouched and must stay allowed: `chat-bridge-worker` and
 * `chat-push-worker` both open `postgres_changes` subscriptions, and the push
 * worker additionally reads Presence (the bridge worker does not). That is
 * exactly how the sanctioned design works — only *emitting* a broadcast from
 * the API is what this catches.
 *
 * Scope note, so the next reader does not overestimate this: it is a source
 * grep over `apps/api/src`, not a structural check. It scans every non-spec
 * `.ts` in the tree, so relocating code does not evade it, but an emit
 * written through an indirection — a constant holding `'broadcast'`, a
 * payload built by a helper, anything in another package — will slip past.
 * If a genuine sub-second broadcast path is ever wanted, that is #1613, and
 * it needs a client handler plus de-duplication against the Postgres Changes
 * echo, not a quiet re-add.
 *
 * The two assertions are deliberately shaped differently, because the two
 * hazards are. An **emit** is local — the `type: 'broadcast'` and the
 * `.send(` sit in one file — so that check requires both and stays quiet on
 * a listener's payload type annotation. A **topic re-key** is not local: the
 * literal and the `.channel(` call routinely live in different modules, so
 * that check matches the bare literal and uses a ledger for exceptions.
 *
 * Comments are stripped before matching. Not for this file's sake — it is a
 * `.spec.ts` and `sourceFiles` never scans it — but for the scanned files
 * that discuss the rule, `chat.service.ts` above all: its `sendMessage`
 * docstring explains the removed emit and is one placeholder edit
 * (`chapter:<id>` → `chapter:${channelId}`) away from failing the topic
 * assertion on a comment-only change.
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

  /**
   * Files that legitimately build a `chapter:<id>` string that is NOT a
   * Realtime topic — a cache key, a throttle bucket, a log tag. Empty today.
   *
   * If a change of yours lands here, that is the intended escape hatch: add
   * the path with a one-line reason. Do **not** loosen the assertion instead
   * — it matches the bare literal on purpose (see the test below).
   */
  const CHAPTER_KEYS_THAT_ARE_NOT_TOPICS: string[] = [];

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
    // Deliberately NOT conjoined with `.channel(` in the same file. The
    // hazard here is a topic re-key, and re-keys split across files: a
    // restored `realtimeTopicForChannel` helper in its own module has the
    // literal but no `.channel(`, while its caller has `.channel(` but no
    // literal, so a same-file conjunction passes both halves of the exact
    // bug it is named for. The cost of matching the bare literal is that a
    // `chapter:<id>` cache or throttle key would fail a Realtime test, so
    // the escape hatch is this ledger rather than a weaker assertion.
    const hits = sources
      .filter(({ code }) => /(`chapter:\$\{|['"]chapter:['"]\s*\+)/.test(code))
      .map(({ rel }) => rel)
      .filter((rel) => !CHAPTER_KEYS_THAT_ARE_NOT_TOPICS.includes(rel));
    expect(hits).toEqual([]);
  });
});
