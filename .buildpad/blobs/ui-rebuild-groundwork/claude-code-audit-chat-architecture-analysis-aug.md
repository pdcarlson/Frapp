Let me dig into the chat architecture, its history, and the realtime layer.

Let me verify the "portable" claim by checking actual imports, not just API usage.

I have what I need. Writing the analysis.

Saved to `/tmp/claude-0/-home-user-Frapp/47f3e4ca-3695-55d1-a119-7f556a321d18/scratchpad/chat-architecture-analysis.md`. Inline:

# Why chat bypasses packages/hooks — and what mobile chat costs

## Short answer

**Architectural, with a clean vestigial residue.** The split isn't accidental — but `use-chat.ts` isn't uniformly dead either. It divides *exactly* along the hot/cold path boundary the architecture spec defines (`spec/architecture/README.md:424-431`), and every hook on the cold side is live while every hook on the hot side is orphaned.

For mobile: **extract `apps/web/lib/chat/` into a shared package.** Don't wire mobile onto `use-chat.ts` — those hooks write to a different table and a different cache namespace than the web timeline reads. The extraction is far cheaper than it looks: the dependency injection is already done.

## (1) Architectural necessity vs historical duplication

### The dividing line is exact

| `use-chat.ts` export | Path | Consumer | Live? |
|---|---|---|---|
| `useChannels:6` | Cold — channel metadata | `chat-shell.tsx:91` | **Yes** |
| `useCategories:87` | Cold — category metadata | `chat-shell.tsx:92` | **Yes** |
| `useRequestChatUploadUrl:365` | Stateless request/response | `composer.tsx:231` | **Yes** |
| `useUploadSignedUrl:391` | Stateless request/response | `composer.tsx:239` | **Yes** |
| `useChannel:19`, `useMessages:35`, `usePinnedMessages:54`, `useReactions:70` | Hot — message content | — | No |
| 15 mutations (`:100`–`:458`, excl. the upload pair) | Hot — message/action state | — | No |

The four live hooks are precisely the four with **no optimistic or realtime semantics**: two read slow-changing metadata, two are fire-and-forget upload plumbing. `useMutation` is genuinely right for those, and they're still used. Everything touching the message timeline is orphaned. That isn't the shape of accidental duplication — it's a boundary drawn correctly and then only half cleaned up.

### Four reasons `useMutation` + `invalidateQueries` can't model the timeline

**a. The cache is authoritative, not a fetch cache.** `use-chat-channel.ts:105` sets `staleTime: Infinity` on `chatMessagesKey(channelId)`. The cache is a merge target that realtime events, optimistic writes, and backfill all converge into — never a snapshot to re-fetch. `invalidateQueries` is the wrong verb by construction: it would refetch 50 rows and discard every pending and failed optimistic row.

**b. Key namespaces don't even overlap.** The live cache is `["chat", channelId, "messages"]` (`types.ts:14-16`). Every `use-chat.ts` mutation invalidates `["channels"]` or `["channels", channelId, "messages"]` (`use-chat.ts:117,147,238,299`). Nothing reads the latter for message content — its paired reader `useMessages:35` has zero consumers. Calling `useSendMessage` today would POST successfully and then invalidate a key no component subscribes to. The write path and read path in that file are internally consistent and jointly disconnected from the app.

**c. Message lifecycle is per-entity and outlives the call.** `MessageStatus = "pending" | "confirmed" | "failed"` (`types.ts:35`) lives on the row inside the normalized `{byId, order}` cache (`types.ts:127-129`). `useMutation`'s `isPending` is per-hook-instance — one `useSendMessage()` can't express five messages independently in flight. Worse, the outbox is durable: `hydrateOutboxIntoCache` (`chat-client.ts:377-403`) restores queued and failed sends into the cache *after a cold reload*, when no mutation object exists to have produced them (ADR-05, `spec/architecture/README.md:501`).

**d. Most state changes have no mutation at all.** Other members' messages arrive through Postgres Changes (`realtime-manager.ts:415,546,559`), typing through Broadcast (`:445`), presence through Presence (`:468`). There's no local call to hang `onSuccess` off. A `useMutation`-shaped client would need `invalidateQueries` on every inbound realtime event — a refetch storm on the app's highest-volume path, against a <100ms p50 budget (`spec/architecture/README.md:428`).

