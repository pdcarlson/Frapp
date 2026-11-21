import { describe, expect, it } from "vitest";
import { scheduledMessageExtras } from "./use-scheduled-messages";

const photo = { filename: "a.jpg", content_type: "image/jpeg" };
const pdf = { filename: "dues.pdf", content_type: "application/pdf" };

describe("scheduledMessageExtras (#4971)", () => {
  it("is null for plain text", () => {
    expect(
      scheduledMessageExtras({
        attachments: [],
        reply_to_id: null,
        thread_root_id: null,
      }),
    ).toBeNull();
  });

  it("names a reply and counts photos and files apart", () => {
    expect(
      scheduledMessageExtras({
        attachments: [photo, photo, pdf],
        reply_to_id: "m-1",
        thread_root_id: null,
      }),
    ).toBe("Reply · 2 photos · 1 file");
  });

  it("names a thread", () => {
    expect(
      scheduledMessageExtras({
        attachments: [photo],
        reply_to_id: null,
        thread_root_id: "r-1",
      }),
    ).toBe("In a thread · 1 photo");
  });
});
