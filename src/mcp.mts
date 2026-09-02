import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Server = { name: string; url: string; headers: Record<string, string> };
export type Trouble = { server: string; reason: string };
export type Wire = { url: string; headers: Record<string, string>; protocol: string; session?: string };
export type Served = { server: Server; wire: Wire; tools: any[] };

// What this client asks for. The server answers with the same string when it
// speaks it and with one of its own when it does not, and that answer is what
// every later request carries.
const PROTOCOL = "2025-06-18";

// The launch waits on one round trip per server, and a host that accepts a
// connection and never answers would hold the chat closed for as long as it
// stays silent. `initialize` and `tools/list` against mcp.context7.com measured
// 745 ms cold and 225 ms warm over five runs on 2026-09-02.
export const MCP_DEADLINE_MS = 3000;

// Where a server is declared, in the order that decides which declaration wins.
// The project's own file first, then the operator's two, so a repository can
// name a server of its own and shadow one of theirs under the same name.
export function configPaths(cwd: string, home: string): string[] {
  return [join(cwd, ".mcp.json"), join(home, ".claude.json"), join(home, ".gemini", "settings.json")];
}

// All three files key the object alike and spell one entry two ways: `url`
// beside `"type": "http"`, or `httpUrl` on its own. A server with neither is a
// subprocess, which this speaks nothing of, and it is named rather than dropped:
// a configured server missing from the line reads as a server that failed.
export function readServers(paths: string[]): { servers: Server[]; skipped: Trouble[] } {
  const servers = new Map<string, Server>();
  const skipped = new Map<string, Trouble>();
  for (const path of paths) {
    let declared: Record<string, any>;
    try {
      declared = JSON.parse(readFileSync(path, "utf8"))?.mcpServers ?? {};
    } catch {
      continue;
    }
    for (const [name, entry] of Object.entries(declared)) {
      if (servers.has(name) || skipped.has(name)) continue;
      const url = [entry?.httpUrl, entry?.url].find((u) => typeof u === "string" && /^https?:/.test(u));
      if (!url) {
        skipped.set(name, { server: name, reason: "not an HTTP server" });
        continue;
      }
      const declaredHeaders = entry?.headers ?? {};
      const headers = Object.fromEntries(
        Object.entries(declaredHeaders).filter(([, v]) => typeof v === "string") as [string, string][],
      );
      servers.set(name, { name, url, headers });
    }
  }
  return { servers: [...servers.values()], skipped: [...skipped.values()] };
}

