import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Server = { name: string; url: string; headers: Record<string, string>; config: string };
export type Trouble = { server: string; reason: string; detail?: string; config?: string };
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
// The project's own file first, so a repository can name a server of its own and
// shadow one of the operator's under the same name. Then this program's own,
// ahead of the two it borrows: a server written into lm's file was written for
// lm, and one written for another agent is being read here on sufferance.
export function configPaths(cwd: string, home: string): string[] {
  return [
    join(cwd, ".mcp.json"),
    join(home, ".lm", ".mcp.json"),
    join(home, ".claude.json"),
    join(home, ".gemini", "settings.json"),
  ];
}

// All four files key the object alike and spell one entry two ways: `url`
// beside `"type": "http"`, or `httpUrl` on its own. A server with neither is a
// subprocess, which this speaks nothing of, and it is named rather than dropped:
// a configured server missing from the line reads as a server that failed. A
// file that will not parse is passed over and the rest of the chain still reads,
// because one agent's broken settings must not cost the others theirs. Each
// entry carries the file that declared it, which is the file to edit.
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
        skipped.set(name, { server: name, reason: "not an HTTP server", config: path });
        continue;
      }
      const declaredHeaders = entry?.headers ?? {};
      const headers = Object.fromEntries(
        Object.entries(declaredHeaders).filter(([, v]) => typeof v === "string") as [string, string][],
      );
      servers.set(name, { name, url, headers, config: path });
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
  if (!res.ok) throw refused(res, await res.text().catch(() => ""));
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

// A refusal says two things and the launch has room for one. The short half is
// what the startup line prints; the long half is the status line the server sent
// and whatever it put in the body, which is where a server says which scope is
// missing or which token expired. Only `/mcp` shows it, and it is capped,
// because a server may answer a rejection with a web page.
const BODY_LIMIT = 2000;

function refused(res: { status: number; statusText: string }, body: string): Error {
  const said = [`${res.status} ${res.statusText}`.trim(), body.trim().slice(0, BODY_LIMIT)];
  return Object.assign(new Error(`answered ${res.status}`), { detail: said.filter((p) => p).join("\n") });
}

function reason(error: any): string {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "did not answer in time";
  return String(error?.cause?.code ?? error?.message ?? error);
}

