/** @vitest-environment jsdom */
import React, { forwardRef, useImperativeHandle } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useRouter } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  chapterId: "chapter-1" as string | null,
  events: [] as object[],
  present: vi.fn(),
  /** A sheet name that throws while rendering. */
  throws: null as string | null,
}));
vi.mock("@/components/route-error", () => ({ reportRouteError: vi.fn() }));

vi.mock("@repo/hooks", () => ({
  useActiveChapterId: () => data.chapterId,
  useEvents: () => ({ data: data.events }),
  useDocumentFolders: () => ({ data: [] }),
}));

// Each sheet stands in as a host node that can be presented, so a spec sees
// when it mounts and when it is asked to open.
function sheet(name: string) {
  return forwardRef<{ present: () => void }, object>(
    function Sheet(props, ref) {
      useImperativeHandle(ref, () => ({
        present: () => data.present(name),
      }));
      if (data.throws === name) throw new Error(`${name} failed`);
      return React.createElement(name, props);
    },
  );
}
vi.mock("@/components/events/new-event-sheet", () => ({
  NewEventSheet: sheet("NewEventSheet"),
}));
vi.mock("@/components/tasks/new-task-sheet", () => ({
  NewTaskSheet: sheet("NewTaskSheet"),
}));
vi.mock("@/components/service-hours/log-hours-sheet", () => ({
  LogHoursSheet: sheet("LogHoursSheet"),
}));
vi.mock("@/components/documents/upload-document-sheet", () => ({
  UploadDocumentSheet: sheet("UploadDocumentSheet"),
}));

import { AccessibilityInfo } from "react-native";
import { reportRouteError } from "@/components/route-error";
import type { QuickActionKey } from "@/lib/quick-actions";
import { NOTICE_MS, useQuickActionsHost } from "./quick-actions-host";

type Host = ReturnType<typeof useQuickActionsHost>;
let latest!: Host;
const capture = (host: Host) => {
  latest = host;
};

function Harness({ onHost = capture }: { onHost?: (host: Host) => void }) {
  const host = useQuickActionsHost({ events: true });
  onHost(host);
  return <>{host.sheets}</>;
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Harness />);
  });
  return tree;
}

const run = (key: QuickActionKey) => act(() => latest.run(key));
const hosts = (tree: ReactTestRenderer, name: string) =>
  tree.root.findAll((node) => (node.type as unknown) === name);

const router = vi.mocked(useRouter)();

function event(id: string, startOffsetMin: number, lengthMin = 60) {
  const start = new Date(Date.now() + startOffsetMin * 60_000);
  const end = new Date(start.getTime() + lengthMin * 60_000);
  return {
    id,
    name: id,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  data.chapterId = "chapter-1";
  data.events = [];
  data.throws = null;
});

