// node tests/mcp.mts
//
// The servers the operator already configured, in front of the chat's model.
// Every case here runs against a stub speaking Streamable HTTP over a loopback
// port, because the property under test is the wire and a suite that needed the
// operator's own servers would be a suite that needs the network.

import { createServer, type Server as Http } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configPaths, readServers, discover, registerServers, registerConsole, toolName, readDisabled, statePath, fold,
  survey, attach,
} from "../src/mcp.mts";

let fail = 0;
function check(name: string, want: unknown, got: unknown) {
  const w = typeof want === "string" ? want : JSON.stringify(want);
  const g = typeof got === "string" ? got : JSON.stringify(got);
  if (w === g) console.log(`ok   ${name}`);
  else {
    console.log(`FAIL ${name}\n  want: ${w}\n  got:  ${g}`);
    fail = 1;
  }
}

const TOOLS = [
  { name: "search", description: "look something up", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
  { name: "fetch", description: "bring something back", inputSchema: { type: "object", properties: {} } },
];

type Stub = { url: string; close: () => void; seen: Record<string, string | undefined>[] };

// A server the protocol would recognise. `sse` picks which of the two reply
// shapes it uses, both of which a client must read; `session` makes it stateful;
// `status` refuses everything; `silent` accepts the connection and never answers.
function stub(options: { sse?: boolean; session?: string; status?: number; silent?: boolean } = {}): Promise<Stub> {
  const seen: Record<string, string | undefined>[] = [];
  const http: Http = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({
        session: req.headers["mcp-session-id"] as string | undefined,
        protocol: req.headers["mcp-protocol-version"] as string | undefined,
        accept: req.headers.accept as string | undefined,
        token: req.headers["x-token"] as string | undefined,
        method: JSON.parse(body || "{}").method,
      });
      if (options.silent) return;
      if (options.status) return res.writeHead(options.status).end("no");
      const message = JSON.parse(body);
      if (message.id === undefined) return res.writeHead(202).end();
      const result =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1" } }
          : message.method === "tools/list"
            ? { tools: TOOLS }
            : { content: [{ type: "text", text: `${message.params.name} said hello to ${JSON.stringify(message.params.arguments)}` }] };
      const reply = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
      const headers: Record<string, string> = {
        "content-type": options.sse ? "text/event-stream" : "application/json",
        ...(options.session && message.method === "initialize" ? { "mcp-session-id": options.session } : {}),
      };
      res.writeHead(200, headers).end(options.sse ? `event: message\ndata: ${reply}\n\n` : reply);
    });
  });
  return new Promise((resolve) => {
    http.listen(0, "127.0.0.1", () => {
      const port = (http.address() as any).port;
      resolve({ url: `http://127.0.0.1:${port}/mcp`, close: () => http.close(), seen });
    });
  });
}

const work = mkdtempSync(join(tmpdir(), "lm-mcp-"));
const home = join(work, "home");
const project = join(work, "project");
mkdirSync(join(home, ".gemini"), { recursive: true });
mkdirSync(project, { recursive: true });

// ---- Where a server is declared. -------------------------------------------
// The four files, three of which already exist on the operator's machine, in two shapes:
// `url` beside a type, and `httpUrl` on its own. Nothing new to configure is the
// whole point, so both are read.
const json = await stub();
const streamed = await stub({ sse: true, session: "s-1" });

writeFileSync(join(home, ".claude.json"), JSON.stringify({
  mcpServers: {
    paper: { type: "http", url: json.url, headers: { "x-token": "opaque" } },
    local: { type: "stdio", command: "npx", args: ["thing"] },
  },
}));
writeFileSync(join(home, ".gemini", "settings.json"), JSON.stringify({
  mcpServers: { paper: { httpUrl: "http://127.0.0.1:1/never" }, stream: { httpUrl: streamed.url } },
}));

const user = readServers(configPaths(project, home));
check("every HTTP server the operator declared is read, whichever key names its URL",
  ["paper", "stream"], user.servers.map((s) => s.name));
check("and the first file to name one wins", json.url, user.servers[0].url);
check("a subprocess server is named rather than dropped, with the file that declared it",
  [{ server: "local", reason: "not an HTTP server", config: join(home, ".claude.json") }], user.skipped);
check("and every server carries the file it was read from, which is the file to edit",
  [join(home, ".claude.json"), join(home, ".gemini", "settings.json")], user.servers.map((s) => s.config));

writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { paper: { type: "http", url: streamed.url } } }));
const scoped = readServers(configPaths(project, home));
check("and the project's own file outranks both of the operator's", streamed.url, scoped.servers[0].url);
rmSync(join(project, ".mcp.json"));

check("a machine with none of the four files declares nothing",
  { servers: [], skipped: [] }, readServers(configPaths(project, join(work, "nobody"))));

// ---- What the wire returns. ------------------------------------------------
const found = await discover(user.servers, { signal: AbortSignal.timeout(4000) });
check("both servers answered", ["paper", "stream"], found.served.map((s) => s.server.name));
check("and each named the version it negotiated", ["2025-06-18", "2025-06-18"], found.served.map((s) => s.wire.protocol));
check("a stateless server hands back no session and is not given one", undefined, found.served[0].wire.session);
check("and a stateful one is carried on every later request",
  ["s-1", "s-1"], streamed.seen.slice(1).map((s) => s.session));
check("the handshake is initialize, the readiness notice, then the listing",
  ["initialize", "notifications/initialized", "tools/list"], json.seen.map((s) => s.method));
check("every request offers both reply shapes, because the server picks",
  ["application/json, text/event-stream"], [...new Set(json.seen.map((s) => s.accept))]);
check("and the operator's own header goes out with it", "opaque", json.seen[0].token);

// ---- What the chat is offered. ---------------------------------------------
const registered = (served: any[], taken: string[] = []) => {
  const tools: any[] = [];
  const out = registerServers({ registerTool: (t: any) => tools.push(t) }, served, taken);
  return { tools, ...out };
};

const offered = registered(found.served);
check("each server's tools are offered under a name of the server's own",
  ["mcp__paper__search", "mcp__paper__fetch", "mcp__stream__search", "mcp__stream__fetch"], offered.registered);
check("with the description the server published",
  ["look something up", "bring something back"], offered.tools.slice(0, 2).map((t) => t.description));
check("and the same one in the system prompt's tool list",
  offered.tools.map((t) => t.description), offered.tools.map((t) => t.promptSnippet));
check("taking the arguments the server's own schema declares",
  TOOLS[0].inputSchema, offered.tools[0].parameters);

const answered = await offered.tools[0].execute("c1", { q: "anything" }, undefined);
check("and calling one reaches the server and returns what it said",
  'search said hello to {"q":"anything"}', answered.content[0].text);

// ---- A name that is already spoken for. ------------------------------------
// The harness keys its tools by name, so a second registration under a name in
// use replaces the first without a word. A verb losing its name to a server is
// the chat quietly doing something else.
const collided = registered(found.served, [toolName("paper", "search"), "commit"]);
check("a server's tool never takes a name a verb already has",
  ["mcp__paper__fetch", "mcp__stream__search", "mcp__stream__fetch"], collided.registered);
check("and the one that lost is named with the name it wanted",
  [{ server: "paper", reason: "mcp__paper__search is taken" }], collided.trouble);
check("and a server offering one of the harness's own eight is given a name of its own",
  ["mcp__paper__bash"],
  registered([{ server: { name: "paper" }, wire: {}, tools: [{ name: "bash" }] } as any]).registered);

// ---- A server that will not answer. ----------------------------------------
// The chat opens either way. Three ways to fail, and each says which server and
// what happened, because the startup line is where the operator learns of it.
const refusing = await stub({ status: 401 });
const mute = await stub({ silent: true });
// A port that was listening and is not any more, rather than a number picked by
// hand: only a refused connection proves the launch survives one.
const closed = await stub();
closed.close();
const failing = await discover(
  [
    { name: "dead", url: closed.url, headers: {} },
    { name: "guarded", url: refusing.url, headers: {} },
    { name: "mute", url: mute.url, headers: {} },
  ],
  { signal: AbortSignal.timeout(600) },
);
check("a server nothing is listening on does not stop the launch", [], failing.served);
check("and each failure is named with what it did",
  [
    { server: "dead", reason: "ECONNREFUSED" },
    { server: "guarded", reason: "answered 401" },
    { server: "mute", reason: "did not answer in time" },
  ],
  failing.trouble.map((t) => ({ server: t.server, reason: t.reason })));
