/** @vitest-environment jsdom */
/*
  Exercises the real Dexie store against a real IndexedDB implementation
  (`fake-indexeddb`), not a mock of it — the same choice, for the same reason,
  that `first-chunk-cache.spec.ts` makes and explains.

  The claim under test is #2226's: that a draft or a queued message written by
  one member cannot be read, flushed, or mutated by another on the same browser.
  That claim lives entirely in the *primary keys* — `[userId+channelId]` and
  `[userId+chapterId+clientId]`. The stand-in this file used to be could not
  see a keying bug at all: it asserted the shape of the exported object and
  nothing about what the schema does, which is exactly how the cross-account
  flush survived in `main`.

  The flush tests below drive the real `flushOutbox` from `@repo/chat-core`.
  The only stub is the HTTP boundary, because whose token a row goes out under
  is the thing being observed.
*/
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { QueryClient } from "@tanstack/react-query";
import { flushOutbox } from "@repo/chat-core/chat-client";
import type { OutboxStore } from "@repo/chat-core/adapters";
import {
  CHAT_OUTBOUND_DB_NAME,
  clearDraft,
  createDexieOutboxStore,
  loadDraft,
  resetChatDBForTests,
  saveDraft,
} from "./offline-queue";
import type { ChatScope } from "./chat-scope";

/** Member A. */
const ALICE: ChatScope = {
  userId: "auth-alice",
  chapterId: "chapter-1",
};
/** Same chapter, different member — the shared-browser case #2226 is about. */
const BOB: ChatScope = { userId: "auth-bob", chapterId: "chapter-1" };
/** Same member, different chapter — the chapter-switch case. */
const ALICE_ELSEWHERE: ChatScope = {
  userId: "auth-alice",
  chapterId: "chapter-2",
};

async function wipeDatabase(): Promise<void> {
  resetChatDBForTests();
  await Dexie.delete(CHAT_OUTBOUND_DB_NAME);
}

beforeEach(wipeDatabase);
afterEach(wipeDatabase);

/** A `ChatActionContext` good enough for `flushOutbox`, recording every POST. */
function flushContext(scope: ChatScope, outbox: OutboxStore) {
  const posts: { channelId: string; clientId: string; content: string }[] = [];
  const ctx = {
    queryClient: new QueryClient(),
    apiClient: {
      POST: vi.fn(
        async (
          _path: string,
          opts: {
            params: { path: { id: string } };
            body: { client_message_id: string; content: string };
          },
        ) => {
          posts.push({
            channelId: opts.params.path.id,
            clientId: opts.body.client_message_id,
            content: opts.body.content,
          });
          return {
            data: {
              message: {
                id: `server-${opts.body.client_message_id}`,
                channel_id: opts.params.path.id,
                sender_id: scope.userId,
                content: opts.body.content,
                created_at: new Date().toISOString(),
                client_message_id: opts.body.client_message_id,
              },
            },
            error: undefined,
            response: { status: 201 },
          };
        },
      ),
    } as never,
    supabase: {} as never,
    // `flushOutbox` gates on the *app* user id; the store is keyed on the auth
    // uid. Both move together on a swap — see `offline-queue.ts`.
    userId: `user-${scope.userId}`,
    outbox,
    net: { isOffline: () => false, subscribe: () => () => {} },
  };
  return { ctx, posts };
}

