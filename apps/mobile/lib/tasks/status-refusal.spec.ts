import { describe, expect, it } from "vitest";
import {
  TASK_RESUBMIT_NEEDS_CHANGE_MESSAGE,
  moduleDisabledMessage,
} from "@repo/validation";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import {
  TASK_PROOF_REFUSAL,
  taskProofRefusal,
  taskStatusGateRefusal,
} from "./status-refusal";

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
      taskStatusGateRefusal({
        statusCode: 400,
        message: "Invalid status transition",
      }),
    ).toBeNull();
    expect(taskStatusGateRefusal(undefined)).toBeNull();
  });
});

describe("taskProofRefusal (#4565, #4635)", () => {
  it("asks for proof when the task needs it, by code, not sentence", () => {
    expect(
      taskProofRefusal({
        statusCode: 400,
        code: "task.proof_required",
        message: "reworded someday",
      }),
    ).toBe(TASK_PROOF_REFUSAL);
    expect(TASK_PROOF_REFUSAL).not.toMatch(/web/);
  });

  it("asks for something new on a sent-back task", () => {
    expect(
      taskProofRefusal({
        statusCode: 400,
        code: "task.resubmit_needs_change",
        message: "anything",
      }),
    ).toBe(TASK_RESUBMIT_NEEDS_CHANGE_MESSAGE);
  });

  it("reads nothing into any other refusal", () => {
    expect(taskProofRefusal({ statusCode: 400, message: "Bad Request" })).toBe(
      null,
    );
    expect(
      taskProofRefusal({ statusCode: 403, code: "task.proof_required" }),
    ).toBeNull();
  });
});
