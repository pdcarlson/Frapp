import { describe, expect, it } from "vitest";

import { CLIENT_VERSION_HEADER, TIME_ZONE_HEADER } from "./client-headers";

// Shipped mobile builds send these names as they are; renaming one here would
// leave every installed binary sending a header the API no longer reads.
describe("client headers", () => {
  it("keeps the wire names shipped builds send", () => {
    expect(TIME_ZONE_HEADER).toBe("x-time-zone");
    expect(CLIENT_VERSION_HEADER).toBe("x-client-version");
  });
});
