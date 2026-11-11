import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenLinkedEvent } from "./open-linked-event";

const search = vi.hoisted(() => ({ current: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => search.current,
}));

type Row = { id: string };
const idOf = (row: Row) => row.id;

describe("OpenLinkedEvent (/events?event=<id>)", () => {
  beforeEach(() => {
    search.current = new URLSearchParams();
  });

  it("opens the linked event once the list holds it, and only once", () => {
    search.current = new URLSearchParams({ event: "evt-2" });
    const onOpen = vi.fn();
    const { rerender } = render(
      <OpenLinkedEvent events={[]} idOf={idOf} onOpen={onOpen} />,
    );
    expect(onOpen).not.toHaveBeenCalled();

    const loaded = [{ id: "evt-1" }, { id: "evt-2" }];
    rerender(<OpenLinkedEvent events={loaded} idOf={idOf} onOpen={onOpen} />);
    expect(onOpen).toHaveBeenCalledWith({ id: "evt-2" });

    // A re-read of the list (a realtime refresh) does not reopen it.
    rerender(
      <OpenLinkedEvent events={[...loaded]} idOf={idOf} onOpen={onOpen} />,
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens nothing for an id the list does not hold, or with no link", () => {
    const onOpen = vi.fn();
    render(
      <OpenLinkedEvent
        events={[{ id: "evt-1" }]}
        idOf={idOf}
        onOpen={onOpen}
      />,
    );
    search.current = new URLSearchParams({ event: "gone" });
    render(
      <OpenLinkedEvent
        events={[{ id: "evt-1" }]}
        idOf={idOf}
        onOpen={onOpen}
      />,
    );
    expect(onOpen).not.toHaveBeenCalled();
  });
});
