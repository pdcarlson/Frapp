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
}));

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
      return React.createElement(name, props);
    },
  );
}
vi.mock("@/components/tasks/new-task-sheet", () => ({
  NewTaskSheet: sheet("NewTaskSheet"),
}));
vi.mock("@/components/service-hours/log-hours-sheet", () => ({
  LogHoursSheet: sheet("LogHoursSheet"),
}));
vi.mock("@/components/documents/upload-document-sheet", () => ({
  UploadDocumentSheet: sheet("UploadDocumentSheet"),
}));

import type { QuickActionKey } from "@/lib/quick-actions";
import { useQuickActionsHost } from "./quick-actions-host";

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

  it("opens Log hours and Upload the same way", () => {
    const tree = render();
    run("logHours");
    run("upload");
    expect(hosts(tree, "LogHoursSheet")).toHaveLength(1);
    expect(hosts(tree, "UploadDocumentSheet")).toHaveLength(1);
    expect(data.present.mock.calls).toEqual([
      ["LogHoursSheet"],
      ["UploadDocumentSheet"],
    ]);
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
