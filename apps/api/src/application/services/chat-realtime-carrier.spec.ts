import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The API emits nothing to Supabase Realtime Broadcast (#472).
 *
 * `ChatService.sendMessage` used to publish a `new_message` broadcast to a
 * bespoke `chapter:<channel_id>` topic — a leftover from the `chat-send` Edge
 * Function that ADR-11 retired. It was dead on both halves independently:
 * clients join `chat:channel:<id>` (ADR-10, `realtime-manager.ts`) and read
 * messages through Postgres Changes, and no client has ever registered a
 * `new_message` handler. See the ADR-11 amendment (2026-09-02, #472).
 *
 * Two separate rules are pinned here, and they come from different ADRs —
 * cite the right one when this test fails:
 *
 * - **ADR-02** ("Why Supabase Realtime Broadcast for presence/typing") scopes
 *   Broadcast to presence and typing. Message delivery is Postgres Changes
 *   (`spec/ui/resilience.md` §3.2). The one legitimate broadcast producer in
 *   the repo is the *client*, `packages/chat-core/src/realtime-manager.ts`,
 *   which emits `typing` — not the API.
 * - **ADR-10** ("no custom broadcast topic") fixes the topic string at
 *   `chat:channel:<id>`, because the push worker reads Presence on that same
 *   topic. A `chapter:<id>` realtime topic is the shape it rules out.
 *
 * Subscribing is untouched and must stay allowed: `chat-push-worker` and
 * `chat-bridge-worker` open `postgres_changes` subscriptions and Presence,
 * which is exactly how the sanctioned design works. Only *emitting* a
 * broadcast is banned.
 *
 * Scope note, so the next reader does not overestimate this: it is a source
 * grep over `apps/api/src`, not a structural check. It catches the literal
 * re-introduction — including one moved into a sibling service, which a
 * file-scoped guard would have missed — but an emit written through an
 * indirection (a constant, a spread, a helper in another package) will slip
 * past. If a genuine sub-second broadcast path is ever wanted, that is #1613,
 * and it needs a client handler plus de-duplication against the Postgres
 * Changes echo, not a quiet re-add.
 */
describe('API Realtime carrier (ADR-02, ADR-10)', () => {
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

  it('emits no Realtime broadcast (ADR-02 — Broadcast is presence/typing)', () => {
    const hits = files.filter((f) =>
      /type:\s*(['"]broadcast['"]|REALTIME_LISTEN_TYPES\.BROADCAST)/.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(hits.map((f) => f.slice(API_SRC.length + 1))).toEqual([]);
  });

  it('mints no bespoke chapter:<id> realtime topic (ADR-10)', () => {
    const hits = files.filter((f) =>
      /(`chapter:\$\{|['"]chapter:['"]\s*\+)/.test(readFileSync(f, 'utf8')),
    );
    expect(hits.map((f) => f.slice(API_SRC.length + 1))).toEqual([]);
  });
});
