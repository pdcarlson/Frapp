/**
 * UUID v4 generation for the chat hot path, on every runtime chat-core ships to.
 *
 * `client_message_id` is the server's idempotency key
 * (`SendMessageDto.client_message_id`, validated `@IsUUID()` and backed by the
 * partial unique index on `(channel_id, sender_id, client_message_id)`), so
 * every send, slash-command dispatch, and outbox retry needs one before it can
 * talk to the API.
 *
 * This existed as a bare `crypto.randomUUID()` call, which is a browser-only
 * assumption. **React Native supplies no `crypto` global.** What was actually
 * checked for #937 C1, and what was not:
 *
 * - *Checked:* no JS-level polyfill exists anywhere in the graph this app
 *   bundles. Expo's WinterCG runtime (`node_modules/expo/src/winter/runtime.native.ts`)
 *   installs `TextDecoder`, `URL`, `DOMException`, `structuredClone`, and
 *   `fetch` — and no `crypto`. `react-native@0.86` installs none either, and
 *   neither `expo-crypto` nor `react-native-get-random-values` is a dependency.
 * - *Not checked:* that Hermes itself exposes no `crypto`. That is a documented
 *   property of the engine, not something this repo has executed — no code has
 *   ever been run on a device or simulator here (#938 is the `[human]` blocker).
 *
 * Note that grepping an exported bundle is **not** a way to re-check any of
 * this. A global is installed by the native VM, not by the JS bundle, so its
 * absence from the bundle proves nothing about the runtime — and this module
 * itself now puts all three names in the string table.
 *
 * The consequence either way is the same: the first tap of Send on mobile threw
 * `undefined is not an object`.
 *
 * Preference order, strongest first:
 *
 * 1. `crypto.randomUUID()` — browsers and Node ≥19. Web keeps exactly the
 *    behavior it had before this module existed.
 * 2. `crypto.getRandomValues()` — a CSPRNG without the v4 convenience wrapper.
 *    This is the tier a React Native app lands in once it adds `expo-crypto` or
 *    `react-native-get-random-values`; adding either is a `package.json` change,
 *    which is a frozen hotspot file (an integrator PR, not a screen slice), so
 *    this module is written to pick it up automatically if that ever lands.
 * 3. `Math.random()` — where neither global exists, which is React Native today.
 *
 * **Tier 3 is not cryptographically secure, and that is sound here** because a
 * `client_message_id` is not a secret or a capability. Nothing in this repo
 * derives auth, ordering, or addressing from it. A value from this module MUST
 * NOT be used for a token, nonce, or any other security-bearing identifier.
 *
 * What a collision costs depends on which index the id lands in, and the two
 * are scoped differently — so this is stated per consumer rather than once:
 *
 * - `chat_messages` (`idx_chat_messages_dedupe`) is scoped by `channel_id`
 *   *and* `sender_id`, so the blast radius is one sender's own channel: the
 *   worst case is one of two colliding sends deduplicating against the other.
 * - `point_transactions` (`idx_point_transactions_dedupe`, #1719) is scoped by
 *   `chapter_id` alone — the ledger carries neither a channel nor a sender
 *   column. A collision therefore reaches across officers within one chapter.
 *   It is contained not by the index but by `PointsService.resolveReplay`,
 *   which returns the stored row **only** when the target, amount, category,
 *   reason and acting admin all match the incoming request, and answers 409
 *   otherwise. So a collided or guessed id cannot suppress a grant or hand a
 *   caller another member's transaction; it can only refuse, loudly, and the
 *   next dispatch mints a fresh id.
 */

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
};

/** Read lazily, never cached: a polyfill may install after this module loads. */
function getCrypto(): CryptoLike | undefined {
  return (globalThis as { crypto?: CryptoLike }).crypto;
}

/**
 * Stamps the RFC 4122 version and variant bits onto 16 random bytes and formats
 * them as a canonical UUID string. Shared by tiers 2 and 3 so the two paths
 * cannot drift into producing differently-shaped ids.
 */
function formatUuidV4(bytes: Uint8Array): string {
  // Version 4 in the high nibble of byte 6; variant 10xx in the top bits of 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string[] = [];
  for (const byte of bytes) {
    hex.push(byte.toString(16).padStart(2, "0"));
  }
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/**
 * A UUID v4 suitable for `client_message_id`.
 *
 * Callers that already hold an id — an outbox flush or an idempotent retry —
 * MUST reuse it rather than calling this again, or the retry stops deduplicating
 * against its own earlier attempt.
 */
export function randomClientId(): string {
  const cryptoObj = getCrypto();

  if (typeof cryptoObj?.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (typeof cryptoObj?.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
    return formatUuidV4(bytes);
  }

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return formatUuidV4(bytes);
}