// The startup line has room for the clause; only `/mcp` has room for the rest,
// and the rest is where a server says which token expired.
check("and keeps the whole of what the server said for the screen that has room",
  "401 Unauthorized\nno", failing.trouble[1].detail);
check("a launch the operator asked to stay offline asks no server anything",
  { served: [], trouble: [{ server: "paper", reason: "offline" }] },
  await discover([user.servers[0]], { allowNetwork: false }));

// ---- lm's own file, and the rank it takes. ---------------------------------
// A server written into lm's own file was written for lm; one read out of
// another agent's file is being borrowed. So the borrowed two give way, and the
// repository's own file still outranks all three.
mkdirSync(join(home, ".lm"), { recursive: true });
writeFileSync(join(home, ".lm", ".mcp.json"), JSON.stringify({
  mcpServers: {
    paper: { httpUrl: "http://127.0.0.1:2/lm" },
    own: { type: "http", url: json.url, headers: { "x-token": "opaque" } },
  },
}));
const ranked = readServers(configPaths(project, home));
check("a server declared for lm outranks the same name borrowed from another agent",
  join(home, ".lm", ".mcp.json"), ranked.servers.find((s) => s.name === "paper")?.config);
writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { paper: { httpUrl: streamed.url } } }));
check("and the repository's own file still outranks all three",
  join(project, ".mcp.json"), readServers(configPaths(project, home)).servers[0].config);
rmSync(join(project, ".mcp.json"));

writeFileSync(join(home, ".lm", ".mcp.json"), "{ not json");
check("a file that will not parse is passed over and the rest of the chain still reads",
  [join(home, ".claude.json"), join(home, ".gemini", "settings.json")],
  readServers(configPaths(project, home)).servers.map((s) => s.config));
writeFileSync(join(home, ".lm", ".mcp.json"), JSON.stringify({
  mcpServers: {
    paper: { httpUrl: "http://127.0.0.1:2/lm" },
    own: { type: "http", url: json.url, headers: { "x-token": "opaque" } },
  },
}));

// ---- What /mcp draws, and what it changes. ---------------------------------
// One launch, as bin/lm runs it: read the files, leave out what the operator
// switched off, ask the rest, register what answered, hand `/mcp` the lot.
const state = statePath(home);
async function launch() {
  const paths = configPaths(project, home);
  const declared = readServers(paths);
  const disabled = new Set(readDisabled(state));
  const found = await discover(declared.servers.filter((s) => !disabled.has(s.name)),
    { signal: AbortSignal.timeout(4000) });
  const tools: any[] = [];
  const commands = new Map<string, any>();
  const pi: any = {
    active: [] as string[],
    registerTool: (t: any) => tools.push(t),
    registerCommand: (name: string, options: any) => commands.set(name, options),
    getActiveTools: () => tools.map((t) => t.name),
    setActiveTools: (names: string[]) => (pi.active = names),
  };
  const remote = registerServers(pi, found.served, ["commit"]);
  registerConsole(pi, {
    pi, servers: declared.servers, skipped: declared.skipped, found,
    taken: new Set(["commit", ...remote.registered]), registered: new Set(remote.registered),
    disabled, paths, state, allowNetwork: true,
  });
  return { pi, commands, tools, found };
}

// The screen without a terminal. The harness hands the factory a TUI, a theme,
// the keybindings and the callback that closes it; each is answered here by the
// least that satisfies the contract, and the theme answers in markers so a
// rendered line can be read back for weight and for colour.
const KEYS: Record<string, string> = {
  "tui.select.up": "\x1b[A",
  "tui.select.down": "\x1b[B",
  "tui.select.confirm": "\r",
  "tui.select.cancel": "\x1b",
};
const BOUND: Record<string, string> = { "tui.select.confirm": "enter", "tui.select.cancel": "escape" };
const keys = {
  matches: (data: string, binding: string) => data === KEYS[binding],
  getKeys: (binding: string) => [BOUND[binding] ?? binding],
};
const mark = { fg: (colour: string, text: string) => `<${colour}>${text}</>`, bold: (text: string) => `<b>${text}</b>` };

async function screen(commands: Map<string, any>) {
  let drawn: any;
  const closed = { yes: false, notices: [] as string[] };
  await commands.get("mcp").handler("", {
    hasUI: true,
    ui: {
      custom: async (factory: any) =>
        (drawn = factory({ requestRender() {} }, mark, keys, () => (closed.yes = true))),
      notify: (message: string) => closed.notices.push(message),
    },
  });
  return { s: drawn, closed };
}

