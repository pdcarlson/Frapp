import { describe, expect, it } from "vitest";
import { moduleDisabledMessage } from "@repo/validation";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { taskStatusGateRefusal } from "./status-refusal";

describe("taskStatusGateRefusal", () => {
  it("puts each gate's refusal in the member's words", () => {
    expect(
      taskStatusGateRefusal({
        statusCode: 403,
        error: "Forbidden",
        message:
          "Chapter subscription is not active; complete checkout to use this feature.",
      }),
    ).toBe(SUBSCRIPTION_REFUSAL_COPY.taskStatus);
    expect(
      taskStatusGateRefusal({
        statusCode: 403,
        error: "Forbidden",
        message: moduleDisabledMessage("tasks"),
      }),
    ).toBe(MODULE_REFUSAL_COPY.taskStatus);
  });

  it("leaves every other refusal to the caller, a permission 403 included", () => {
    expect(
      taskStatusGateRefusal({ statusCode: 403, message: "Forbidden resource" }),
    ).toBeNull();
    expect(
      taskStatusGateRefusal({ statusCode: 400, message: "Invalid status transition" }),
    ).toBeNull();
    expect(taskStatusGateRefusal(undefined)).toBeNull();
  });
});
