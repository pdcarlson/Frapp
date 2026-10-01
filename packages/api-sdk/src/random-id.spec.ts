import { afterEach, describe, expect, it, vi } from "vitest";

import { randomClientId } from "./random-id";

/**
 * The point of these tests is the *absence* case.
 *
 * Vitest runs on Node, where `crypto.randomUUID` exists, and the mobile suite
 * additionally aliases `react-native` to `react-native-web` — so the runtime
 * that actually broke here (Hermes, no `crypto` global at all) is the one
 * neither suite ever exercises. Stubbing the global is the only way to pin it
 * from a test, so tier 2 and tier 3 are asserted explicitly rather than left to
 * whichever globals the host happens to provide.
 */

/** RFC 4122 canonical form, with the version nibble and variant bits pinned. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("randomClientId", () => {
  it("prefers crypto.randomUUID when the runtime has it", () => {
    const randomUUID = vi
      .fn()
      .mockReturnValue("11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID });

    expect(randomClientId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    // The tier a React Native app reaches once `expo-crypto` or
    // `react-native-get-random-values` is installed — a CSPRNG with no v4
    // convenience wrapper.
    const getRandomValues = vi.fn(<T extends ArrayBufferView>(array: T): T => {
      const bytes = new Uint8Array(
        array.buffer,
        array.byteOffset,
        array.byteLength,
      );
      bytes.fill(0xff);
      return array;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const id = randomClientId();

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(id).toMatch(UUID_V4);
    // All-0xFF input proves the version/variant bits are stamped rather than
    // passed through: byte 6 becomes 0x4f and byte 8 becomes 0xbf.
    expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("still returns a valid v4 uuid with no crypto global at all", () => {
    // React Native today: Hermes implements no WebCrypto, react-native ships no
    // polyfill, and Expo's WinterCG runtime installs no `crypto`.
    vi.stubGlobal("crypto", undefined);

    expect(randomClientId()).toMatch(UUID_V4);
  });

  it("does not throw when `crypto` exists but is empty", () => {
    vi.stubGlobal("crypto", {});

    expect(randomClientId()).toMatch(UUID_V4);
  });

  it("produces distinct ids on the no-crypto path", () => {
    // `client_message_id` is the server's idempotency key, so two sends
    // colliding would silently deduplicate one of them away.
    vi.stubGlobal("crypto", undefined);

    const ids = new Set(Array.from({ length: 1000 }, () => randomClientId()));

    expect(ids.size).toBe(1000);
  });
});