const press = (s: any, binding: string) => s.handleInput(KEYS[binding]);
// The frame is a rule, a blank, the body, a blank, the hints, a blank, a rule.
const body = (s: any, width = 76): string[] => s.render(width).slice(2, -4);
const plain = (line: string) => line.replace(/<\/?[a-z]*>/g, "");
const acts = (s: any): string[] =>
  body(s).filter((l) => /^ *(<accent>→ <\/>)?<(accent|text)>(Reconnect|Disable|Enable|Back)</.test(l));
const standing = (s: any): string =>
  plain(body(s).find((l) => l.startsWith(" <accent>→ ")) ?? "").trim().replace(/^→ /, "").split(/ {2,}/)[0];
// A press starts the ask and returns; the screen says it is asking until it is
// not, which is the only thing this has to wait on.
async function settle(s: any) {
  for (let i = 0; i < 400 && body(s).some((l) => plain(l).includes("Asking ")); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

const first = await launch();
const listing = await screen(first.commands);
check("the screen opens on the list, counting the servers the way the launch line does",
  [" <b>Manage MCP servers</b>", " <dim>4 servers</>", ""], body(listing.s).slice(0, 3));
check("and groups them under the file that declared each, in the order the chain reads them",
  [
    ` <dim>${join(home, ".lm", ".mcp.json")}</>`,
    " <accent>→ </><accent>paper </>  <error>ECONNREFUSED</>",
    "   <text>own   </>  <success>connected</><dim> · 2 tools</>",
    ` <dim>${join(home, ".claude.json")}</>`,
    "   <text>local </>  <error>not an HTTP server</>",
    ` <dim>${join(home, ".gemini", "settings.json")}</>`,
    "   <text>stream</>  <success>connected</><dim> · 2 tools</>",
  ],
  body(listing.s).slice(3));

// The complaint the screen was rebuilt for: the heading sat to the right of the
// servers, took the cursor, and answered Enter.
check("a heading sits to the left of the servers under it, not indented past them",
  [1, 3], [plain(body(listing.s)[3]).search(/\S/), plain(body(listing.s)[5]).search(/\S/)]);
check("and is dimmer than every server row",
  [true, false, false],
  [3, 4, 5].map((i) => body(listing.s)[i].startsWith(" <dim>")));

// Four servers and three headings. Pressing down past the end of the list walks
// every row the cursor may stand on, and a heading is not one of them.
const walked: string[] = [];
for (let i = 0; i < 6; i++) {
  walked.push(standing(listing.s));
  press(listing.s, "tui.select.down");
}
check("the cursor stands on servers only, and never on a heading",
  ["paper", "own", "local", "stream", "stream", "stream"], walked);

// The heading between two groups is passed over rather than stood on, so the
// last server of one file is one press from the first server of the next.
for (let i = 0; i < 6; i++) press(listing.s, "tui.select.up");
press(listing.s, "tui.select.down");
check("and one press carries it from the first server of a file to the last", "own", standing(listing.s));
press(listing.s, "tui.select.down");
check("and the next press crosses to the file below, passing the heading between them",
  "local", standing(listing.s));

// Escape is what the harness's own selectors close on, and closing is what the
// callback the factory was handed is for.
press(listing.s, "tui.select.cancel");
check("and escape closes the screen", true, listing.closed.yes);

// ---- The panel one server opens. -------------------------------------------
const opened = await screen(first.commands);
press(opened.s, "tui.select.confirm");
check("opening a server shows the whole of what it said, which the launch line had no room for",
  [
    " <b>paper</b>",
    "",
    " <b>Status</b>   <error>ECONNREFUSED</>",
    " <b>URL</b>      <text>http://127.0.0.1:2/lm</>",
    ` <b>Config</b>   <text>${join(home, ".lm", ".mcp.json")}</>`,
    " <b>Headers</b>  <text>none</>",
    "",
    " <dim>connect ECONNREFUSED 127.0.0.1:2</>",
  ],
  body(opened.s).slice(0, 8));
// The weight is the label's alone, wherever a mutant might put it: the whole of
// the line past the label has to come back with no bold in it at all.
const past = (line: string) => line.slice(line.indexOf("</b>") + 4);
check("with the weight on the labels and never on the values",
  [true, false],
  [body(opened.s)[2].startsWith(" <b>Status</b>"), /<b>/.test(past(body(opened.s)[2]))]);
check("and offers the two things lm can actually do about it, and the way back",
  [" <accent>→ </><accent>Reconnect</>", "   <text>Disable</>", "   <text>Back</>"], acts(opened.s));

// A header value is an API key. Its name, and whether it was filled in, is the
// whole of what this screen may say about one.
const headers = await screen(first.commands);
press(headers.s, "tui.select.down");
press(headers.s, "tui.select.confirm");
check("a header is named, and said to be filled in",
  true, body(headers.s).join("\n").includes("x-token (set)"));
check("and its value is never drawn", false, body(headers.s).join("\n").includes("opaque"));

// A server declared as a subprocess was never asked and cannot be, so it is not
// offered a retry that has nothing to run.
const stdio = await screen(first.commands);
for (let i = 0; i < 2; i++) press(stdio.s, "tui.select.down");
press(stdio.s, "tui.select.confirm");
check("a server with no URL is not offered a reconnect it has no way to run",
  [" <accent>→ </><accent>Disable</>", "   <text>Back</>"], acts(stdio.s));
check("and its panel names no URL either", false, body(stdio.s).some((l) => plain(l).startsWith("URL")));

// ---- What an act says, and where it says it. -------------------------------
// The defect this delivery repairs: the act ran, its answer went to a notice,
// and the harness replaced the launch line with it rather than adding a line, so
// from the chair nothing had happened.
const retry = await screen(first.commands);
press(retry.s, "tui.select.confirm");
press(retry.s, "tui.select.confirm");
await settle(retry.s);
check("a reconnect that fails says so, on the panel it was pressed on",
  " <error>Asked again: paper ECONNREFUSED.</>", body(retry.s).at(-1));
check("and the status above it is redrawn from what the ask returned",
  " <b>Status</b>   <error>ECONNREFUSED</>", body(retry.s)[2]);
check("and nothing goes to a notice, which is where the harness overwrites the line before it",
  [], retry.closed.notices);

const good = await screen(first.commands);
press(good.s, "tui.select.down");
press(good.s, "tui.select.confirm");
press(good.s, "tui.select.confirm");
await settle(good.s);
check("a reconnect that works says what the model got",
  " <success>Asked again: own answered, 2 tools.</>", body(good.s).at(-1));
check("and reconnecting a server that already answered does not lose it to a collision with itself",
  " <b>Status</b>   <success>connected · 2 tools</>", body(good.s)[2]);

// ---- Both actions, across a restart. ---------------------------------------
// The whole point of the switch is that it holds: a server disabled in one
// session must not be asked in the next, and must still be listed there or
// there is no way back.
const off = await screen(first.commands);
press(off.s, "tui.select.down");
press(off.s, "tui.select.confirm");
press(off.s, "tui.select.down");
press(off.s, "tui.select.confirm");
check("disabling one says so where it was pressed",
  " <dim>Disabled: own is not asked, now or at the next launch.</>", body(off.s).at(-1));
check("and takes its tools out of the session that is running",
  ["mcp__stream__search", "mcp__stream__fetch"], first.pi.active);
check("and writes the decision where the next launch reads it", ["own"], readDisabled(state));

const second = await launch();
check("the next launch does not ask it", false, second.found.served.some((s: any) => s.server.name === "own"));
check("and offers the model none of its tools", [], second.tools.filter((t: any) => t.name.startsWith(toolName("own", ""))));

const after = await screen(second.commands);
check("but still lists it, with the state that is keeping it quiet",
  "   <text>own   </>  <dim>disabled</>", body(after.s).find((l) => plain(l).includes("own")));
// A row the operator has to read the words of to tell apart is a row they skim.
check("and the three states a server can be in are told apart by colour, not only by words",
  ["error", "dim", "error", "success"],
  body(after.s).slice(3).filter((l) => !l.startsWith(" <dim>")).map((l) => /> {2}<(\w+)>/.exec(l)?.[1]));

const back = await screen(second.commands);
press(back.s, "tui.select.down");
press(back.s, "tui.select.confirm");
check("a disabled server is offered the way back and nothing else",
  [" <accent>→ </><accent>Enable</>", "   <text>Back</>"], acts(back.s));
press(back.s, "tui.select.confirm");
await settle(back.s);
check("enabling one asks it there and then, and says what came back",
  " <success>Enabled: own answered, 2 tools.</>", body(back.s).at(-1));
check("and gives the model the tools it just got",
  ["mcp__own__search", "mcp__own__fetch"],
  second.tools.filter((t: any) => t.name.startsWith(toolName("own", ""))).map((t: any) => t.name));
check("and the decision it reverses is gone from the file", [], readDisabled(state));

// ---- A refusal too wide for the terminal. ----------------------------------
// The body is capped at 2000 characters and a server may answer a rejection with
// a paragraph. Cutting it throws away the half that names the missing scope.
check("a value wider than the terminal is wrapped, never cut",
  ["the scope this", "server wants is one", "nobody asked for"],
  fold("the scope this server wants is one nobody asked for", 20));
check("and a word longer than the terminal is broken rather than dropped",
  ["aaaaa", "aaaaa", "aa"], fold("aaaaaaaaaaaa", 5));

// The operator's own screen: a server that answers 401 with a body under it.
writeFileSync(join(home, ".lm", ".mcp.json"), JSON.stringify({
  mcpServers: {
    own: { type: "http", url: json.url, headers: { "x-token": "opaque" } },
    guarded: { httpUrl: refusing.url },
  },
}));
const third = await launch();
const refused = await screen(third.commands);
press(refused.s, "tui.select.down");
press(refused.s, "tui.select.confirm");
check("every line of what a refusing server said reaches the screen, under the labels",
  [" <b>Status</b>   <error>answered 401</>", "", " <dim>401 Unauthorized</>", " <dim>no</>"],
  [body(refused.s)[2], body(refused.s)[6], body(refused.s)[7], body(refused.s)[8]]);
press(refused.s, "tui.select.confirm");
await settle(refused.s);
check("and asking it again says the refusal came back, rather than saying nothing",
  " <error>Asked again: guarded answered 401.</>", body(refused.s).at(-1));
check("with no notice sent, where the harness would have overwritten the launch line",
  [], refused.closed.notices);

// ---- The subsystem switched off. -------------------------------------------
// `--disable-mcp` is answered once, at the survey, so a launch under it has no
// part of MCP left to configure. Every one of the five things it promises is a
// case here, and the server it would have asked is a live one, counting what
// reached it.
const watched = await stub();
const offHome = join(work, "off-home");
mkdirSync(offHome, { recursive: true });
writeFileSync(join(offHome, ".claude.json"), JSON.stringify({ mcpServers: { watched: { httpUrl: watched.url } } }));

const surveyed = await survey(project, offHome, { signal: AbortSignal.timeout(4000) });
check("a survey reads the files and asks what they declare",
  ["watched"], surveyed?.found.served.map((s) => s.server.name));
const askedWhileOn = watched.seen.length;

const none = await survey(project, offHome, { off: true, signal: AbortSignal.timeout(4000) });
check("and one switched off reads no config file, so there is no declaration to hold", undefined, none);
check("nor asks the server the file it did not read declares", askedWhileOn, watched.seen.length);

// The pi the harness hands the factory, reduced to the two registers this uses.
function fitting() {
  const tools: any[] = [];
  const commands = new Map<string, any>();
  const pi: any = {
    registerTool: (t: any) => tools.push(t),
    registerCommand: (name: string, options: any) => commands.set(name, options),
  };
  return { pi, tools, commands };
}

const on = fitting();
const reported = attach(on.pi, surveyed, ["commit"]);
const shut = fitting();
const silent = attach(shut.pi, none, ["commit"]);

check("a survey that found a server registers its tools",
  ["mcp__watched__search", "mcp__watched__fetch"], on.tools.map((t) => t.name));
check("and one switched off registers no tool", [], shut.tools.map((t) => t.name));
check("`/mcp` is a command the chat has when MCP is running", true, on.commands.has("mcp"));
check("and is not a command the chat has when MCP is switched off", false, shut.commands.has("mcp"));
check("which leaves it with no command at all", [], [...shut.commands.keys()]);
check("a running subsystem hands the startup line its counts",
  { servers: 1, tools: 2, trouble: [] }, reported);
check("and one switched off hands it nothing to report", undefined, silent);

json.close();
streamed.close();
refusing.close();
mute.close();
watched.close();
rmSync(work, { recursive: true, force: true });

console.log(fail ? "FAILED" : "all cases passed");
process.exit(fail);
