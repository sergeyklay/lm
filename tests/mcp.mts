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
  configPaths, readServers, discover, registerServers, registerConsole, toolName, readDisabled, statePath,
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

// The command without a terminal: every selector records the block it was drawn
// with and the rows under it, and answers with the next scripted keystroke.
function drive(commands: Map<string, any>, choices: (string | undefined)[]) {
  const drawn: { title: string; options: string[] }[] = [];
  const said: string[] = [];
  const ctx = {
    hasUI: true,
    ui: {
      select: async (title: string, options: string[]) => (drawn.push({ title, options }), choices.shift()),
      notify: (message: string) => said.push(message),
    },
  };
  return { drawn, said, run: () => commands.get("mcp").handler("", ctx) };
}

const first = await launch();
const listing = drive(first.commands, [undefined]);
await listing.run();
check("the list says how many servers there are, the way the launch line does",
  "Manage MCP servers\n4 servers", listing.drawn[0].title);
check("and groups them under the file that declared each, in the order the chain reads them",
  [
    `  ${join(home, ".lm", ".mcp.json")}`,
    "paper · ECONNREFUSED",
    "own · connected · 2 tools",
    `  ${join(home, ".claude.json")}`,
    "local · not an HTTP server",
    `  ${join(home, ".gemini", "settings.json")}`,
    "stream · connected · 2 tools",
  ],
  listing.drawn[0].options);

const detail = drive(first.commands, ["paper · ECONNREFUSED", undefined, undefined]);
await detail.run();
check("selecting one shows the whole of what the server said, which the launch line had no room for",
  [
    "paper",
    "",
    "Status   ECONNREFUSED",
    "URL      http://127.0.0.1:2/lm",
    `Config   ${join(home, ".lm", ".mcp.json")}`,
    "Headers  none",
    "",
    "connect ECONNREFUSED 127.0.0.1:2",
  ].join("\n"),
  detail.drawn[1]?.title);
check("and offers the two things lm can actually do about it",
  ["Reconnect", "Disable", "Back"], detail.drawn[1]?.options);
// A header value is an API key. Its name, and whether it was filled in, is the
// whole of what this screen may say about one.
const headers = drive(first.commands, ["own · connected · 2 tools", undefined, undefined]);
await headers.run();
check("a header is named, and said to be filled in", true, headers.drawn[1]?.title.includes("Headers  x-token (set)"));
check("and its value is never drawn", false, headers.drawn[1]?.title.includes("opaque") ?? true);

// ---- Both actions, across a restart. ---------------------------------------
// The whole point of the switch is that it holds: a server disabled in one
// session must not be asked in the next, and must still be listed there or
// there is no way back.
const off = drive(first.commands, ["own · connected · 2 tools", "Disable", undefined]);
await off.run();
check("disabling one says so", `mcp: own disabled, in this session and at the next launch.`, off.said[0]);
check("and takes its tools out of the session that is running",
  ["mcp__stream__search", "mcp__stream__fetch"], first.pi.active);
check("and writes the decision where the next launch reads it", ["own"], readDisabled(state));

const second = await launch();
const after = drive(second.commands, [undefined]);
await after.run();
check("the next launch does not ask it", false, second.found.served.some((s: any) => s.server.name === "own"));
check("and offers the model none of its tools", [], second.tools.filter((t: any) => t.name.startsWith(toolName("own", ""))));
check("but still lists it, with the state that is keeping it quiet",
  true, after.drawn[0].options.includes("own · disabled"));

const back = drive(second.commands, ["own · disabled", "Enable", undefined]);
await back.run();
check("enabling one asks it again there and then", "mcp: own · connected · 2 tools", back.said[0]);
check("and gives the model the tools it just got",
  ["mcp__own__search", "mcp__own__fetch"], second.tools.filter((t: any) => t.name.startsWith(toolName("own", ""))).map((t: any) => t.name));
check("and the decision it reverses is gone from the file", [], readDisabled(state));

const retry = drive(second.commands, ["own · connected · 2 tools", "Reconnect", undefined]);
await retry.run();
check("reconnecting a server that already answered does not lose it to a collision with itself",
  "mcp: own · connected · 2 tools", retry.said[0]);

json.close();
streamed.close();
refusing.close();
mute.close();
rmSync(work, { recursive: true, force: true });

console.log(fail ? "FAILED" : "all cases passed");
process.exit(fail);
