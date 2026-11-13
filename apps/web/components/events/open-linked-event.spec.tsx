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
    window.history.replaceState(null, "", "/");
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
    expect(onOpen).toHaveBeenCalledWith({ id: "evt-2" }, { excuse: false });

    // A re-read of the list (a realtime refresh) does not reopen it.
    rerender(
      <OpenLinkedEvent events={[...loaded]} idOf={idOf} onOpen={onOpen} />,
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("passes on the chat card's ask to open Can't make it, then drops it from the URL (#4660)", () => {
    search.current = new URLSearchParams({ event: "evt-1", excuse: "1" });
    window.history.replaceState(null, "", "/events?event=evt-1&excuse=1");
    const onOpen = vi.fn();
    const { rerender } = render(
      <OpenLinkedEvent
        events={[{ id: "evt-1" }]}
        idOf={idOf}
        onOpen={onOpen}
      />,
    );
    expect(onOpen).toHaveBeenCalledWith({ id: "evt-1" }, { excuse: true });
    expect(window.location.pathname + window.location.search).toBe(
      "/events?event=evt-1",
    );

    // A list refresh before the URL settles does not hand the ask on twice.
    rerender(
      <OpenLinkedEvent
        events={[{ id: "evt-1" }]}
        idOf={idOf}
        onOpen={onOpen}
      />,
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("acts on the ask for an event it already opened (the page stays mounted beside chat)", () => {
    search.current = new URLSearchParams({ event: "evt-1" });
    const onOpen = vi.fn();
    const events = [{ id: "evt-1" }];
    const { rerender } = render(
      <OpenLinkedEvent events={events} idOf={idOf} onOpen={onOpen} />,
    );
    expect(onOpen).toHaveBeenLastCalledWith({ id: "evt-1" }, { excuse: false });

    // The card's Can't make it for the same event.
    search.current = new URLSearchParams({ event: "evt-1", excuse: "1" });
    rerender(<OpenLinkedEvent events={events} idOf={idOf} onOpen={onOpen} />);
    expect(onOpen).toHaveBeenLastCalledWith({ id: "evt-1" }, { excuse: true });

    // The URL drops the ask; that alone reopens nothing.
    search.current = new URLSearchParams({ event: "evt-1" });
    rerender(<OpenLinkedEvent events={events} idOf={idOf} onOpen={onOpen} />);
    expect(onOpen).toHaveBeenCalledTimes(2);

    // A second tap is a fresh ask.
    search.current = new URLSearchParams({ event: "evt-1", excuse: "1" });
    rerender(<OpenLinkedEvent events={events} idOf={idOf} onOpen={onOpen} />);
    expect(onOpen).toHaveBeenCalledTimes(3);
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