// One POST per message, which is the whole of the client's side of Streamable
// HTTP. The reply is either one JSON object or an SSE stream carrying the same
// object in a `data:` frame, and the server picks; both have to be read. The
// operator's own headers go on first so the three the transport requires cannot
// be overwritten by a stale copy of one.
async function post(wire: Wire, body: unknown, signal?: AbortSignal) {
  const res = await fetch(wire.url, {
    method: "POST",
    headers: {
      ...wire.headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": wire.protocol,
      ...(wire.session ? { "mcp-session-id": wire.session } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  const text = await res.text();
  const frames = res.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [text.trim()];
  return {
    session: res.headers.get("mcp-session-id") ?? undefined,
    replies: frames.filter((f) => f.length > 0).map((f) => JSON.parse(f)),
  };
}

// A request carries an id and gets exactly one reply back, on its own
// connection. The error is the server's own words: it says what a document
// cannot, and it is what the line on screen shows the operator.
async function ask(wire: Wire, method: string, params: unknown, signal?: AbortSignal) {
  const { replies, session } = await post(wire, { jsonrpc: "2.0", id: 1, method, params }, signal);
  const reply = replies.find((r) => r?.id === 1);
  if (!reply) throw new Error(`${method} answered nothing`);
  if (reply.error) throw new Error(String(reply.error.message ?? `${method} failed`));
  return { result: reply.result, session };
}

// The handshake, in the order the protocol fixes: `initialize`, then the
// notification saying the client is ready. A server may hand back a session id
// on the first reply, and every later request must carry it; one that hands
// back none is stateless and mcp.context7.com is.
export async function connect(server: Server, signal?: AbortSignal): Promise<Wire> {
  const wire: Wire = { url: server.url, headers: server.headers, protocol: PROTOCOL };
  const { result, session } = await ask(
    wire,
    "initialize",
    { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "lm", version: "0" } },
    signal,
  );
  wire.session = session;
  if (typeof result?.protocolVersion === "string") wire.protocol = result.protocolVersion;
  await post(wire, { jsonrpc: "2.0", method: "notifications/initialized" }, signal);
  return wire;
}

function reason(error: any): string {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "did not answer in time";
  return String(error?.cause?.code ?? error?.message ?? error);
}

// What every configured server offers, asked all at once so the launch waits on
// the slowest rather than the sum. A server that cannot be reached costs its own
// entry in the report and nothing else: the chat opens either way, which is the
// whole reason this is not thrown.
export async function discover(
  servers: Server[],
  context: { allowNetwork?: boolean; signal?: AbortSignal } = {},
): Promise<{ served: Served[]; trouble: Trouble[] }> {
  if (context.allowNetwork === false) {
    return { served: [], trouble: servers.map((s) => ({ server: s.name, reason: "offline" })) };
  }
  const results = await Promise.all(servers.map(async (server): Promise<Served | Trouble> => {
    try {
      const wire = await connect(server, context.signal);
      const { result } = await ask(wire, "tools/list", {}, context.signal);
      const tools = (result?.tools ?? []).filter((t: any) => typeof t?.name === "string");
      return { server, wire, tools };
    } catch (error) {
      return { server: server.name, reason: reason(error) };
    }
  }));
  return {
    served: results.filter((r): r is Served => "wire" in r),
    trouble: results.filter((r): r is Trouble => "reason" in r),
  };
}

// The name the model calls. Every one of these begins `mcp__`, which is what
// keeps a server's tool out of the space the harness's own eight and this
// repository's verbs are named in: a server offering `bash` gets a name of its
// own rather than the one the harness answers to. It is the scheme the operator
// already reads in the agent this replaces.
export const toolName = (server: string, tool: string): string => `mcp__${server}__${tool}`;

// A tool result is a list of content blocks, and text is the only kind a chat
// can put in front of the model. `isError` is the server saying the call itself
// went wrong, which is not a transport failure and does not read like one.
function said(result: any): string {
  const text = (result?.content ?? [])
    .filter((c: any) => c?.type === "text")
    .map((c: any) => String(c.text))
    .join("\n")
    .trim();
  const body = text || JSON.stringify(result?.structuredContent ?? result?.content ?? result);
  return result?.isError ? `The tool reported an error.\n\n${body}` : body;
}

// Registered the way a verb is, so the chat's model sees one list. A name
// already claimed is reported rather than taken: the harness keys its tools by
// name and a second registration would replace the first in silence.
export function registerServers(
  pi: any,
  served: Served[],
  taken: Iterable<string> = [],
): { registered: string[]; trouble: Trouble[] } {
  const claimed = new Set(taken);
  const registered: string[] = [];
  const trouble: Trouble[] = [];
  for (const { server, wire, tools } of served) {
    for (const tool of tools) {
      const name = toolName(server.name, tool.name);
      if (claimed.has(name)) {
        trouble.push({ server: server.name, reason: `${name} is taken` });
        continue;
      }
      claimed.add(name);
      registered.push(name);
      pi.registerTool({
        name,
        label: name,
        description: String(tool.description ?? tool.title ?? name),
        promptSnippet: String(tool.description ?? tool.title ?? name),
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
        execute: async (_id: string, params: any, signal: AbortSignal | undefined) => {
          let text: string;
          try {
            const { result } = await ask(wire, "tools/call", { name: tool.name, arguments: params ?? {} }, signal);
            text = said(result);
          } catch (error) {
            text = `${server.name} could not be asked: ${reason(error)}`;
          }
          return { content: [{ type: "text", text }], details: undefined };
        },
      });
    }
  }
  return { registered, trouble };
}
