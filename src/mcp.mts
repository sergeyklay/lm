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


// A file that declared servers, and then the servers it declared. The heading
// is not a row: the operator cannot stand on it and there is nothing to do to a
// file from here. It exists because the first thing a server that is not working
// costs them is finding out which of four files to edit.
export type Item = { heading: string } | { entry: Entry };

export function listItems(all: Entry[]): Item[] {
  const items: Item[] = [];
  let group: string | undefined;
  for (const entry of all) {
    if (entry.config !== group) items.push({ heading: (group = entry.config) });
    items.push({ entry });
  }
  return items;
}

// The same grouping without a terminal to draw it on, which is all a session
// with no dialog can be told.
export const listRows = (all: Entry[]): string[] =>
  listItems(all).map((item) => ("entry" in item ? row(item.entry) : `  ${item.heading}`));

// ---- What the screen draws with --------------------------------------------

// The theme's own two calls and nothing else, so a colour is asked for by the
// name the theme knows it under and a terminal without truecolor gets that
// theme's approximation rather than an RGB value it cannot show. A test passes a
// marker in place of each, which is how a rendered line can be read back for
// which spans are bold and which colour carries the state.
export type Paint = { fg: (color: string, text: string) => string; bold: (text: string) => string };

export const PLAIN: Paint = { fg: (_color, text) => text, bold: (text) => text };

// What the keyboard is bound to, which is the harness's own manager: the screen
// asks it what a keystroke means rather than comparing bytes, so a rebound key
// works here and the hint says the key that is actually bound.
export type Keys = { matches: (data: string, binding: string) => boolean; getKeys: (binding: string) => string[] };

const UP = "tui.select.up";
const DOWN = "tui.select.down";
const CONFIRM = "tui.select.confirm";
const CANCEL = "tui.select.cancel";

// Three states, and the words are not the only thing that separates them: a
// server that answered, one that refused, and one switched off must be
// distinguishable to someone reading the column rather than the sentence.
export const tone = (e: Entry): string => (e.disabled ? "dim" : e.status === CONNECTED ? "success" : "error");

// A value wider than the terminal is wrapped, never cut: the whole of what a
// refusing server said is the reason this screen exists, and the scope it names
// as missing is as likely to be at the end of the line as the start.
export function fold(text: string, width: number): string[] {
  const room = Math.max(1, width);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let rest = paragraph;
    do {
      if (rest.length <= room) {
        lines.push(rest);
        break;
      }
      const space = rest.lastIndexOf(" ", room);
      const take = space > 0 ? space : room;
      lines.push(rest.slice(0, take));
      rest = rest.slice(space > 0 ? take + 1 : take);
    } while (true);
  }
  return lines;
}

const GUTTER = 2;

// The label is what the eye scans for and the value is what it stops on, so the
// weight goes on the label alone. A wrapped value hangs under itself rather than
// under the label, or the second line reads as another value.
function labelled(name: string, value: string, colour: string, paint: Paint, width: number, pad: number): string[] {
  const head = pad + GUTTER;
  return fold(value, width - head).map((line, i) =>
    (i === 0 ? paint.bold(name) + " ".repeat(head - name.length) : " ".repeat(head)) + paint.fg(colour, line));
}

const hint = (keys: Keys, binding: string, what: string, paint: Paint): string =>
  paint.fg("dim", keys.getKeys(binding).join("/")) + paint.fg("muted", ` ${what}`);

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
async function reconnect(c: Console, name: string): Promise<void> {
  const server = c.servers.find((s) => s.name === name);
  if (!server) return;
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
}

// Off now and off at the next launch. The file is the half that survives; the
// harness has no way to unregister a tool, so this session's half is done by
// taking the names out of the active set.
function disable(c: Console, name: string): void {
  c.disabled.add(name);
  writeDisabled(c.state, c.disabled);
  try {
    const prefix = toolName(name, "");
    c.pi.setActiveTools(c.pi.getActiveTools().filter((n: string) => !n.startsWith(prefix)));
  } catch {
    // The next launch does not ask it either way.
  }
}

// What the act did, read off the server's state after it rather than off the
// call that made it, so an act that changed nothing says the thing that did not
// change. The operator pressed a key and must learn what came of it.
export const outcome = (verb: string, e: Entry): string =>
  e.status === CONNECTED
    ? `${verb}: ${e.name} answered, ${plural(e.tools ?? 0, "tool")}.`
    : `${verb}: ${e.name} ${e.status}.`;

// ---- The screen ------------------------------------------------------------

// One component for both views, because the second is where the first's actions
// land: a reconnect redraws the panel it was pressed on, with the status it just
// read and a line saying what came of it. Sending that to a notice instead would
// put it where the harness overwrites the previous one, which is how an act that
// worked came to read as an act that did nothing.
export class ConsoleScreen {
  private view: "list" | "detail" = "list";
  private cursor: number;
  private name = "";
  private choice = 0;
  private note: { text: string; colour: string } | undefined;
  private busy = false;

