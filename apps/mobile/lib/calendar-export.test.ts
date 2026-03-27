/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { escapeIcsText, toIcsTimestamp, buildIcsContent } from "./calendar-export";
import { InvalidArgumentException } from "./errors";

describe("calendar-export", () => {
  describe("escapeIcsText", () => {
    it("escapes backslashes", () => {
      expect(escapeIcsText("hello\\world")).toBe("hello\\\\world");
    });

    it("escapes newlines", () => {
      expect(escapeIcsText("hello\nworld")).toBe("hello\\nworld");
      expect(escapeIcsText("hello\r\nworld")).toBe("hello\\nworld");
    });

    it("escapes commas and semicolons", () => {
      expect(escapeIcsText("hello, world; test")).toBe("hello\\, world\\; test");
    });

    it("escapes multiple characters correctly", () => {
      expect(escapeIcsText("Location: 123 Main St., City; Notes: Bring \\ and \n things.")).toBe("Location: 123 Main St.\\, City\\; Notes: Bring \\\\ and \\n things.");
    });
  });

  describe("toIcsTimestamp", () => {
    it("converts valid ISO string to ICS format", () => {
      // "2023-10-15T10:30:00.000Z" -> "20231015T103000Z"
      expect(toIcsTimestamp("2023-10-15T10:30:00.000Z")).toBe("20231015T103000Z");
    });

    it("throws InvalidArgumentException for invalid dates", () => {
      expect(() => toIcsTimestamp("not-a-date")).toThrow(InvalidArgumentException);
      expect(() => toIcsTimestamp("not-a-date")).toThrow("Invalid calendar timestamp: not-a-date");
    });
  });

  describe("buildIcsContent", () => {
    beforeEach(() => {
      // Mock the current date for deterministic DTSTAMP
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("builds correct ICS content with all fields", () => {
      const input = {
        title: "Team Meeting",
        description: "Weekly sync up.",
        location: "Conference Room A, Floor 2",
        startAtIso: "2024-02-15T14:00:00.000Z",
        endAtIso: "2024-02-15T15:00:00.000Z",
        deepLinkUrl: "https://frapp.live/events/123",
      };

      const result = buildIcsContent(input);

      // We join with \r\n to match the actual output of buildIcsContent
      const expectedLines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Frapp//Chapter Events//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        "UID:20240215T140000Z-Team Meeting@frapp.live",
        "DTSTAMP:20240101T120000Z",
        "DTSTART:20240215T140000Z",
        "DTEND:20240215T150000Z",
        "SUMMARY:Team Meeting",
        "DESCRIPTION:Weekly sync up.\\nhttps://frapp.live/events/123",
        "LOCATION:Conference Room A\\, Floor 2",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

      expect(result).toBe(expectedLines);
    });

    it("escapes characters in ICS content correctly", () => {
      const input = {
        title: "Meeting: Part 1; Part 2",
        description: "Notes:\n1. Bring laptop\n2. Be there",
        location: "123 Main St, New York, NY",
        startAtIso: "2024-02-15T14:00:00.000Z",
        endAtIso: "2024-02-15T15:00:00.000Z",
        deepLinkUrl: "https://frapp.live/events/123",
      };

      const result = buildIcsContent(input);

      expect(result).toContain("SUMMARY:Meeting: Part 1\\; Part 2");
      expect(result).toContain("DESCRIPTION:Notes:\\n1. Bring laptop\\n2. Be there\\nhttps://frapp.live/events/123");
      expect(result).toContain("LOCATION:123 Main St\\, New York\\, NY");
      expect(result).toContain("UID:20240215T140000Z-Meeting: Part 1\\; Part 2@frapp.live");
    });
  });

  describe("exportEventToCalendar", () => {
    let mockAnchor: any;

    beforeEach(() => {
      vi.resetModules();
      vi.clearAllMocks();

      // Setup for document.createElement in web
      mockAnchor = {
        click: vi.fn(),
        remove: vi.fn(),
        style: {},
      };

      global.document = {
        createElement: vi.fn().mockReturnValue(mockAnchor),
        body: {
          append: vi.fn(),
        },
      } as any;

      const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
      const revokeObjectURL = vi.fn();
      // Need to assign it to global object properly for Node/Vitest
      global.URL = Object.assign(URL || {}, {
        createObjectURL,
        revokeObjectURL,
      }) as any;

      global.Blob = vi.fn() as any;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      delete (global as any).document;
      // Note: we can't easily delete global.URL since it's a built-in getter in newer Node
    });

    it("downloads calendar on web platform", async () => {
      const { Platform } = await import("react-native");
      Platform.OS = "web";

      const { exportEventToCalendar } = await import("./calendar-export");

      const input = {
        title: "Web Event",
        description: "Desc",
        location: "Loc",
        startAtIso: "2024-02-15T14:00:00.000Z",
        endAtIso: "2024-02-15T15:00:00.000Z",
        deepLinkUrl: "https://frapp.live/events/123",
      };

      const result = await exportEventToCalendar(input);

      expect(result).toBe(true);
      expect(global.document.createElement).toHaveBeenCalledWith("a");
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(mockAnchor.remove).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    });

    it("saves and shares calendar on native platform", async () => {
      const { Platform } = await import("react-native");
      Platform.OS = "ios";

      const FileSystem = await import("expo-file-system/legacy");
      const Sharing = await import("expo-sharing");
      const { exportEventToCalendar } = await import("./calendar-export");

      const input = {
        title: "Native Event",
        description: "Desc",
        location: "Loc",
        startAtIso: "2024-02-15T14:00:00.000Z",
        endAtIso: "2024-02-15T15:00:00.000Z",
        deepLinkUrl: "https://frapp.live/events/123",
      };

      const result = await exportEventToCalendar(input);

      expect(result).toBe(true);
      expect(FileSystem.writeAsStringAsync).toHaveBeenCalled();
      expect(Sharing.shareAsync).toHaveBeenCalled();
    });

    it("returns false if Sharing is not available", async () => {
      const { Platform } = await import("react-native");
      Platform.OS = "ios";

      const Sharing = await import("expo-sharing");
      // @ts-expect-error mocking
      Sharing.isAvailableAsync.mockResolvedValueOnce(false);

      const { exportEventToCalendar } = await import("./calendar-export");

      const input = {
        title: "Native Event",
        description: "Desc",
        location: "Loc",
        startAtIso: "2024-02-15T14:00:00.000Z",
        endAtIso: "2024-02-15T15:00:00.000Z",
        deepLinkUrl: "https://frapp.live/events/123",
      };

      const result = await exportEventToCalendar(input);

      expect(result).toBe(false);
    });

    it("returns false if directory is not available", async () => {
      const { Platform } = await import("react-native");
      Platform.OS = "ios";

      const FileSystem = await import("expo-file-system/legacy");
      // @ts-expect-error mocking
      FileSystem.cacheDirectory = null;
      // @ts-expect-error mocking
      FileSystem.documentDirectory = null;

      const { exportEventToCalendar } = await import("./calendar-export");

      const input = {
        title: "Native Event",
        description: "Desc",
        location: "Loc",
        startAtIso: "2024-02-15T14:00:00.000Z",
        endAtIso: "2024-02-15T15:00:00.000Z",
        deepLinkUrl: "https://frapp.live/events/123",
      };

      const result = await exportEventToCalendar(input);

      expect(result).toBe(false);

      // restore
      // @ts-expect-error mocking
      FileSystem.cacheDirectory = "file:///cache/";
      // @ts-expect-error mocking
      FileSystem.documentDirectory = "file:///document/";
    });

    it("returns false on error during export", async () => {
      const { Platform } = await import("react-native");
      Platform.OS = "ios";

      const FileSystem = await import("expo-file-system/legacy");
      // @ts-expect-error mocking
      FileSystem.writeAsStringAsync.mockRejectedValueOnce(new Error("File system error"));

      const { exportEventToCalendar } = await import("./calendar-export");

      const input = {
        title: "Native Event",
        description: "Desc",
        location: "Loc",
        startAtIso: "2024-02-15T14:00:00.000Z",
        endAtIso: "2024-02-15T15:00:00.000Z",
        deepLinkUrl: "https://frapp.live/events/123",
      };

      const result = await exportEventToCalendar(input);

      expect(result).toBe(false);
    });
  });
});
