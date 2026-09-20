/**
 * TZ is America/Los_Angeles (vitest.config + package.json `test` script), so a
 * case that would only pass at UTC fails here.
 *
 * Scope, stated exactly: `locale.spec.ts` and `bare-date.spec.ts` already
 * cover what the members built on this primitive do with an unreadable value,
 * and repeating those here would make two files go red for one decision. What
 * is below is only what nothing else pins — the `unknown` rejection, and the
 * boundary between this parse and the bare-date cluster's.
 */
import { describe, expect, it } from "vitest";
import { parseInstant } from "./instant";
import { parseBareDateUtcNoon, parseInstantOrBareUtcNoon } from "./bare-date";

describe("parseInstant", () => {
  it("returns the parsed instant for a full ISO timestamp", () => {
    const parsed = parseInstant("2026-08-12T18:30:00Z");
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(Date.parse("2026-08-12T18:30:00Z"));
  });

  it("returns null rather than an Invalid Date for an unreadable string", () => {
    // The whole point: `new Date` hands back an object that renders as the
    // string "Invalid Date" instead of throwing.
    expect(new Date("not-a-date").toString()).toBe("Invalid Date");
    expect(parseInstant("not-a-date")).toBeNull();
  });

  it("rejects every non-string, including the ones `new Date` accepts", () => {
    // This is the clause with teeth, and the reason the guard is `unknown`
    // rather than `string`: drop it and a loosely-typed JSON field holding
    // `null` or `0` becomes a *valid* Date at the Unix epoch, so a caller
    // that renders "nothing" for an unknown timestamp renders "Dec 31, 1969".
    expect(new Date(null as unknown as number).getTime()).toBe(0);
    expect(new Date(0).getTime()).toBe(0);
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant(0)).toBeNull();
    expect(parseInstant(new Date("2026-08-12T18:30:00Z"))).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
    expect(parseInstant({})).toBeNull();
    expect(parseInstant("")).toBeNull();
  });

  it("does not narrow a bare YYYY-MM-DD to the stored calendar day", () => {
    // The line between this primitive and the bare-date cluster: a date-only
    // string is UTC midnight here, which is the previous local day west of
    // Greenwich. `parseBareDateUtcNoon` is the member that fixes that, and
    // folding the two would silently re-break it.
    const bare = "2026-08-12";
    expect(parseInstant(bare)!.getDate()).toBe(11);
    expect(parseBareDateUtcNoon(bare)!.getDate()).toBe(12);
  });

  it("is the fallback that rejects a bare-date-shaped string that is not a date", () => {
    // `2026-13-45` matches BARE_DATE's `^\d{4}-\d{2}-\d{2}$`, so the noon
    // parse is attempted and yields null; only this primitive turns the
    // fall-through into a null too, and nothing else in the package covers it.
    expect(parseBareDateUtcNoon("2026-13-45")).toBeNull();
    expect(parseInstant("2026-13-45")).toBeNull();
    expect(parseInstantOrBareUtcNoon("2026-13-45")).toBeNull();
  });
});