  private readonly c: Console;
  private readonly paint: Paint;
  private readonly keys: Keys;
  private readonly done: (result: undefined) => void;
  private readonly repaint: () => void;

  constructor(
    c: Console,
    paint: Paint,
    keys: Keys,
    done: (result: undefined) => void,
    repaint: () => void = () => {},
  ) {
    this.c = c;
    this.paint = paint;
    this.keys = keys;
    this.done = done;
    this.repaint = repaint;
    this.cursor = this.items().findIndex((item) => "entry" in item);
  }

  private items(): Item[] {
    return listItems(shown(this.c));
  }

  private standing(): Entry | undefined {
    const item = this.items()[this.cursor];
    return item && "entry" in item ? item.entry : undefined;
  }

  // By name rather than by index, because the act the operator just took may
  // have moved what the row says.
  private opened(): Entry | undefined {
    return shown(this.c).find((e) => e.name === this.name);
  }

  // A server with no URL was never asked and cannot be, so it is not offered a
  // retry it has no way to run.
  private actions(e: Entry): string[] {
    if (e.disabled) return [ENABLE, BACK];
    return e.url ? [RECONNECT, DISABLE, BACK] : [DISABLE, BACK];
  }

  invalidate(): void {
    // Nothing is cached between renders.
  }

  render(width: number): string[] {
    const inner = Math.max(1, width - 1);
    const body = this.view === "list" ? this.listBody(inner) : this.detailBody(inner);
    const rule = this.paint.fg("border", "─".repeat(Math.max(1, width)));
    const indent = (line: string) => (line ? ` ${line}` : "");
    return [rule, "", ...body.map(indent), "", indent(this.hints()), "", rule];
  }

  private hints(): string {
    const back = this.view === "detail" ? "back" : "close";
    return [
      this.paint.fg("dim", "↑↓") + this.paint.fg("muted", " navigate"),
      hint(this.keys, CONFIRM, "select", this.paint),
      hint(this.keys, CANCEL, back, this.paint),
    ].join("  ");
  }

  private listBody(width: number): string[] {
    const items = this.items();
    const servers = items.filter((item): item is { entry: Entry } => "entry" in item);
    const pad = Math.max(0, ...servers.map((item) => item.entry.name.length));
    const lines = [
      this.paint.bold("Manage MCP servers"),
      this.paint.fg("dim", plural(servers.length, "server")),
      "",
    ];
    for (const [i, item] of items.entries()) {
      if (!("entry" in item)) {
        lines.push(this.paint.fg("dim", fold(item.heading, width)[0]));
        continue;
      }
      const e = item.entry;
      const here = i === this.cursor;
      const tools = e.tools === undefined ? "" : this.paint.fg("dim", ` · ${plural(e.tools, "tool")}`);
      lines.push(
        (here ? this.paint.fg("accent", "→ ") : "  ") +
          this.paint.fg(here ? "accent" : "text", e.name.padEnd(pad)) +
          " ".repeat(GUTTER) +
          this.paint.fg(tone(e), e.status) +
          tools,
      );
    }
    return lines;
  }

  private detailBody(width: number): string[] {
    const e = this.opened();
    if (!e) return [this.paint.fg("error", "This server is no longer declared.")];
    const named: [string, string, string][] = [
      ["Status", e.tools === undefined ? e.status : `${e.status} · ${plural(e.tools, "tool")}`, tone(e)],
      ...(e.url ? ([["URL", e.url, "text"]] as [string, string, string][]) : []),
      ["Config", e.config, "text"],
      ["Headers", e.headers.length > 0 ? e.headers.join(", ") : "none", "text"],
    ];
    const pad = Math.max(...named.map(([label]) => label.length));
    const lines = [this.paint.bold(e.name), ""];
    for (const [label, value, colour] of named) {
      lines.push(...labelled(label, value, colour, this.paint, width, pad));
    }
    if (e.detail) lines.push("", ...fold(e.detail, width).map((line) => this.paint.fg("dim", line)));
    lines.push("");
    for (const [i, action] of this.actions(e).entries()) {
      const here = i === this.choice;
      lines.push((here ? this.paint.fg("accent", "→ ") : "  ") + this.paint.fg(here ? "accent" : "text", action));
    }
    if (this.busy) lines.push("", this.paint.fg("dim", `Asking ${e.name}…`));
    else if (this.note) {
      lines.push("", ...fold(this.note.text, width).map((line) => this.paint.fg(this.note!.colour, line)));
    }
    return lines;
  }

  handleInput(data: string): void {
    if (this.busy) return;
    if (this.view === "list") return this.listInput(data);
    this.detailInput(data);
  }