// What the reason left out. A failure with nothing further to say has none, and
// the detail view then shows the reason alone rather than an empty heading.
function detail(error: any): string | undefined {
  const said = [error?.detail, error?.cause?.message, error?.message].find((s) => typeof s === "string" && s);
  return said && said !== reason(error) ? String(said) : undefined;
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
      return { server: server.name, reason: reason(error), detail: detail(error) };
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

// ---- What the operator does about a server that is not working -------------

// A server switched off has to stay off across restarts, and none of the four
// files is this program's to write: three belong to other agents and the fourth
// is the operator's own text, where a name deleted by lm would read as a name
// they lost. So the decision goes in a file of lm's own, beside the run log,
// which is already what `~/.lm/` holds.
export const statePath = (home: string): string => join(home, ".lm", "mcp-state.json");

export function readDisabled(path: string): string[] {
  try {
    const names = JSON.parse(readFileSync(path, "utf8"))?.disabled;
    return Array.isArray(names) ? names.filter((n: unknown) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

export function writeDisabled(path: string, names: Iterable<string>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ disabled: [...names].sort() }, null, 2)}\n`);
}

// Everything one screen can say about one server without asking it anything
// again. `headers` is the names and whether each was filled in, never a value:
// this is where an API key would be drawn, and it is the one place it must not
// be. `tools` is undefined for a server that was not reached, which is not the
// same claim as a server that answered with none.
export type Entry = {
  name: string;
  url: string;
  config: string;
  headers: string[];
  status: string;
  tools: number | undefined;
  disabled: boolean;
  detail: string | undefined;
};

const CONNECTED = "connected";
const DISABLED = "disabled";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the model was actually given, counted off the names it holds rather than
// off what the server offered: a tool whose name was already taken is not there.
const held = (registered: Iterable<string>, server: string): number =>
  [...registered].filter((n) => n.startsWith(toolName(server, ""))).length;

export function entries(
  declared: { servers: Server[]; skipped: Trouble[] },
  found: { served: Served[]; trouble: Trouble[] },
  registered: Iterable<string> = [],
  disabled: Iterable<string> = [],
  paths: string[] = [],
): Entry[] {
  const off = new Set(disabled);
  const failed = new Map([...found.trouble].map((t) => [t.server, t]));
  const answered = new Set(found.served.map((s) => s.server.name));
  const rows: Entry[] = declared.servers.map((server) => ({
    name: server.name,
    url: server.url,
    config: server.config,
    headers: Object.entries(server.headers).map(([k, v]) => `${k} (${v ? "set" : "empty"})`),
    status: off.has(server.name) ? DISABLED : (failed.get(server.name)?.reason ?? CONNECTED),
    tools: off.has(server.name) || !answered.has(server.name) ? undefined : held(registered, server.name),
    disabled: off.has(server.name),
    detail: failed.get(server.name)?.detail,
  }));
  const rest: Entry[] = declared.skipped.map((t) => ({
    name: t.server,
    url: "",
    config: t.config ?? "",
    headers: [],
    status: off.has(t.server) ? DISABLED : t.reason,
    tools: undefined,
    disabled: off.has(t.server),
    detail: t.detail,
  }));
  // Grouped in the order the chain reads the files, not the order the servers
  // came out of it: a file holding nothing but subprocess servers still belongs
  // where the operator's own precedence puts it.
  const all = [...rows, ...rest];
  const order = [...paths, ...all.map((e) => e.config)];
  return all.sort((a, b) => order.indexOf(a.config) - order.indexOf(b.config));
}

// One server on one line: what it is called, whether it answered, and what the
// model got out of it. The count is printed for every server that answered,
// zero included, because a server whose tools went missing and one that offered
// none read alike when the zero is left out.
export const row = (e: Entry): string =>
  [e.name, e.status, e.tools === undefined ? "" : plural(e.tools, "tool")].filter((p) => p).join(" · ");

export const listTitle = (all: Entry[]): string => `Manage MCP servers\n${plural(all.length, "server")}`;

// Grouped by the file that declared them, with the path in the heading, because
// the first thing a server that is not working costs the operator is finding out
// which of four files to edit. The heading is indented and the servers are not,
// so the eye lands on the names.
export function listRows(all: Entry[]): string[] {
  const rows: string[] = [];
  let group: string | undefined;
  for (const entry of all) {
    if (entry.config !== group) rows.push(`  ${(group = entry.config)}`);
    rows.push(row(entry));
  }
  return rows;
}

// The one screen with room for the whole of what the server said. The startup
// line has a clause; this has the status line and the body, which is where a
// server names the scope that is missing or the token that expired.
export function detailBlock(e: Entry): string {
  const named: [string, string][] = [
    ["Status", e.tools === undefined ? e.status : `${e.status} · ${plural(e.tools, "tool")}`],
    ...(e.url ? ([["URL", e.url]] as [string, string][]) : []),
    ["Config", e.config],
    ["Headers", e.headers.length > 0 ? e.headers.join(", ") : "none"],
  ];
  const width = Math.max(...named.map(([n]) => n.length));
  return [
    e.name,
    "",
    ...named.map(([n, v]) => `${n.padEnd(width)}  ${v}`),
    ...(e.detail ? ["", e.detail] : []),
  ].join("\n");
}

// What the launch left behind, so `/mcp` can act on it rather than describe it.
// Every field but the first three is what the command changes: a reconnect
// replaces this server's records and its tools, and disabling it writes a file.
export type Console = {
  pi: any;
  servers: Server[];
  skipped: Trouble[];
  found: { served: Served[]; trouble: Trouble[] };
  taken: Set<string>;
  registered: Set<string>;
  disabled: Set<string>;
  paths: string[];
  state: string;
  allowNetwork: boolean;
};

const RECONNECT = "Reconnect";
const DISABLE = "Disable";
const ENABLE = "Enable";
const BACK = "Back";

const shown = (c: Console): Entry[] =>
  entries({ servers: c.servers, skipped: c.skipped }, c.found, c.registered, c.disabled, c.paths);

// Asked again, now, with its tools replaced rather than added to: the harness
// keys tools by name, so the second registration under a name this server
// already holds would be refused as a collision with itself.
async function reconnect(c: Console, name: string): Promise<string> {
  const server = c.servers.find((s) => s.name === name);
  if (!server) return `mcp: ${name} declares no HTTP URL, so there is nothing to ask.`;
  for (const held of [...c.registered]) {
    if (held.startsWith(toolName(name, ""))) {
      c.registered.delete(held);
      c.taken.delete(held);
    }
  }
  const one = await discover([server], {
    allowNetwork: c.allowNetwork,
    signal: AbortSignal.timeout(MCP_DEADLINE_MS),
  });
  c.found.served = [...c.found.served.filter((s) => s.server.name !== name), ...one.served];
  c.found.trouble = [...c.found.trouble.filter((t) => t.server !== name), ...one.trouble];
  for (const added of registerServers(c.pi, one.served, c.taken).registered) {
    c.taken.add(added);
    c.registered.add(added);
  }
  return `mcp: ${row(shown(c).find((e) => e.name === name)!)}`;
}

// Off now and off at the next launch. The file is the half that survives; the
// harness has no way to unregister a tool, so this session's half is done by
// taking the names out of the active set.
function disable(c: Console, name: string): string {
  c.disabled.add(name);
  writeDisabled(c.state, c.disabled);
  try {
    const prefix = toolName(name, "");
    c.pi.setActiveTools(c.pi.getActiveTools().filter((n: string) => !n.startsWith(prefix)));
  } catch {
    // The next launch does not ask it either way.
  }
  return `mcp: ${name} disabled, in this session and at the next launch.`;
}

// Registered on the extension the way a verb is, so `/mcp` is in the same list
// the operator reads `/model` and `/thinking` out of. A session with no dialog
// has nothing to select with, and the grouped list is the whole of what it can
// be told, so that is what it gets.
export function registerConsole(pi: any, c: Console): void {
  pi.registerCommand("mcp", {
    description: "the MCP servers you have configured, and what to do about one that is not answering",
    handler: async (_args: string, ctx: any) => {
      if (!ctx.hasUI) {
        const all = shown(c);
        ctx.ui.notify([listTitle(all), ...listRows(all)].join("\n"), "info");
        return;
      }
      for (;;) {
        const all = shown(c);
        const picked = await ctx.ui.select(listTitle(all), listRows(all));
        if (picked === undefined) return;
        // A heading names a file rather than a server, and selecting one is the
        // operator arriving at the row below it.
        const entry = all.find((e) => row(e) === picked);
        if (!entry) continue;
        const action = await ctx.ui.select(
          detailBlock(entry),
          entry.disabled ? [ENABLE, BACK] : [RECONNECT, DISABLE, BACK],
        );
        if (action === RECONNECT) ctx.ui.notify(await reconnect(c, entry.name), "info");
        if (action === DISABLE) ctx.ui.notify(disable(c, entry.name), "info");
        if (action === ENABLE) {
          c.disabled.delete(entry.name);
          writeDisabled(c.state, c.disabled);
          ctx.ui.notify(await reconnect(c, entry.name), "info");
        }
      }
    },
  });
}
