import { describe, expect, it, vi } from "vitest";
import { joinCommand, mcpServers, mcpToolSet, splitCommand, toolKey } from "./client";
import { api } from "../ipc";

vi.mock("../ipc", () => ({ api: { mcpTools: vi.fn(), mcpCall: vi.fn() } }));

describe("splitCommand", () => {
  it("splits on spaces and keeps quoted parts together", () => {
    expect(splitCommand(`npx -y "@scope/server x" '/Users/me/My Notes' a\\ b ""`)).toEqual(["npx", "-y", "@scope/server x", "/Users/me/My Notes", "a b", ""]);
  });
  it("round-trips through joinCommand", () => {
    const parts = ["uvx", "mcp-server", "--dir", "/tmp/it's here", ""];
    expect(splitCommand(joinCommand(parts))).toEqual(parts);
  });
});

describe("toolKey", () => {
  it("cleans names and keeps them unique", () => {
    const taken = new Set<string>();
    expect(toolKey("My Notes!", "search.files", taken)).toBe("My_Notes__search_files");
    expect(toolKey("My Notes!", "search.files", taken)).toBe("My_Notes__search_files_2");
    expect(toolKey("", "", taken)).toBe("mcp__tool");
    expect(toolKey("x".repeat(40), "y".repeat(80), taken).length).toBeLessThanOrEqual(64);
  });
});

describe("mcpServers", () => {
  it("reads valid entries and defaults the rest", () => {
    expect(mcpServers({ "mcp.servers": [{ id: "a", command: "npx", args: ["-y", 3] }, { id: 1 }, null] })).toEqual([
      { id: "a", name: "npx", command: "npx", args: ["-y"], enabled: true },
    ]);
    expect(mcpServers({})).toEqual([]);
  });
});

describe("mcpToolSet", () => {
  it("skips disabled servers, reports failing ones and records calls", async () => {
    vi.mocked(api.mcpTools).mockImplementation(async (srv) => {
      if (srv.id === "bad") throw new Error("not found");
      return [{ name: "lookup", description: "Look up", inputSchema: { type: "object", properties: { term: { type: "string" } } } }];
    });
    vi.mocked(api.mcpCall).mockResolvedValue({ text: "osmosis: water", isError: false });
    const calls: unknown[] = [];
    const servers = [
      { id: "g", name: "Glossary", command: "g", args: [], enabled: true },
      { id: "bad", name: "Broken", command: "b", args: [], enabled: true },
      { id: "off", name: "Off", command: "o", args: [], enabled: false },
    ];
    const set = await mcpToolSet(servers, (c) => calls.push(c));
    expect(Object.keys(set.tools)).toEqual(["Glossary__lookup"]);
    expect(set.failed).toEqual([{ name: "Broken", error: "not found" }]);
    expect(api.mcpTools).toHaveBeenCalledTimes(2);
    const out = await set.tools.Glossary__lookup.execute!({ term: "osmosis" }, { toolCallId: "1", messages: [] } as never);
    expect(out).toBe("osmosis: water");
    expect(calls).toEqual([{ server: "Glossary", tool: "lookup", ok: true }]);
    vi.mocked(api.mcpCall).mockRejectedValue(new Error("boom"));
    expect(await set.tools.Glossary__lookup.execute!({}, { toolCallId: "2", messages: [] } as never)).toBe("The tool failed: boom");
    expect(calls.at(-1)).toEqual({ server: "Glossary", tool: "lookup", ok: false });
  });
});
