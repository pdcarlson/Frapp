import { describe, expect, it } from "vitest";

import {
  DIRECTORY_COPY,
  directoryNoSearchMatches,
  EVENTS_COPY,
  eventsCount,
} from "./screen-copy";

describe("screen copy shared by web and the phone (#4135)", () => {
  it("counts events in the singular and the plural", () => {
    expect(eventsCount(1)).toBe("1 event");
    expect(eventsCount(0)).toBe("0 events");
    expect(eventsCount(4)).toBe("4 events");
  });

  it("says nobody, not actives, for a search miss that covers alumni too", () => {
    expect(directoryNoSearchMatches("pigg")).toBe("Nobody matches “pigg”.");
  });

  it("keeps the lines both apps assert", () => {
    expect(EVENTS_COPY.empty).toBe("Nothing scheduled yet.");
    expect(EVENTS_COPY.loadError).toBe("Couldn't load events");
    expect(DIRECTORY_COPY.loadError).toBe("Couldn't load the directory");
  });
});