describe("dexieOutboxStore", () => {
  it("is an OutboxStore imported from the adapters subpath, not the package barrel", () => {
    const store: OutboxStore = createDexieOutboxStore(ALICE);
    expect(Object.keys(store).sort()).toEqual(
      [
        "bumpAttempt",
        "clearDraft",
        "dequeue",
        "enqueue",
        // Not on the port: the single-row read the Retry / Discard controls
        // need, kept on the store so a scope is bound to a queue exactly once.
        "get",
        "listForChannel",
        "listQueued",
        "markFailed",
        "requeue",
      ].sort(),
    );
  });

  describe("the same member's own queue still works", () => {
    it("round-trips a queued row and dequeues it", async () => {
      const alice = createDexieOutboxStore(ALICE);
      await alice.enqueue({
        clientId: "c1",
        channelId: "chan-1",
        body: "hello",
      });

      expect(await alice.listQueued()).toMatchObject([
        { clientId: "c1", body: "hello", status: "queued", attempts: 0 },
      ]);
      expect(await alice.listForChannel("chan-1")).toHaveLength(1);
      expect(await createDexieOutboxStore(ALICE).get("c1")).toMatchObject({ body: "hello" });

      await alice.dequeue("c1");
      expect(await alice.listQueued()).toEqual([]);
    });

    it("orders queued rows FIFO for the in-order flush loop", async () => {
      const alice = createDexieOutboxStore(ALICE);
      await alice.enqueue({
        clientId: "second",
        channelId: "chan-1",
        body: "2",
        queuedAt: 2_000,
      });
      await alice.enqueue({
        clientId: "first",
        channelId: "chan-1",
        body: "1",
        queuedAt: 1_000,
      });

      expect((await alice.listQueued()).map((row) => row.clientId)).toEqual([
        "first",
        "second",
      ]);
    });

    it("carries a row through failure, retry and requeue", async () => {
      const alice = createDexieOutboxStore(ALICE);
      await alice.enqueue({ clientId: "c1", channelId: "chan-1", body: "hi" });

      await alice.markFailed("c1", "boom");
      expect(await createDexieOutboxStore(ALICE).get("c1")).toMatchObject({
        status: "failed",
        attempts: 1,
        lastError: "boom",
      });
      // A failed row is out of the flush loop but still on disk for Retry.
      expect(await alice.listQueued()).toEqual([]);
      expect(await alice.listForChannel("chan-1")).toHaveLength(1);

      await alice.bumpAttempt("c1", "boom again");
      expect(await createDexieOutboxStore(ALICE).get("c1")).toMatchObject({ attempts: 2 });

      await alice.requeue("c1");
      expect(await createDexieOutboxStore(ALICE).get("c1")).toMatchObject({
        status: "queued",
        lastError: undefined,
      });
      expect(await alice.listQueued()).toHaveLength(1);
    });

    it("hands back rows in the port's shape, without the scope fields", async () => {
      const alice = createDexieOutboxStore(ALICE);
      await alice.enqueue({ clientId: "c1", channelId: "chan-1", body: "hi" });

      const [row] = await alice.listQueued();
      expect(row).not.toHaveProperty("userId");
      expect(row).not.toHaveProperty("chapterId");
    });
  });

  describe("another member cannot see or send this member's queue (#2226)", () => {
    it("does not return another member's rows from listQueued", async () => {
      /*
        The assertion this whole file exists for. If `listQueued` ever answers
        with a row somebody else queued, the boot flush posts it under the
        signed-in member's token and the server attributes it to them.
      */
      await createDexieOutboxStore(ALICE).enqueue({
        clientId: "alice-1",
        channelId: "chan-1",
        body: "alice's unsent message",
      });

      expect(await createDexieOutboxStore(BOB).listQueued()).toEqual([]);
      expect(await createDexieOutboxStore(BOB).listForChannel("chan-1")).toEqual(
        [],
      );
      expect(await createDexieOutboxStore(BOB).get("alice-1")).toBeUndefined();
    });

    it("does not flush A's queued message under B's session", async () => {
      /*
        #2226 end to end, through the real `flushOutbox`: member A composes
        offline and closes the tab with the row still queued, member B signs in
        on the same browser profile, and `ChatProvider`'s boot flush runs. On
        `main` this POSTed "alice's unsent message" under B's client.
      */
      await createDexieOutboxStore(ALICE).enqueue({
        clientId: "alice-1",
        channelId: "chan-1",
        body: "alice's unsent message",
      });

      const bobStore = createDexieOutboxStore(BOB);
      const { ctx, posts } = flushContext(BOB, bobStore);
      await flushOutbox(ctx);

      expect(posts).toEqual([]);
    });

    it("keeps A's message queued for A's own next sign-in", async () => {
      /*
        The other half of the same rule, and the reason this is a re-key rather
        than a wipe: `spec/ui/resilience/principles.md` §5 is "never lose a
        message", so B's arrival must not destroy A's unsent work either.
      */
      await createDexieOutboxStore(ALICE).enqueue({
        clientId: "alice-1",
        channelId: "chan-1",
        body: "alice's unsent message",
      });

      await flushOutbox(flushContext(BOB, createDexieOutboxStore(BOB)).ctx);

      const aliceStore = createDexieOutboxStore(ALICE);
      const { ctx, posts } = flushContext(ALICE, aliceStore);
      await flushOutbox(ctx);

      expect(posts).toEqual([
        {
          channelId: "chan-1",
          clientId: "alice-1",
          content: "alice's unsent message",
        },
      ]);
    });

    it("cannot dequeue, fail or requeue another member's row", async () => {
      /*
        Keying, not filtering. A scoped `listQueued` alone would still leave the
        mutating calls addressable by a `clientId` that leaked into the wrong
        session — the compound primary key means those calls resolve to no row
        at all.
      */
      const alice = createDexieOutboxStore(ALICE);
      await alice.enqueue({
        clientId: "alice-1",
        channelId: "chan-1",
        body: "alice's unsent message",
      });

      const before = await createDexieOutboxStore(ALICE).get("alice-1");

      const bob = createDexieOutboxStore(BOB);
      await bob.dequeue("alice-1");
      await bob.markFailed("alice-1", "bob's error");
      await bob.requeue("alice-1");
      await bob.bumpAttempt("alice-1", "bob's error");

      // Byte for byte what it was: not deleted, not failed, not a spent attempt.
      expect(await createDexieOutboxStore(ALICE).get("alice-1")).toEqual(before);
      expect(before).toMatchObject({
        body: "alice's unsent message",
        status: "queued",
        attempts: 0,
      });
    });
  });

  describe("a chapter switch cannot flush the other chapter's queue", () => {
    it("hides rows queued in another chapter", async () => {
      /*
        Not tidiness. `ChatService.sendMessage` runs
        `assertChannelAccess(channel_id, chapter_id, …)` against the chapter the
        client sends in its header, so flushing a chapter-1 row while the client
        is on chapter 2 is a 4xx — the row is marked `failed` and the member is
        shown a message that would not send. Scoping the queue by chapter leaves
        it queued instead.
      */
      await createDexieOutboxStore(ALICE).enqueue({
        clientId: "alice-1",
        channelId: "chan-1",
        body: "queued in chapter 1",
      });

      const away = flushContext(
        ALICE_ELSEWHERE,
        createDexieOutboxStore(ALICE_ELSEWHERE),
      );
      await flushOutbox(away.ctx);
      expect(away.posts).toEqual([]);

      // Back in chapter 1, it goes out normally.
      const home = flushContext(ALICE, createDexieOutboxStore(ALICE));
      await flushOutbox(home.ctx);
      expect(home.posts).toMatchObject([{ clientId: "alice-1" }]);
    });
  });

  describe("drafts", () => {
    it("round-trips and clears a draft for its own member", async () => {
      await saveDraft(ALICE, "chan-1", "half-written");
      expect(await loadDraft(ALICE, "chan-1")).toBe("half-written");

      await clearDraft(ALICE, "chan-1");
      expect(await loadDraft(ALICE, "chan-1")).toBe("");
    });

    it("deletes the row when the draft is emptied rather than storing ''", async () => {
      await saveDraft(ALICE, "chan-1", "half-written");
      await saveDraft(ALICE, "chan-1", "");
      expect(await loadDraft(ALICE, "chan-1")).toBe("");
    });

    it("does not show one member's draft to another", async () => {
      await saveDraft(ALICE, "chan-1", "alice's half-written message");

      expect(await loadDraft(BOB, "chan-1")).toBe("");
    });

    it("keeps each member's draft for the same channel separate", async () => {
      await saveDraft(ALICE, "chan-1", "alice's");
      await saveDraft(BOB, "chan-1", "bob's");

      expect(await loadDraft(ALICE, "chan-1")).toBe("alice's");
      expect(await loadDraft(BOB, "chan-1")).toBe("bob's");
    });

    it("does not let one member clear another's draft", async () => {
      await saveDraft(ALICE, "chan-1", "alice's half-written message");

      await clearDraft(BOB, "chan-1");
      await createDexieOutboxStore(BOB).clearDraft("chan-1");

      expect(await loadDraft(ALICE, "chan-1")).toBe(
        "alice's half-written message",
      );
    });

    it("is not scoped by chapter, because a channel id already implies one", async () => {
      await saveDraft(ALICE, "chan-1", "written in chapter 1");

      // Same member, chapter-2 scope: the draft scope is the member alone, so
      // the row is theirs to read wherever they are.
      expect(await loadDraft(ALICE_ELSEWHERE, "chan-1")).toBe(
        "written in chapter 1",
      );
    });
  });

  describe("an unscoped v1 database migrates by dropping its rows", () => {
    it("drops legacy drafts and queued messages instead of assigning them an owner", async () => {
      /*
        A v1 row records no member, so there is nobody to migrate it to —
        handing it to whoever opens the database next would be the cross-account
        bug of #2226 performed by the migration instead of by the flush. The
        loss is real and is stated in `offline-queue.ts` and in
        `spec/ui/resilience/caching.md`; this is the test that says it happens
        on purpose rather than by accident.
      */
      const legacy = new Dexie(CHAT_OUTBOUND_DB_NAME);
      legacy.version(1).stores({
        drafts: "channelId, updatedAt",
        outbox: "clientId, channelId, queuedAt, status",
      });
      await legacy.open();
      await legacy
        .table("drafts")
        .put({ channelId: "chan-1", body: "legacy draft", updatedAt: 1 });
      await legacy.table("outbox").put({
        clientId: "legacy-1",
        channelId: "chan-1",
        body: "legacy queued message",
        attempts: 0,
        queuedAt: 1,
        status: "queued",
      });
      legacy.close();

      // The app opens the same database at its current version.
      expect(await createDexieOutboxStore(ALICE).listQueued()).toEqual([]);
      expect(await createDexieOutboxStore(BOB).listQueued()).toEqual([]);
      expect(await loadDraft(ALICE, "chan-1")).toBe("");
    });

    it("opens and writes on a browser that never held a v1 database", async () => {
      const alice = createDexieOutboxStore(ALICE);
      await alice.enqueue({ clientId: "c1", channelId: "chan-1", body: "hi" });
      await saveDraft(ALICE, "chan-1", "half-written");

      expect(await alice.listQueued()).toHaveLength(1);
      expect(await loadDraft(ALICE, "chan-1")).toBe("half-written");
    });
  });

  describe("with no scope to key rows under", () => {
    it("fails an enqueue instead of reporting a message it did not keep", async () => {
      /*
        The regression an earlier revision of #2226 shipped and this pins shut.
        Returning the row while writing nothing tells `sendMessage` the message
        is durably queued: offline, it then returns without POSTing, the
        optimistic card paints as pending, `listQueued` never sees the row, and
        a reload loses it with no error and no Retry. `adapters.ts` says this
        port exists to make exactly that impossible, so refusing loudly is the
        only honest answer — `sendMessage` removes the optimistic card on a
        throwing enqueue (#1718) rather than leaving a phantom.
      */
      const unscoped = createDexieOutboxStore(null);

      await expect(
        unscoped.enqueue({
          clientId: "c1",
          channelId: "chan-1",
          body: "typed with no chapter selected",
        }),
      ).rejects.toThrow(/no scope/i);

      expect(await createDexieOutboxStore(ALICE).listQueued()).toEqual([]);
    });

    it("reads back nothing and no-ops every other call", async () => {
      const unscoped = createDexieOutboxStore(null);

      expect(await unscoped.listQueued()).toEqual([]);
      expect(await unscoped.listForChannel("chan-1")).toEqual([]);
      expect(await unscoped.get("c1")).toBeUndefined();
      await expect(unscoped.dequeue("c1")).resolves.toBeUndefined();
      await expect(unscoped.clearDraft("chan-1")).resolves.toBeUndefined();
    });

    it("cannot reach another member's rows", async () => {
      await createDexieOutboxStore(ALICE).enqueue({
        clientId: "alice-1",
        channelId: "chan-1",
        body: "alice's unsent message",
      });

      const unscoped = createDexieOutboxStore(null);
      expect(await unscoped.listQueued()).toEqual([]);
      expect(await unscoped.get("alice-1")).toBeUndefined();
      await unscoped.dequeue("alice-1");

      expect(await createDexieOutboxStore(ALICE).get("alice-1")).toMatchObject({
        body: "alice's unsent message",
      });
    });
  });
});
