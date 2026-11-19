import { describe, expect, it } from "vitest";
import {
  canSeeChapterPhoneReach,
  matchesPhoneReachFilter,
  phoneReachCountLine,
  phoneReachLastOpened,
  phoneReachOf,
  phoneReachStaleNote,
  phoneReachSummary,
  type PhoneReachDevice,
} from "./phone-reach";

const device = (over: Partial<PhoneReachDevice> = {}): PhoneReachDevice => ({
  user_id: "u-1",
  device_name: "ios 26.1 · iPhone 16",
  last_registered_at: "2026-11-18T15:00:00.000Z",
  notifications_enabled: true,
  ...over,
});

describe("phoneReachOf", () => {
  it("reads web only with no phone", () => {
    expect(phoneReachOf("u-1", [])).toEqual({
      user_id: "u-1",
      state: "web_only",
      platform: null,
      last_opened_at: null,
    });
  });

  it("is on when any phone is on, even if another is off", () => {
    const reach = phoneReachOf("u-1", [
      device({ notifications_enabled: false }),
      device({ notifications_enabled: true }),
    ]);
    expect(reach.state).toBe("on");
  });

  it("is off only when every phone says off", () => {
    expect(
      phoneReachOf("u-1", [device({ notifications_enabled: false })]).state,
    ).toBe("off");
    expect(
      phoneReachOf("u-1", [
        device({ notifications_enabled: false }),
        device({ notifications_enabled: null }),
      ]).state,
    ).toBe("unknown");
  });

  it("takes the platform and date from the phone opened last", () => {
    const reach = phoneReachOf("u-1", [
      device({
        device_name: "android 15 · Pixel 9",
        last_registered_at: "2026-11-19T10:00:00.000Z",
      }),
      device({ last_registered_at: "2026-10-01T10:00:00.000Z" }),
    ]);
    expect(reach.platform).toBe("android");
    expect(reach.last_opened_at).toBe("2026-11-19T10:00:00.000Z");
  });

  it("leaves the platform unknown for an unlabelled phone", () => {
    expect(phoneReachOf("u-1", [device({ device_name: null })]).platform).toBe(
      null,
    );
  });
});

describe("who sees the chapter's reach", () => {
  it("is the officers who can invite or manage roles", () => {
    expect(canSeeChapterPhoneReach(["members:view", "members:invite"])).toBe(
      true,
    );
    expect(canSeeChapterPhoneReach(["members:view", "roles:manage"])).toBe(
      true,
    );
    expect(canSeeChapterPhoneReach(["*"])).toBe(true);
  });

  it("is not a member who can only see the directory", () => {
    expect(canSeeChapterPhoneReach(["members:view"])).toBe(false);
    expect(canSeeChapterPhoneReach([])).toBe(false);
  });
});

describe("matchesPhoneReachFilter", () => {
  const on = phoneReachOf("a", [device()]);
  const off = phoneReachOf("b", [device({ notifications_enabled: false })]);
  const unknown = phoneReachOf("c", [device({ notifications_enabled: null })]);
  const web = phoneReachOf("d", []);

  it("treats Not reachable as off plus web only", () => {
    const shown = [on, off, unknown, web].filter((r) =>
      matchesPhoneReachFilter(r, "unreachable"),
    );
    expect(shown.map((r) => r.user_id)).toEqual(["b", "d"]);
  });

  it("passes everyone on Any, and nobody without an entry on a filter", () => {
    expect(matchesPhoneReachFilter(undefined, null)).toBe(true);
    expect(matchesPhoneReachFilter(undefined, "web_only")).toBe(false);
  });
});

describe("wording", () => {
  const now = new Date("2026-11-19T17:00:00.000Z");

  it("names the phone and the state", () => {
    expect(
      phoneReachSummary(
        phoneReachOf("u", [device({ notifications_enabled: false })]),
      ),
    ).toBe("iPhone, notifications off");
    expect(phoneReachSummary(phoneReachOf("u", []))).toBe("Web only");
    expect(
      phoneReachSummary(
        phoneReachOf("u", [device({ notifications_enabled: null })]),
      ),
    ).toBe("iPhone, notifications not reported yet");
  });

  it("writes the last-opened date out, with the year only when it differs", () => {
    expect(phoneReachLastOpened(phoneReachOf("u", [device()]), now)).toBe(
      "Last opened November 18",
    );
    expect(
      phoneReachLastOpened(
        phoneReachOf("u", [
          device({ last_registered_at: "2025-12-10T15:00:00.000Z" }),
        ]),
        now,
      ),
    ).toBe("Last opened December 10, 2025");
  });

  it("adds the stale note only after 30 days unopened", () => {
    expect(phoneReachStaleNote(phoneReachOf("u", [device()]), now)).toBe(null);
    expect(
      phoneReachStaleNote(
        phoneReachOf("u", [
          device({ last_registered_at: "2026-10-12T15:00:00.000Z" }),
        ]),
        now,
      ),
    ).toBe("Last opened October 12");
  });

  it("counts off and web only as unreachable", () => {
    expect(
      phoneReachCountLine(
        [
          phoneReachOf("a", [device()]),
          phoneReachOf("b", []),
          phoneReachOf("c", [device({ notifications_enabled: false })]),
        ],
        3,
      ),
    ).toBe("2 of 3 members can't get notifications");
  });
});