  private listInput(data: string): void {
    if (this.keys.matches(data, UP)) this.step(-1);
    else if (this.keys.matches(data, DOWN)) this.step(1);
    else if (this.keys.matches(data, CANCEL)) this.done(undefined);
    else if (this.keys.matches(data, CONFIRM)) {
      const e = this.standing();
      if (!e) return;
      this.view = "detail";
      this.name = e.name;
      this.choice = 0;
      this.note = undefined;
    }
  }

  // The cursor lands on servers only, so the last server of one group is one
  // press from the first server of the next and the heading between them is
  // passed over rather than stood on.
  private step(by: number): void {
    const items = this.items();
    for (let i = this.cursor + by; i >= 0 && i < items.length; i += by) {
      if ("entry" in items[i]) {
        this.cursor = i;
        return;
      }
    }
  }

  private detailInput(data: string): void {
    const e = this.opened();
    if (!e) return;
    const actions = this.actions(e);
    if (this.keys.matches(data, UP)) this.choice = Math.max(0, this.choice - 1);
    else if (this.keys.matches(data, DOWN)) this.choice = Math.min(actions.length - 1, this.choice + 1);
    else if (this.keys.matches(data, CANCEL)) this.leave();
    else if (this.keys.matches(data, CONFIRM)) void this.act(actions[this.choice], e);
  }

  private leave(): void {
    this.view = "list";
    this.note = undefined;
  }

  // Every act ends on the panel it was pressed on, redrawn from what the act
  // left behind: the status above changes and the line below says so, which is
  // two ways of seeing one press and neither of them a notice.
  async act(action: string, e: Entry): Promise<void> {
    if (action === BACK) return this.leave();
    if (action === DISABLE) {
      disable(this.c, e.name);
      this.choice = 0;
      this.note = { text: `Disabled: ${e.name} is not asked, now or at the next launch.`, colour: "dim" };
      this.repaint();
      return;
    }
    this.busy = true;
    this.note = undefined;
    this.repaint();
    if (action === ENABLE) {
      this.c.disabled.delete(e.name);
      writeDisabled(this.c.state, this.c.disabled);
    }
    await reconnect(this.c, e.name);
    this.busy = false;
    this.choice = 0;
    const now = this.opened() ?? e;
    this.note = { text: outcome(action === ENABLE ? "Enabled" : "Asked again", now), colour: tone(now) };
    this.repaint();
  }
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
      await ctx.ui.custom((tui: any, theme: Paint, keys: Keys, done: (result: undefined) => void) =>
        new ConsoleScreen(c, theme, keys, done, () => tui.requestRender()));
    },
  });
}

// ---- The subsystem, or none of it ------------------------------------------

// Everything a launch reads and asks about MCP: the four files, this program's
// own state file, and one round trip to each server the operator has not
// switched off. `off` is `--disable-mcp`, and it is answered here rather than by
// each part below, so a launch that switched the subsystem off has no part of it
// to configure - no file is read and no server is asked.
export type Launch = {
  paths: string[];
  declared: { servers: Server[]; skipped: Trouble[] };
  disabled: Set<string>;
  state: string;
  allowNetwork: boolean;
  found: { served: Served[]; trouble: Trouble[] };
};

export async function survey(
  cwd: string,
  home: string,
  options: { off?: boolean; allowNetwork?: boolean; signal?: AbortSignal } = {},
): Promise<Launch | undefined> {
  if (options.off) return undefined;
  const allowNetwork = options.allowNetwork !== false;
  const paths = configPaths(cwd, home);
  const declared = readServers(paths);
  // A server the operator switched off through `/mcp` is not asked and is not
  // counted as trouble. It is still declared, so `/mcp` still lists it: a switch
  // with no way back is a switch nobody touches.
  const state = statePath(home);
  const disabled = new Set(readDisabled(state));
  const found = await discover(declared.servers.filter((s) => !disabled.has(s.name)), {
    allowNetwork,
    signal: options.signal ?? AbortSignal.timeout(MCP_DEADLINE_MS),
  });
  return { paths, declared, disabled, state, allowNetwork, found };
}

// What the session gets out of that survey: every server's tools in front of the
// model, and `/mcp` in the command list beside `/model`. A launch that surveyed
// nothing registers neither, and answers with nothing for the startup line to
// report, which is why the line is absent rather than zeroed.
export function attach(
  pi: any,
  launch: Launch | undefined,
  taken: Iterable<string> = [],
): { servers: number; tools: number; trouble: Trouble[] } | undefined {
  if (!launch) return undefined;
  const { paths, declared, disabled, state, allowNetwork, found } = launch;
  const remote = registerServers(pi, found.served, taken);
  registerConsole(pi, {
    pi,
    servers: declared.servers,
    skipped: declared.skipped,
    found,
    taken: new Set([...taken, ...remote.registered]),
    registered: new Set(remote.registered),
    disabled,
    paths,
    state,
    allowNetwork,
  });
  return {
    servers: found.served.length,
    tools: remote.registered.length,
    trouble: [...declared.skipped, ...found.trouble, ...remote.trouble],
  };
}
