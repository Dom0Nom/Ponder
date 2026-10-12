import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import { api } from "../ipc";
import type { McpServer, McpTool, ToolCallMeta } from "../types";

export const MCP_KEY = "mcp.servers";
const MAX_TOOLS = 100;

export function mcpServers(settings: Record<string, unknown> | undefined): McpServer[] {
  const raw = settings?.[MCP_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof x.id === "string" && (typeof x.command === "string" || typeof x.url === "string"))
    .map((x) => {
      const url = typeof x.url === "string" && x.url.trim() ? x.url.trim() : undefined;
      const command = typeof x.command === "string" ? x.command : "";
      return {
        id: x.id as string,
        name: typeof x.name === "string" && x.name.trim() ? x.name.trim() : (url ? hostOf(url) : command),
        command,
        args: Array.isArray(x.args) ? x.args.filter((a): a is string => typeof a === "string") : [],
        ...(url ? { url } : {}),
        enabled: x.enabled !== false,
      };
    });
}

export const isUrl = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Splits a command line on spaces, honouring quotes and backslashes. No variable or ~ expansion. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else cur += c;
  }
  if (has || cur) out.push(cur);
  return out;
}

export const joinCommand = (parts: string[]) => parts.map((p) => (p && /^[\w./:@%+=,~-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(" ");

/** Name the model sees: [A-Za-z0-9_-], at most 64 characters, unique within the turn. */
export function toolKey(server: string, tool: string, taken: Set<string>): string {
  const clean = (x: string) => x.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  const base = `${clean(server).slice(0, 20) || "mcp"}__${clean(tool) || "tool"}`.slice(0, 60);
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  taken.add(key);
  return key;
}

function objectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const s = schema && typeof schema === "object" ? schema : {};
  return { ...s, type: "object", properties: (s.properties as object | undefined) ?? {} };
}

export interface McpToolSet {
  tools: ToolSet;
  /** servers whose tools couldn't be loaded */
  failed: { name: string; error: string }[];
}

/** Turns the enabled servers' tools into AI SDK tools; `onCall` hears about every call. */
export async function mcpToolSet(servers: McpServer[], onCall: (c: ToolCallMeta) => void): Promise<McpToolSet> {
  const tools: ToolSet = {};
  const failed: McpToolSet["failed"] = [];
  const taken = new Set<string>();
  const lists = await Promise.all(
    servers
      .filter((x) => x.enabled)
      .map(async (srv): Promise<[McpServer, McpTool[]]> => {
        try {
          return [srv, await api.mcpTools(srv)];
        } catch (e) {
          failed.push({ name: srv.name, error: (e as Error).message ?? String(e) });
          return [srv, []];
        }
      }),
  );
  for (const [srv, list] of lists) {
    for (const t of list) {
      if (taken.size >= MAX_TOOLS) break;
      tools[toolKey(srv.name, t.name, taken)] = dynamicTool({
        description: `${t.description || t.name} (tool from ${srv.name})`,
        inputSchema: jsonSchema(objectSchema(t.inputSchema)),
        execute: async (input) => {
          try {
            const r = await api.mcpCall(srv, t.name, input ?? {});
            onCall({ server: srv.name, tool: t.name, ok: !r.isError });
            return r.isError ? `The tool reported an error: ${r.text}` : r.text;
          } catch (e) {
            onCall({ server: srv.name, tool: t.name, ok: false });
            return `The tool failed: ${(e as Error).message ?? String(e)}`;
          }
        },
      });
    }
  }
  return { tools, failed };
}
