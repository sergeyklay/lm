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
import { configPaths, readServers, discover, registerServers, toolName } from "../src/mcp.mts";

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
// The three files that already exist on the operator's machine, in two shapes:
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
check("a subprocess server is named rather than dropped",
  [{ server: "local", reason: "not an HTTP server" }], user.skipped);

writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { paper: { type: "http", url: streamed.url } } }));
const scoped = readServers(configPaths(project, home));
check("and the project's own file outranks both of the operator's", streamed.url, scoped.servers[0].url);
rmSync(join(project, ".mcp.json"));

check("a machine with none of the three files declares nothing",
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
  failing.trouble);
check("a launch the operator asked to stay offline asks no server anything",
  { served: [], trouble: [{ server: "paper", reason: "offline" }] },
  await discover([user.servers[0]], { allowNetwork: false }));

json.close();
streamed.close();
refusing.close();
mute.close();
rmSync(work, { recursive: true, force: true });

console.log(fail ? "FAILED" : "all cases passed");
process.exit(fail);
