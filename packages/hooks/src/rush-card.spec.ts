import { describe, expect, it } from "vitest";
import { moduleDisabledMessage } from "@repo/validation";
import {
  canReadCardRushCandidate,
  readLiveRushCandidate,
  RUSH_CARD_REFUSAL_COPY,
  rushCardBadgeLabel,
  rushCardControls,
  rushCardGateRefusal,
  rushCardTally,
  type LiveRushCandidate,
} from "./rush-card";

/** The view the rush routes return. */
const VIEW = {
  id: "cand-1",
  chapter_id: "chapter-1",
  display_name: "Jordan Reyes",
  name_key: "jordan reyes",
  user_id: null,
  stage: "new",
  bid_status: "none",
  created_by: "user-a",
  created_at: "2026-11-04T18:00:00.000Z",
  vote_count: 3,
  viewer_has_voted: false,
};

function live(overrides: Partial<LiveRushCandidate> = {}): LiveRushCandidate {
  return {
    id: "cand-1",
    display_name: "Jordan Reyes",
    vote_count: 3,
    viewer_has_voted: false,
    bid_extended: false,
    ...overrides,
  };
}

describe("readLiveRushCandidate", () => {
  it("reads what a card draws off the view", () => {
    expect(readLiveRushCandidate(VIEW)).toEqual(live());
    expect(
      readLiveRushCandidate({
        ...VIEW,
        bid_status: "extended",
        viewer_has_voted: true,
      }),
    ).toEqual(live({ bid_extended: true, viewer_has_voted: true }));
  });

  it("is null before the read lands, after a 403 or 404, or for a shape it can't draw", () => {
    expect(readLiveRushCandidate(undefined)).toBe(null);
    expect(readLiveRushCandidate(null)).toBe(null);
    expect(readLiveRushCandidate({ ...VIEW, id: undefined })).toBe(null);
    expect(readLiveRushCandidate({ ...VIEW, display_name: 7 })).toBe(null);
    expect(readLiveRushCandidate({ ...VIEW, vote_count: "3" })).toBe(null);
    expect(readLiveRushCandidate({ ...VIEW, vote_count: Number.NaN })).toBe(
      null,
    );
  });

  it("reads anything but an explicit true as not voted, and anything but extended as no bid", () => {
    const read = readLiveRushCandidate({
      ...VIEW,
      viewer_has_voted: "yes",
      bid_status: "EXTENDED",
    });
    expect(read?.viewer_has_voted).toBe(false);
    expect(read?.bid_extended).toBe(false);
  });
});

describe("canReadCardRushCandidate", () => {
  it("asks only for a members:view holder, the one viewer the route answers", () => {
    expect(canReadCardRushCandidate({ canViewMembers: true })).toBe(true);
    expect(canReadCardRushCandidate({ canViewMembers: false })).toBe(false);
  });
});

describe("rushCardControls", () => {
  it("offers nothing until the live candidate is read", () => {
    expect(rushCardControls({ live: null, recruitmentOff: false })).toEqual(
      [],
    );
  });

  it("offers nothing while Recruitment is off", () => {
    expect(rushCardControls({ live: live(), recruitmentOff: true })).toEqual(
      [],
    );
  });

  it("offers Vote and Extend bid to a member who hasn't voted, on an open candidate", () => {
    expect(rushCardControls({ live: live(), recruitmentOff: false })).toEqual([
      "vote",
      "bid",
    ]);
  });

  it("swaps Vote for the Voted indicator once the viewer has voted", () => {
    expect(
      rushCardControls({
        live: live({ viewer_has_voted: true }),
        recruitmentOff: false,
      }),
    ).toEqual(["voted", "bid"]);
  });

  it("drops Extend bid once a bid is out", () => {
    expect(
      rushCardControls({
        live: live({ bid_extended: true }),
        recruitmentOff: false,
      }),
    ).toEqual(["vote"]);
  });
});

describe("rushCardBadgeLabel", () => {
  it("says whether a bid is out", () => {
    expect(rushCardBadgeLabel(live())).toBe("Open");
    expect(rushCardBadgeLabel(live({ bid_extended: true }))).toBe(
      "Bid extended",
    );
  });
});

describe("rushCardTally", () => {
  it("counts votes, singular for one", () => {
    expect(rushCardTally(live({ vote_count: 0 }))).toBe("0 votes");
    expect(rushCardTally(live({ vote_count: 1 }))).toBe("1 vote");
    expect(rushCardTally(live({ vote_count: 4 }))).toBe("4 votes");
  });

  it("says when the viewer is among them", () => {
    expect(
      rushCardTally(live({ vote_count: 1, viewer_has_voted: true })),
    ).toBe("1 vote · you voted");
  });
});

describe("rushCardGateRefusal", () => {
  const refusal = (message: string, statusCode = 403) => ({
    statusCode,
    message,
  });

  it("puts the subscription gate in a member's words", () => {
    expect(
      rushCardGateRefusal(
        refusal(
          "Chapter subscription is past due; write actions are blocked until payment is resolved.",
        ),
      ),
    ).toBe(RUSH_CARD_REFUSAL_COPY.subscription);
  });

  it("puts the Recruitment gate in a member's words, naming the module as Settings does", () => {
    expect(rushCardGateRefusal(refusal(moduleDisabledMessage("rush")))).toBe(
      RUSH_CARD_REFUSAL_COPY.recruitmentOff,
    );
    expect(RUSH_CARD_REFUSAL_COPY.recruitmentOff).toMatch(/^Recruitment /);
  });

  it("leaves every other failure to the card, including a 403 that isn't a gate", () => {
    expect(rushCardGateRefusal(refusal("No roles assigned"))).toBe(null);
    expect(
      rushCardGateRefusal(refusal(moduleDisabledMessage("rush"), 400)),
    ).toBe(null);
    expect(rushCardGateRefusal(refusal(moduleDisabledMessage("polls")))).toBe(
      null,
    );
    expect(rushCardGateRefusal(new Error("Network request failed"))).toBe(
      null,
    );
  });

  it("never names a plan, a price or checkout", () => {
    for (const copy of Object.values(RUSH_CARD_REFUSAL_COPY)) {
      expect(copy).not.toMatch(/plan|price|checkout|subscribe|upgrade/i);
    }
  });
});
