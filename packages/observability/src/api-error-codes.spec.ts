import { describe, expect, it } from "vitest";
import {
  CLIENT_CONTRACT_ERROR_CODES,
  isClientContractErrorCode,
  MEMBER_CAUSED_ERROR_CODES,
} from "./api-error-codes";

describe("API error code classes (#4096)", () => {
  it("puts no code in both lists", () => {
    const memberCaused = new Set<string>(MEMBER_CAUSED_ERROR_CODES);
    expect(
      CLIENT_CONTRACT_ERROR_CODES.filter((code) => memberCaused.has(code)),
    ).toEqual([]);
  });

  it("calls a client-contract code a bug, and nothing else", () => {
    expect(isClientContractErrorCode("chapter.context.required")).toBe(true);
    expect(isClientContractErrorCode("request.validation_failed")).toBe(true);
    expect(isClientContractErrorCode("chapter.module.disabled")).toBe(false);
    expect(isClientContractErrorCode("unlisted.code")).toBe(false);
    expect(isClientContractErrorCode(undefined)).toBe(false);
    expect(isClientContractErrorCode(null)).toBe(false);
  });
});