### The genuinely vestigial part

`useToggleReaction:322` posts to `POST /v1/channels/messages/{messageId}/reactions` (`chat.controller.ts:351`) → `ChatService.toggleReaction:717` → the **legacy `message_reactions` table**. The live path posts to `POST .../actions` (`chat.controller.ts:332`) → `recordMessageAction:759` → **`chat_message_actions`**. The service comment says so directly (`chat.service.ts:747-748`).

`chat_message_actions` arrived with Chunk 02 and carries the ADR-07 vote-change upsert (`spec/architecture/README.md:517-519`). So `use-chat.ts`'s hot-path half predates the current chat data model. It wasn't bypassed — it was superseded and never removed.

**One doc-vs-code divergence:** ADR-03 states *"TanStack Query `onMutate`/`onError` handles this"* (`spec/architecture/README.md:479`). No shipped chat code uses `onMutate`; the transition runs through `upsertOptimistic`/`mergeServerRow`/`markFailed` (`cache.ts:50,65,100`). Worth a one-line correction when someone next touches that section.

## (2) What real mobile chat costs

**Current state:** `apps/mobile/app/(tabs)/chat.tsx` and `chat-thread.tsx` are static mockups — hardcoded `TaskLoopCard` and `MessageBubble` components with literal strings. No data layer, no API call, no realtime subscription.

Mobile already has the runtime prerequisites: `@supabase/supabase-js` (Realtime works on RN), `@tanstack/react-query`, `@react-native-async-storage/async-storage`, and a working Supabase client with a chunked SecureStore session adapter (`apps/mobile/lib/supabase.ts:131-140`).

### Porting cost, file by file

The critical finding: **the dependency injection is already done.** `chat-client.ts` takes `ChatActionContext` as the first argument of every exported function (`:66-83`); `realtime-manager.ts` takes `ManagerContext` via `configure()` (`:105-117,153`). Neither interface contains a single web-specific type — `ToastFn` is a local interface (`:57-62`), not a DOM import.

| File | Lines | Web-only imports | Platform seams | Effort |
|---|---|---|---|---|
| `types.ts` | 195 | **none — zero imports** | none | Move as-is |
| `cache.ts` | 286 | only `./types` | none | Move as-is |
| `dispatch.ts` | 393 | `@repo/chat-integrations` (already shared) | none | Move as-is |
| `chat-client.ts` | 554 | `./offline-queue` only; rest type-only | 2 × `navigator.onLine` (`:219,366`), already `typeof`-guarded | Inject network seam |
| `realtime-manager.ts` | 753 | none | 4 × `localStorage` (`:85,94,95`, already try/caught), 4 × `window` listeners (`:158-167`) | Inject storage + network seams |
| `use-chat-channel.ts` | 349 | 3 × `@/` aliases (`:14,15,16`) — exactly the DI points | none beyond those | Parameterize 3 imports |
| `chat-provider.tsx` | 80 | 2 × `window` listeners (`:70,74`) | AppState + NetInfo | Thin wrapper |
| `offline-queue.ts` | 185 | **Dexie / IndexedDB** (`:22,51`) | — | **Rewrite** |

**Totals:** 2,795 lines of non-test chat logic. ~1,223 move untouched, ~1,387 need three small injected seams, **185 lines genuinely need rewriting.**

ADR-05 anticipated exactly this one rewrite: *"Dexie is web-only; the Expo mobile client uses AsyncStorage/SQLite for the analogue (Chunk 11)"* (`spec/architecture/README.md:507`). ADR-11 plans the rest: *"Mobile mirrors in Chunk 11; web shipped with #416"* (`:571`).

**What doesn't port:** `apps/web/components/chat/**` is 3,319 lines of React DOM — composer (Tiptap), channel list, message list, 10 card renderers. Mobile needs its own view layer regardless of path, so this cost doesn't discriminate between the options.

### The `use-chat.ts` option, priced honestly

