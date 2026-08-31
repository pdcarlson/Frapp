import { describe, expect, it } from "vitest";
import { parseExportPreamble } from "./discord-export";

describe("parseExportPreamble", () => {
  it("reads guild and channel out of a head object", () => {
    const head = JSON.stringify({
      guild: { id: "700", name: "Tau Nu Chapter" },
      channel: { id: "800", name: "general", category: "General" },
      messages: [],
    });

    const preamble = parseExportPreamble(head);

    expect(preamble?.channel.id).toBe("800");
    expect(preamble?.channel.name).toBe("general");
    expect(preamble?.channel.category).toBe("General");
    expect(preamble?.guild.name).toBe("Tau Nu Chapter");
  });

  it('is not fooled by the word "messages" inside channel.topic', () => {
    // A naive `indexOf('"messages"')` cut truncates mid-object on a topic
    // that happens to contain the word, and yields nothing.
    const head = JSON.stringify({
      guild: { id: "700", name: "Tau Nu Chapter" },
      channel: {
        id: "800",
        name: "general",
        category: "General",
        topic: 'chapter chat — read the "messages" pinned above',
      },
      messages: [],
    });

    expect(head).toContain('\\"messages\\" pinned above');
    expect(parseExportPreamble(head)?.channel.name).toBe("general");
  });

  it('survives a channel literally named "messages"', () => {
    // The failure the naive `indexOf('"messages"')` produces on real data: the
    // cut lands inside `"name":"messages"`, the parse fails, and that channel
    // silently vanishes from the mapping step — its entire history then
    // skipped with a warning buried in a list.
    const head = JSON.stringify({
      guild: { id: "1", name: "G" },
      channel: { id: "800", name: "messages", category: "General" },
      messages: [],
    });

    expect(parseExportPreamble(head)?.channel.name).toBe("messages");
    expect(parseExportPreamble(head)?.channel.id).toBe("800");
  });

  it('survives a category named "messages" too', () => {
    const head = JSON.stringify({
      guild: { id: "1", name: "G" },
      channel: { id: "800", name: "general", category: "messages" },
      messages: [],
    });

    expect(parseExportPreamble(head)?.channel.id).toBe("800");
  });

  it("returns null for something that is not an export", () => {
    expect(parseExportPreamble('{"hello":"world"}')).toBeNull();
    expect(parseExportPreamble("not json at all")).toBeNull();
  });
});