describe("the sheets", () => {
  it("mounts none until one is asked for, then presents it", () => {
    const tree = render();
    expect(hosts(tree, "NewTaskSheet")).toHaveLength(0);

    run("newTask");
    expect(hosts(tree, "NewTaskSheet")).toHaveLength(1);
    expect(hosts(tree, "LogHoursSheet")).toHaveLength(0);
    expect(data.present).toHaveBeenCalledWith("NewTaskSheet");

    // Kept mounted, so a second open presents the same sheet and its draft.
    run("newTask");
    expect(hosts(tree, "NewTaskSheet")).toHaveLength(1);
    expect(data.present).toHaveBeenCalledTimes(2);
  });

  it("opens New event, Log hours and Upload the same way", () => {
    const tree = render();
    run("newEvent");
    run("logHours");
    run("upload");
    expect(hosts(tree, "NewEventSheet")).toHaveLength(1);
    expect(hosts(tree, "LogHoursSheet")).toHaveLength(1);
    expect(hosts(tree, "UploadDocumentSheet")).toHaveLength(1);
    expect(data.present.mock.calls).toEqual([
      ["NewEventSheet"],
      ["LogHoursSheet"],
      ["UploadDocumentSheet"],
    ]);
    // New event is a sheet over the screen the member is on, not a trip to
    // Events.
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("starts the sheets over in another chapter", () => {
    const tree = render();
    run("newTask");
    data.chapterId = "chapter-2";
    act(() => tree.update(<Harness />));
    expect(hosts(tree, "NewTaskSheet")).toHaveLength(0);
  });

  it("gives Log hours today's clock on each open", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-06T09:00:00Z"));
      const tree = render();
      vi.setSystemTime(new Date("2026-11-07T09:00:00Z"));
      run("logHours");
      const [hours] = hosts(tree, "LogHoursSheet");
      expect((hours.props.now as Date).toISOString()).toBe(
        "2026-11-07T09:00:00.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a confirmation after a create", () => {
  const sheetProps = (tree: ReactTestRenderer, name: string) =>
    hosts(tree, name)[0].props as Record<string, (...args: never[]) => void>;

  it("says where a task went, over whatever screen is up", () => {
    const tree = render();
    run("newTask");
    act(() =>
      (
        sheetProps(tree, "NewTaskSheet").onCreated as (
          name: string | null,
          self: boolean,
        ) => void
      )("Sam Rivera", false),
    );
    expect(latest.notice).toBe("Assigned to Sam Rivera.");
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      "Assigned to Sam Rivera.",
    );
    act(() =>
      (
        sheetProps(tree, "NewTaskSheet").onCreated as (
          name: string | null,
          self: boolean,
        ) => void
      )(null, true),
    );
    expect(latest.notice).toBe("Added to your tasks.");
  });

  it("confirms a new event, logged hours and an upload", () => {
    const tree = render();
    run("newEvent");
    act(() => (sheetProps(tree, "NewEventSheet").onCreated as () => void)());
    expect(latest.notice).toBe("Event added.");
    run("logHours");
    act(() => (sheetProps(tree, "LogHoursSheet").onLogged as () => void)());
    expect(latest.notice).toBe("Hours logged.");
    run("upload");
    act(() =>
      (
        sheetProps(tree, "UploadDocumentSheet").onUploaded as (
          title: string,
        ) => void
      )("Bylaws"),
    );
    expect(latest.notice).toBe("“Bylaws” is in the library.");
  });

  it("goes away after a few seconds, counted from the latest", () => {
    vi.useFakeTimers();
    try {
      const tree = render();
      run("logHours");
      const logged = sheetProps(tree, "LogHoursSheet").onLogged as () => void;
      act(() => logged());
      act(() => vi.advanceTimersByTime(NOTICE_MS - 1000));
      act(() => logged());
      act(() => vi.advanceTimersByTime(NOTICE_MS - 1000));
      expect(latest.notice).toBe("Hours logged.");
      act(() => vi.advanceTimersByTime(1000));
      expect(latest.notice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a sheet that fails to render", () => {
  it("is dropped and reported, and the next ask mounts it again", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tree = render();
      data.throws = "LogHoursSheet";
      run("logHours");
      expect(hosts(tree, "LogHoursSheet")).toHaveLength(0);
      expect(reportRouteError).toHaveBeenCalledWith(expect.any(Error), {
        boundary: "sheet",
      });
      data.throws = null;
      run("logHours");
      expect(hosts(tree, "LogHoursSheet")).toHaveLength(1);
      expect(data.present).toHaveBeenCalledWith("LogHoursSheet");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("where the rest go", () => {
  it("sends Message to the directory and Study to study", () => {
    render();
    run("message");
    run("study");
    expect(vi.mocked(router.push).mock.calls).toEqual([
      ["/directory"],
      ["/study"],
    ]);
  });

  it("checks straight in to the one event open now", () => {
    data.events = [event("now", -10), event("later", 120)];
    render();
    run("checkIn");
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/check-in",
      params: { eventId: "now" },
    });
  });

  it("lets the member choose on Events when none or several are open", () => {
    data.events = [event("later", 120)];
    const tree = render();
    run("checkIn");
    data.events = [event("a", -10), event("b", -5)];
    act(() => tree.update(<Harness />));
    run("checkIn");
    expect(router.push).not.toHaveBeenCalled();
    expect(vi.mocked(router.navigate).mock.calls).toEqual([
      ["/events"],
      ["/events"],
    ]);
  });

  it("hosts the soonest event still open to check-in", () => {
    data.events = [event("later", 120), event("soon", 30)];
    render();
    run("hostCheckIn");
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/host-check-in",
      params: { eventId: "soon" },
    });
  });

  it("sends Host check-in to Events when nothing is coming up", () => {
    render();
    run("hostCheckIn");
    expect(router.navigate).toHaveBeenCalledWith("/events");
  });
});
