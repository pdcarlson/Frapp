import { describe, expect, it, vi } from "vitest";
import {
  createQueryErrorReporter,
  DEFAULT_REPORT_INTERVAL_MS,
  MAX_REMEMBERED_RATE_KEYS,
  QUERY_KEY_PLACEHOLDER,
  type QueryErrorReport,
  type QueryErrorReporterOptions,
} from "./query-errors";
import { createSentryScrubber, NO_PSEUDONYMS } from "./sentry-scrubbing";

const CHAPTER_ID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const REQUEST_ID = "req_8d7c6b5a-4f3e-4d2c-8b1a-0f9e8d7c6b5a";

function harness(overrides: Partial<QueryErrorReporterOptions> = {}) {
  const reports: QueryErrorReport[] = [];
  let online = true;
  let clock = 1_000_000;
  const reporter = createQueryErrorReporter({
    capture: (report) => reports.push(report),
    isOnline: () => online,
    isCancelled: (error) =>
      typeof error === "object" && error !== null && "cancelled" in error,
    now: () => clock,
    ...overrides,
  });
  return {
    reporter,
    reports,
    setOnline: (value: boolean) => {
      online = value;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    query: (
      error: unknown,
      queryKey: readonly unknown[] = ["members", CHAPTER_ID],
      queryHash?: string,
    ) => reporter.onQueryError(error, { queryKey, queryHash }),
    mutation: (error: unknown, mutationKey?: readonly unknown[]) =>
      reporter.onMutationError(error, { body: "member text" }, undefined, {
        options: { mutationKey },
      }),
  };
}

/** What `@repo/api-sdk` throws for an API refusal: the parsed body, not an Error. */
function apiBody(statusCode: number, extra: Record<string, unknown> = {}) {
  return {
    statusCode,
    error: "Error",
    message: "Jamie Rivera's note about the retreat",
    requestId: REQUEST_ID,
    ...extra,
  };
}

describe("createQueryErrorReporter", () => {
  describe("a failed query", () => {
    it("reports once, at warning level, with identifier-only content", () => {
      const h = harness();
      h.query(apiBody(503, { code: "DEGRADED" }), [
        "members",
        CHAPTER_ID,
        { role: "officer" },
      ]);

      expect(h.reports).toHaveLength(1);
      const [report] = h.reports;
      expect(report!.level).toBe("warning");
      expect(report!.error).toBeInstanceOf(Error);
      expect(report!.error.name).toBe("ApiError");
      expect(report!.error.message).toBe('query "members" answered 503 (DEGRADED)');
      expect(report!.fingerprint).toEqual([
        "react-query",
        "query",
        "members",
        "5xx",
        "DEGRADED",
      ]);
      expect(report!.tags).toEqual({
        query_kind: "query",
        query_key_root: "members",
        query_failure: "http",
        request_id: REQUEST_ID,
        "http.status_code": "503",
        status_class: "5xx",
        error_code: "DEGRADED",
      });
    });

    it("never carries the server's message or any key segment after the root", () => {
      const h = harness();
      h.query(apiBody(500), ["search", CHAPTER_ID, "jamie's lost jacket", "chan-1"]);

      const serialized = JSON.stringify(h.reports, (_key, value: unknown) =>
        value instanceof Error ? { name: value.name, message: value.message } : value,
      );
      expect(h.reports).toHaveLength(1);
      expect(serialized).toContain('"search"');
      expect(serialized).not.toContain("Jamie");
      expect(serialized).not.toContain("jacket");
      expect(serialized).not.toContain(CHAPTER_ID);
      expect(serialized).not.toContain("chan-1");
    });

    it("reads `status` when the SDK put the status there", () => {
      const h = harness();
      h.query({ status: 422 });
      expect(h.reports[0]!.tags.status_class).toBe("4xx");
      expect(h.reports[0]!.tags["http.status_code"]).toBe("422");
    });
  });

  describe("a client-contract 4xx (#4096)", () => {
    it("is reported at error level, named and grouped as a contract bug", () => {
      const h = harness();
      h.query(apiBody(400, { code: "chapter.context.required" }), [
        "tasks",
        CHAPTER_ID,
      ]);

      expect(h.reports).toHaveLength(1);
      const [report] = h.reports;
      expect(report!.level).toBe("error");
      expect(report!.error.name).toBe("ClientContractError");
      expect(report!.error.message).toBe(
        'query "tasks" answered 400 (chapter.context.required)',
      );
      expect(report!.fingerprint).toEqual([
        "react-query",
        "query",
        "tasks",
        "4xx",
        "chapter.context.required",
        "client-contract",
      ]);
      expect(report!.tags).toMatchObject({
        query_key_root: "tasks",
        error_code: "chapter.context.required",
        api_error_class: "client-contract",
      });
    });

    it("covers a request-validation refusal from a mutation", () => {
      const h = harness();
      h.mutation(apiBody(400, { code: "request.validation_failed" }), [
        "events",
        "update",
      ]);
      expect(h.reports[0]!.level).toBe("error");
      expect(h.reports[0]!.fingerprint).toEqual([
        "react-query",
        "mutation",
        "events",
        "4xx",
        "request.validation_failed",
        "client-contract",
      ]);
    });

    it("keeps an uncoded 4xx, or one with an unlisted code, at warning", () => {
      const h = harness();
      h.query(apiBody(404), ["channels"]);
      h.query(apiBody(400, { code: "something.new" }), ["service"]);
      h.query(apiBody(400), ["events"]);
      h.query(apiBody(410), ["invites"]);

      expect(h.reports.map((report) => report.level)).toEqual([
        "warning",
        "warning",
        "warning",
        "warning",
      ]);
      for (const report of h.reports) {
        expect(report.error.name).toBe("ApiError");
        expect(report.tags.api_error_class).toBeUndefined();
        expect(report.fingerprint).not.toContain("client-contract");
      }
    });

    it("leaves out a 4xx whose code is member-caused: normal use, nothing to fix", () => {
      const h = harness();
      h.mutation(apiBody(400, { code: "study.outside_zone" }), [
        "study-sessions",
        "start-study-session",
      ]);
      h.mutation(apiBody(400, { code: "attendance.check_in.window_closed" }), [
        "attendance",
        "check-in",
      ]);
      h.mutation(apiBody(409, { code: "attendance.already_checked_in" }), [
        "attendance",
        "check-in",
      ]);
      h.query(apiBody(400, { code: "service_entry.receipt_required" }), [
        "service",
      ]);
      expect(h.reports).toHaveLength(0);
    });

    it("still reports a 5xx that carries a member-caused code", () => {
      const h = harness();
      h.query(apiBody(503, { code: "chapter.module.disabled" }));
      expect(h.reports).toHaveLength(1);
      expect(h.reports[0]!.level).toBe("warning");
    });

    it("keeps a 5xx at warning even when its code is a client-contract one", () => {
      const h = harness();
      h.query(apiBody(503, { code: "chapter.context.required" }));
      expect(h.reports[0]!.level).toBe("warning");
      expect(h.reports[0]!.error.name).toBe("ApiError");
    });

    it("still drops a 401 or 403, whatever its code", () => {
      const h = harness();
      h.query(apiBody(403, { code: "chapter.context.mismatch" }));
      h.query(apiBody(401, { code: "request.validation_failed" }));
      expect(h.reports).toHaveLength(0);
    });
  });

  describe("what is not reported", () => {
    it("skips a 401 and a 403, and reports the 4xx answers around them", () => {
      const h = harness();
      h.query(apiBody(401));
      h.query(apiBody(403));
      expect(h.reports).toHaveLength(0);

      h.query(apiBody(404));
      expect(h.reports).toHaveLength(1);
      expect(h.reports[0]!.fingerprint).toContain("4xx");
    });

    it("skips a failure with no status while offline", () => {
      const h = harness();
      h.setOnline(false);
      h.query(new TypeError("Failed to fetch"));
      h.query(new TypeError("Network request failed"));
      h.query(new Error("thrown inside the queryFn"));
      expect(h.reports).toHaveLength(0);
    });

    it("still reports an answered request while offline, since a response arrived", () => {
      const h = harness();
      h.setOnline(false);
      h.query(apiBody(500));
      expect(h.reports).toHaveLength(1);
    });

    it("skips a cancelled query and an abort", () => {
      const h = harness();
      h.query({ cancelled: true });
      h.query(new DOMException("The operation was aborted.", "AbortError"));
      h.query(Object.assign(new Error("aborted"), { name: "AbortError" }));
      expect(h.reports).toHaveLength(0);
    });
  });

  describe("a fetch that got no response, while online", () => {
    it.each([
      "Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      "Network request failed",
      "Network request timed out",
      // Sentry's fetch instrumentation appends the host to the browser three.
      "Failed to fetch (api.frapp.live)",
      "Load failed (api.frapp.live)",
      "NetworkError when attempting to fetch resource. (api.frapp.live)",
    ])("reports %j as a network failure", (message) => {
      const h = harness();
      h.query(new TypeError(message));
      expect(h.reports).toHaveLength(1);
      const [report] = h.reports;
      expect(report!.error.name).toBe("NetworkError");
      expect(report!.error.message).toBe(
        `query "members" got no response (${message})`,
      );
      expect(report!.fingerprint).toEqual(["react-query", "query", "network"]);
      expect(report!.tags.query_failure).toBe("network");
      expect(report!.tags.query_key_root).toBe("members");
      expect(report!.tags).not.toHaveProperty("http.status_code");
    });
  });

  // `expo/fetch` (mobile's global fetch since Expo SDK 57) rejects with its
  // `FetchError`: an `Error` subclass that keeps the name `Error`, message
  // `fetch failed: <native message>` (expo src/winter/fetch/FetchErrors.ts).
  class ExpoFetchError extends Error {
    constructor(message: string) {
      super(`fetch failed: ${message}`);
    }
  }

  describe("an expo/fetch transport failure (#3746)", () => {
    it.each([
      "UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)",
      "UnexpectedException: cancelled (at ExpoModulesCore/Promise.swift:56)",
      "java.net.SocketTimeoutException: timeout",
    ])("reports %j as a network failure", (native) => {
      const h = harness();
      h.query(new ExpoFetchError(native));
      expect(h.reports).toHaveLength(1);
      const [report] = h.reports;
      expect(report!.error.name).toBe("NetworkError");
      expect(report!.error.message).toBe(
        `query "members" got no response (fetch failed: ${native})`,
      );
      expect(report!.fingerprint).toEqual(["react-query", "query", "network"]);
      expect(report!.tags.query_failure).toBe("network");
    });

    it("skips the rejection for a signal that was already aborted", () => {
      const h = harness();
      h.query(new ExpoFetchError("The operation was aborted."));
      expect(h.reports).toHaveLength(0);
    });

    it("files one drop across many query roots under one fingerprint, each root still reported", () => {
      const h = harness();
      const roots = ["user", "tasks", "points", "channels", "events"];
      for (const root of roots) {
        h.query(
          new ExpoFetchError("UnexpectedException: The network connection was lost."),
          [root, CHAPTER_ID],
        );
      }
      expect(new Set(h.reports.map((r) => r.fingerprint.join(" ")))).toEqual(
        new Set(["react-query query network"]),
      );
      expect(h.reports.map((r) => r.tags.query_key_root)).toEqual(roots);
      // The rate limit is per root: the same root again inside the window is held.
      h.query(new ExpoFetchError("UnexpectedException: cancelled"), ["user", CHAPTER_ID]);
      expect(h.reports).toHaveLength(roots.length);
    });

    it("keeps an Error named otherwise with that prefix an exception", () => {
      const h = harness();
      const error = new TypeError("fetch failed: something");
      h.query(error);
      expect(h.reports[0]!.tags.query_failure).toBe("exception");
    });
  });

  describe("a fetch-shaped message that is not a dead fetch", () => {
    it.each([
      ["a chunk that failed to load", new TypeError("Failed to fetch dynamically imported module: https://app.frapp.live/_next/a.js")],
      ["a plain Error with a dead-fetch message", new Error("Network request failed")],
      ["a TypeError with text after the message", new TypeError("Load failed for good")],
    ])("reports %s as an exception", (_label, error) => {
      const h = harness();
      h.query(error);
      expect(h.reports).toHaveLength(1);
      expect(h.reports[0]!.tags.query_failure).toBe("exception");
      expect(h.reports[0]!.error).toBe(error);
    });
  });

  describe("an exception thrown inside a queryFn", () => {
    it("passes the Error on as it is and keeps Sentry's own grouping", () => {
      const h = harness();
      const thrown = new TypeError("Cannot read properties of undefined (reading 'map')");
      h.query(thrown, ["polls", CHAPTER_ID]);
      expect(h.reports).toHaveLength(1);
      expect(h.reports[0]!.error).toBe(thrown);
      expect(h.reports[0]!.fingerprint).toEqual([
        "{{ default }}",
        "react-query",
        "query",
        "polls",
      ]);
      expect(h.reports[0]!.tags.query_failure).toBe("exception");
    });

    it("replaces a thrown non-Error with an Error that names only the root", () => {
      const h = harness();
      h.query("member text thrown as a string");
      h.query({ message: "a body with no status" }, ["tasks"]);
      expect(h.reports.map((r) => r.error.message)).toEqual([
        'query "members" threw a non-Error value',
        'query "tasks" threw a non-Error value',
      ]);
      expect(h.reports.every((r) => r.error.name === "QueryError")).toBe(true);
    });

    it("limits per error type and message, so a second bug under one root still reports", () => {
      const h = harness();
      h.query(new TypeError("Cannot read properties of undefined (reading 'map')"));
      h.query(new TypeError("Cannot read properties of undefined (reading 'map')"));
      h.query(new TypeError("Cannot read properties of null (reading 'id')"));
      h.query(new RangeError("Cannot read properties of null (reading 'id')"));
      expect(h.reports.map((r) => `${r.error.name}: ${r.error.message}`)).toEqual([
        "TypeError: Cannot read properties of undefined (reading 'map')",
        "TypeError: Cannot read properties of null (reading 'id')",
        "RangeError: Cannot read properties of null (reading 'id')",
      ]);
    });

    it("takes the query hash out of TanStack's own errors, leaving the original alone", () => {
      const h = harness();
      const queryKey = ["backwork", CHAPTER_ID, { search: "jamie's lost jacket" }];
      const queryHash = JSON.stringify(queryKey);
      const thrown = new Error(`${queryHash} data is undefined`);
      h.query(thrown, queryKey, queryHash);

      const sent = h.reports[0]!.error;
      expect(sent).not.toBe(thrown);
      expect(sent.name).toBe("Error");
      expect(sent.message).toBe(`${QUERY_KEY_PLACEHOLDER} data is undefined`);
      expect(sent.stack).toContain(QUERY_KEY_PLACEHOLDER);
      expect(sent.stack).not.toContain("jacket");
      // TanStack's throw site, not the reporter's, so Sentry groups by it.
      const frames = (stack: string | undefined) => stack!.split("\n").slice(1);
      expect(frames(sent.stack)).toEqual(frames(thrown.stack));
      expect(frames(sent.stack).length).toBeGreaterThan(0);
      expect(thrown.message).toContain("jacket");
    });

    it("passes the Error itself on when its message holds no query hash", () => {
      const h = harness();
      const thrown = new TypeError("x is not a function");
      h.query(thrown, ["polls"], '["polls"]');
      expect(h.reports[0]!.error).toBe(thrown);
    });
  });

  describe("the key root", () => {
    it("names an unkeyed or oddly keyed query `unkeyed`", () => {
      const h = harness();
      // One per interval, since the three share a fingerprint.
      h.query(apiBody(500), [42, "members"]);
      h.advance(DEFAULT_REPORT_INTERVAL_MS);
      h.query(apiBody(502), ["Jamie Rivera's chapter"]);
      h.advance(DEFAULT_REPORT_INTERVAL_MS);
      h.query(apiBody(504), []);
      expect(h.reports.map((r) => r.tags.query_key_root)).toEqual([
        "unkeyed",
        "unkeyed",
        "unkeyed",
      ]);
    });

    it("reads a mutation's root from its mutationKey, or `unkeyed` without one", () => {
      const h = harness();
      h.mutation(apiBody(409), ["chapter-config", CHAPTER_ID, "patch"]);
      h.mutation(apiBody(409));
      expect(h.reports.map((r) => r.fingerprint)).toEqual([
        ["react-query", "mutation", "chapter-config", "4xx"],
        ["react-query", "mutation", "unkeyed", "4xx"],
      ]);
      expect(h.reports[1]!.error.message).toBe('mutation "unkeyed" answered 409');
      expect(JSON.stringify(h.reports.map((r) => r.tags))).not.toContain("member text");
    });
  });

  describe("tags read off the body only in their own shape", () => {
    it("drops a request id or code that isn't identifier-shaped", () => {
      const h = harness();
      h.query(apiBody(500, { requestId: "unknown", code: "has spaces in it" }));
      h.query(apiBody(502, { requestId: CHAPTER_ID, code: 17 }), ["tasks"]);
      for (const report of h.reports) {
        expect(report.tags).not.toHaveProperty("request_id");
        expect(report.tags).not.toHaveProperty("error_code");
      }
      expect(h.reports[0]!.fingerprint).toEqual(["react-query", "query", "members", "5xx"]);
    });
  });

  describe("the rate limit", () => {
    it("reports one fingerprint once per interval", () => {
      const h = harness();
      h.query(apiBody(500));
      h.query(apiBody(503));
      h.advance(DEFAULT_REPORT_INTERVAL_MS - 1);
      h.query(apiBody(500));
      expect(h.reports).toHaveLength(1);

      h.advance(1);
      h.query(apiBody(500));
      expect(h.reports).toHaveLength(2);
    });

    it("keeps separate fingerprints separate", () => {
      const h = harness();
      h.query(apiBody(500));
      h.query(apiBody(404));
      h.query(apiBody(500), ["tasks"]);
      h.mutation(apiBody(500), ["members"]);
      h.query(new TypeError("Failed to fetch"));
      expect(h.reports.map((r) => r.fingerprint.join(" "))).toEqual([
        "react-query query members 5xx",
        "react-query query members 4xx",
        "react-query query tasks 5xx",
        "react-query mutation members 5xx",
        "react-query query network",
      ]);
    });

    it("honours a configured interval", () => {
      const h = harness({ intervalMs: 1_000 });
      h.query(apiBody(500));
      h.advance(1_000);
      h.query(apiBody(500));
      expect(h.reports).toHaveLength(2);
    });

    it("forgets the oldest fingerprint past its memory, not the newest", () => {
      const h = harness();
      for (let i = 0; i <= MAX_REMEMBERED_RATE_KEYS; i += 1) {
        h.query(new TypeError(`bug ${i}`));
      }
      expect(h.reports).toHaveLength(MAX_REMEMBERED_RATE_KEYS + 1);
      // The newest is still remembered; the first was forgotten.
      h.query(new TypeError(`bug ${MAX_REMEMBERED_RATE_KEYS}`));
      expect(h.reports).toHaveLength(MAX_REMEMBERED_RATE_KEYS + 1);
      h.query(new TypeError("bug 0"));
      expect(h.reports).toHaveLength(MAX_REMEMBERED_RATE_KEYS + 2);
    });

    it("counts a fingerprint reported again as the newest", () => {
      const h = harness({ intervalMs: 1_000 });
      h.query(new TypeError("recurring"));
      for (let i = 1; i < MAX_REMEMBERED_RATE_KEYS; i += 1) {
        h.query(new TypeError(`bug ${i}`));
      }
      h.advance(1_000);
      h.query(new TypeError("recurring"));
      // One more pushes the memory past its limit: "bug 1" goes, not "recurring".
      h.query(new TypeError("one more"));
      const before = h.reports.length;
      h.query(new TypeError("recurring"));
      expect(h.reports).toHaveLength(before);
    });

    it("keeps its own state per reporter", () => {
      const first = harness();
      const second = harness();
      first.query(apiBody(500));
      second.query(apiBody(500));
      expect(first.reports).toHaveLength(1);
      expect(second.reports).toHaveLength(1);
    });
  });

  describe("through the clients' scrubber", () => {
    it("keeps every tag and fingerprint part the report sets", () => {
      const h = harness();
      h.query(apiBody(503, { code: "DEGRADED" }));
      const [report] = h.reports;
      // The event the SDK builds from captureException(error, { level, fingerprint, tags }).
      const scrubbed = createSentryScrubber(NO_PSEUDONYMS).scrubSentryEvent({
        level: report!.level,
        fingerprint: report!.fingerprint,
        tags: report!.tags,
        exception: {
          values: [{ type: report!.error.name, value: report!.error.message }],
        },
      });
      expect(scrubbed?.tags).toEqual(report!.tags);
      expect(scrubbed?.fingerprint).toEqual(report!.fingerprint);
      expect(scrubbed?.level).toBe("warning");
    });
  });

  describe("it never throws", () => {
    it("swallows a capture that throws, and does not retry it on the next failure", () => {
      const capture = vi.fn(() => {
        throw new Error("Sentry is unreachable");
      });
      const h = harness({ capture });
      expect(() => h.query(apiBody(500))).not.toThrow();
      expect(() => h.query(apiBody(500))).not.toThrow();
      expect(capture).toHaveBeenCalledTimes(1);
    });

    it("swallows an online check or a cancel check that throws", () => {
      const h = harness({
        isOnline: () => {
          throw new Error("no network module");
        },
      });
      expect(() => h.query(new TypeError("Failed to fetch"))).not.toThrow();
      expect(h.reports).toHaveLength(0);

      const g = harness({
        isCancelled: () => {
          throw new Error("no query-core");
        },
      });
      expect(() => g.mutation(apiBody(500))).not.toThrow();
    });

    it("survives an error whose fields throw when read", () => {
      const h = harness();
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error("getter throws");
          },
        },
      );
      expect(() => h.query(hostile)).not.toThrow();
    });
  });
});
