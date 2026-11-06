import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFieldReveal } from "./field-reveal";

type Field = "year" | "name";

describe("useFieldReveal", () => {
  it("shows nothing while the member is still typing", () => {
    const { result } = renderHook(() => useFieldReveal<Field>());
    expect(result.current.shows("year")).toBe(false);
    expect(result.current.shows("name")).toBe(false);
  });

  it("shows a field's error once the member leaves it, and only that field's", () => {
    const { result } = renderHook(() => useFieldReveal<Field>());
    act(() => result.current.blur("year"));
    expect(result.current.shows("year")).toBe(true);
    expect(result.current.shows("name")).toBe(false);
  });

  it("shows every field's error once the member tries to submit", () => {
    const { result } = renderHook(() => useFieldReveal<Field>());
    act(() => result.current.submit());
    expect(result.current.shows("year")).toBe(true);
    expect(result.current.shows("name")).toBe(true);
  });

  it("keeps showing after a later focus, so a fix clears it as it is typed", () => {
    const { result } = renderHook(() => useFieldReveal<Field>());
    act(() => result.current.blur("year"));
    // Nothing un-reveals on refocus: the error follows the value from here.
    act(() => result.current.blur("year"));
    expect(result.current.shows("year")).toBe(true);
  });

  it("hides everything again on reset", () => {
    const { result } = renderHook(() => useFieldReveal<Field>());
    act(() => {
      result.current.blur("name");
      result.current.submit();
    });
    act(() => result.current.reset());
    expect(result.current.shows("year")).toBe(false);
    expect(result.current.shows("name")).toBe(false);
  });
});
