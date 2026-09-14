import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "@/lib/chunk-load-error";

/**
 * The classifier decides which remedy a member is offered, and only one of them
 * clears a stale chunk (`chunk-load-error.ts`). So the cases below are not a
 * shape check — each one is a real error a bundler or a browser actually
 * produces.
 */
describe("isChunkLoadError", () => {
  it("matches the error Turbopack throws, by name", () => {
    // Built exactly as the runtime does it: a plain Error whose `name` is
    // reassigned after construction. Verified against this repo's own output
    // in `.next/static/chunks/turbopack-*.js`, not only against the docs.
    const error = new Error(
      "Failed to load chunk static/chunks/emoji-picker-panel-a1b2c3.js from module 4821",
    );
    error.name = "ChunkLoadError";

    expect(isChunkLoadError(error)).toBe(true);
  });

  it("matches webpack's wording too", () => {
    // The pre-Turbopack spelling. Kept because `next dev` and any future
    // config change can still produce it, and because the name is the same.
    const error = new Error("Loading chunk 42 failed.");
    error.name = "ChunkLoadError";

    expect(isChunkLoadError(error)).toBe(true);
  });

  it("matches a native ESM rejection, which carries no name to match", () => {
    // What the browser itself throws for an `import()` that 404s. A TypeError,
    // so `name` is useless here and only the message identifies it.
    expect(
      isChunkLoadError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://app.example/_next/static/chunks/x.js",
        ),
      ),
    ).toBe(true);

    // Safari's wording for the same condition.
    expect(
      isChunkLoadError(new TypeError("Importing a module script failed.")),
    ).toBe(true);
  });

  it("finds the signal when a wrapper has buried it in `cause`", () => {
    const cause = new Error("Failed to load chunk static/chunks/x.js");
    cause.name = "ChunkLoadError";

    expect(isChunkLoadError(new Error("Render failed", { cause }))).toBe(true);
  });

  it("does not classify an ordinary render error as one", () => {
    // The case that matters most: a logic bug must keep the Retry that can
    // actually clear it, rather than being told to reload.
    expect(
      isChunkLoadError(
        new TypeError("Cannot read properties of undefined (reading 'map')"),
      ),
    ).toBe(false);
    expect(isChunkLoadError(new Error("Unauthorized"))).toBe(false);
  });

  it("survives the values a boundary can actually be handed", () => {
    // `catchError`'s own source notes the thrown value is not guaranteed to be
    // an Error, so the classifier is reachable with anything at all.
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("ChunkLoadError")).toBe(false);
    expect(isChunkLoadError({})).toBe(false);
  });

  it("terminates on a cause chain that points at itself", () => {
    const looping = new Error("boom") as Error & { cause?: unknown };
    looping.cause = looping;

    expect(isChunkLoadError(looping)).toBe(false);
  });
});