Not "free because they're already written." It requires: rewriting `useToggleReaction` to target `chat_message_actions` (or accepting mobile reactions land in a table web never reads); building an RN optimistic layer from scratch (the hooks have no `onMutate`, so mobile ships strictly worse than web); building an RN realtime layer from scratch (`use-chat.ts` has no realtime concept); building an RN offline outbox from scratch; then reconciling all three against `invalidateQueries`-based hooks that fight them.

That's re-deriving `realtime-manager.ts` and `chat-client.ts` on a foundation that actively resists them — and ending with **two divergent implementations to keep in parity forever.**

## (3) Recommendation

**Extract `apps/web/lib/chat/` into `packages/chat-core` with three injected platform adapters. Delete the orphaned hot-path half of `use-chat.ts`.**

The deciding argument is in the spec, not the code. `spec/behavior/chat/README.md:176` defines the hot-path guarantees as applying to *"the chat client (web and mobile), independent of the underlying implementation,"* and `:188-190` mandates parity: *"reactions, inline rich-message cards, presence, and the offline composer queue all behave the same across platforms."* Those guarantees — idempotent optimistic sends reconciling to exactly one message, ordered offline flush, backfill-before-resubscribe (`:178-181`) — are the hardest things in the codebase to get right twice. One implementation makes parity structural instead of aspirational.

Three further points favor extraction:

- **The repo already does this.** `packages/chat-integrations` (`parsers.ts`, `payloads.ts`) is the platform-neutral chat package pattern, already consumed by `dispatch.ts:22`. `packages/hooks` declares only `@repo/api-sdk`, `@tanstack/react-query`, `react` — no web deps. The monorepo is set up for this move.
- **The seams already exist.** Extraction is mostly moving files and replacing three imports with three constructor parameters — not a redesign.
- **It resolves the vestigial code as a side effect.** Once `chat-core` is the shared surface, the orphaned hooks have no possible future consumer.

### Migration shape

1. **`packages/chat-core`** — move `types.ts`, `cache.ts`, `chat-client.ts`, `realtime-manager.ts`, `dispatch.ts` unchanged. No React DOM, matching the `packages/hooks` dependency profile.
2. **Three adapter interfaces** — `KeyValueStore` (replaces `localStorage` at `realtime-manager.ts:85,94,95`), `NetworkState` (replaces `navigator.onLine` at `chat-client.ts:219,366` and `realtime-manager.ts:158-167`), `OutboxStore` (the `offline-queue.ts` contract).
3. **`useChatChannel` moves too**, taking its three `@/` imports as parameters.
4. **Web switches to the package.** Zero behavior change; `realtime-manager.test.ts` (529 lines) and `parsers.test.ts` (335) move with it and become the shared regression suite — that coverage is what makes this safe.
5. **Mobile implements the three adapters** and builds its RN view layer against the same `UseChatChannelResult` interface (`use-chat-channel.ts:46-75`).
6. **Delete** `useChannel`, `useMessages`, `usePinnedMessages`, `useReactions`, and the 15 orphaned mutations. Keep `useChannels`, `useCategories`, and the upload pair.
7. **Correct ADR-03** (`spec/architecture/README.md:479`) and record `chat-core` as Chunk 11's shared home in ADR-05.

Steps 1–4 are a pure refactor with existing test coverage and no user-visible change — worth doing on their own merits even if mobile chat slips. Step 6 is independent and can land first as a small cleanup.

### Risks worth pricing in

- **Realtime under app backgrounding.** `spec/behavior/chat/README.md:193` requires backgrounded → `idle`, force-quit → `offline`. The manager derives connection state from browser online/offline events (`realtime-manager.ts:158-167`); mobile needs AppState-driven transitions. New behavior, not a port.
- **The polling degrade path** (`POLL_DEGRADE_AFTER_MS:77`, `POLL_INTERVAL_MS:80`) matters far more on cellular than desktop wifi. Verify under real network loss.
- **Voice memos** (`kind="audio"`) are mobile-only and not in `CHAT_MESSAGE_KINDS` yet (`spec/behavior/chat/README.md:150`) — out of scope, needs a schema change.
- **Cross-service contracts.** The `chat:channel:<id>` topic name and presence payload shape are read by the push worker (`realtime-manager.ts:42`). The extraction must not change either.