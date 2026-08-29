// node tests/catalogue.mts
//
// What the chat is offered to choose from. The catalogue is read off ollama at
// refresh time rather than declared, so the cases drive it against a stubbed
// ollama and then through the harness's own composer, which is what decides
// whether a returned list reaches the selector at all: it replaces the offered
// models only when the refresh returns one, and leaves them alone otherwise.

import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { catalogue } from "../src/catalogue.mts";
import { providerConfig, SERVED_CONTEXT_TOKENS } from "../src/provider.mts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

let fail = 0;

function check(name: string, want: unknown, got: unknown) {
  const w = String(want), g = String(got);
  if (w === g) console.log(`ok   ${name}`);
  else {
    console.log(`FAIL ${name}\n  want: ${w}\n  got:  ${g}`);
    fail = 1;
  }
}

// One card is smaller than the window the service serves and one is larger, which
// is the whole of the per-model window decision, and one advertises thinking
// while the other does not, which is the whole of the per-model capability
// decision. `phi3:mini-4k` is a real tag on this machine: 4096 is what its card
// reports and `completion` is all it claims.
const CARDS: Record<string, { tokens: number; capabilities: string[] } | null> = {
  "qwen3.8:27b": { tokens: 262144, capabilities: ["completion", "vision", "tools", "thinking"] },
  "phi3:mini-4k": { tokens: 4096, capabilities: ["completion"] },
  "silent:1b": null, // /api/show answers 500 for this one
};

async function withOllama(run: (port: number) => Promise<void>) {
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url?.includes("/api/tags")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: Object.keys(CARDS).map((name) => ({ name })) }));
        return;
      }
      const asked = (() => { try { return JSON.parse(raw).model; } catch { return ""; } })();
      const card = CARDS[asked];
      if (card == null) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no card" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model_info: { "someArch.context_length": card.tokens }, capabilities: card.capabilities }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const previous = process.env.LM_OLLAMA;
  process.env.LM_OLLAMA = `http://127.0.0.1:${port}`;
  try {
    await run(port);
  } finally {
    if (previous === undefined) delete process.env.LM_OLLAMA; else process.env.LM_OLLAMA = previous;
    server.close();
  }
}

await withOllama(async () => {
  const list = await catalogue();
  check("every model ollama has is offered", Object.keys(CARDS).length, list?.length);
  check("and each is named by the tag a person types", true, list?.some((m) => m.id === "phi3:mini-4k"));

  const byId = Object.fromEntries((list ?? []).map((m) => [m.id, m]));
  check("a card wider than the service is held to what the service serves", SERVED_CONTEXT_TOKENS, byId["qwen3.8:27b"]?.contextWindow);
  check("a card narrower than the service keeps its own window", 4096, byId["phi3:mini-4k"]?.contextWindow);
  check("a model whose card cannot be read is still offered", true, "silent:1b" in byId);
  check("with the served window behind it", SERVED_CONTEXT_TOKENS, byId["silent:1b"]?.contextWindow);

  // The service's side of the bound is what `LM_CTX` says, so an operator running
  // a smaller service is believed about every model rather than about one.
  process.env.LM_CTX = "8192";
  const narrowed = await catalogue();
  check("a smaller service holds every card to it", "8192,4096,8192",
        (narrowed ?? []).map((m) => m.contextWindow).join(","));
  delete process.env.LM_CTX;

  check("the budget is the one the single entry declares", providerConfig().models[0].maxTokens, byId["qwen3.8:27b"]?.maxTokens);

  // The capability is the card's own answer, per model, and it is what decides
  // whether the harness offers a thinking level for that model at all. A card
  // that cannot be read claims nothing on the model's behalf.
  check("a card that advertises thinking declares a thinking model", true, byId["qwen3.8:27b"]?.reasoning);
  check("and one that advertises none declares none", false, byId["phi3:mini-4k"]?.reasoning);
  check("and a card that cannot be read claims nothing", false, byId["silent:1b"]?.reasoning);
  check("the level that reads as closed is mapped to the one that closes it", "none",
        (byId["qwen3.8:27b"] as any)?.thinkingLevelMap?.off);

  // The harness's own path: register the provider the way `bin/lm` does, refresh,
  // and read back what the selector would list.
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("ollama", { ...providerConfig(), refreshModels: catalogue } as any);
  check("before a refresh the session still opens on one", 1, runtime.getModels("ollama").length);
  await runtime.refresh({});
  check("after it the selector lists them all", Object.keys(CARDS).length, runtime.getModels("ollama").length);
  check("and the model LM_MODEL names is among them", true, !!runtime.getModel("ollama", providerConfig().models[0].id));
  // The selector renders the available snapshot rather than the composed list,
  // and the two differ: a provider whose credentials do not check out composes
  // and is still offered nothing.
  const offered = runtime.getAvailableSnapshot().filter((m: any) => m.provider === "ollama");
  check("and the snapshot the selector renders holds them", Object.keys(CARDS).length, offered.length);
});

// An ollama that cannot be reached leaves the single entry alone rather than
// emptying the selector, because the composer replaces the list only on a list.
process.env.LM_OLLAMA = "http://127.0.0.1:1";
check("an unreachable ollama offers no list", undefined, await catalogue());
const offlineRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
offlineRuntime.registerProvider("ollama", { ...providerConfig(), refreshModels: catalogue } as any);
await offlineRuntime.refresh({});
check("so the chat keeps the one it opened on", 1, offlineRuntime.getModels("ollama").length);
delete process.env.LM_OLLAMA;

// A host that accepts the connection and never answers is the case a refusal does
// not cover: fetch rejects at once on a refused port and waits for as long as a
// silent one stays silent. `bin/lm` awaits this read before `main()`, so the read
// carries a deadline and the deadline has to degrade the way the refusal above
// does, leaving the chat on the entry it opened with rather than killing it.
const silentWork = mkdtempSync(join(tmpdir(), "lm-catalogue-"));
const seen: string[] = [];
const silent: Server = createServer((req, res) => {
  seen.push(req.url ?? "");
  if (req.url?.includes("/api/")) return;
  res.writeHead(400, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "recorded" } }));
});
await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
process.env.LM_OLLAMA = `http://127.0.0.1:${(silent.address() as any).port}`;

// Raced against a timer rather than awaited, because a read that ignores its
// deadline hangs this suite instead of failing a case.
let waiting: NodeJS.Timeout;
const bounded = await Promise.race([
  catalogue({ signal: AbortSignal.timeout(200) }).then((l) => (l === undefined ? "no list" : `a list of ${l.length}`)),
  new Promise((r) => { waiting = setTimeout(() => r("still waiting"), 5000); }),
]);
clearTimeout(waiting!);
check("a silent ollama offers no list either, once the deadline passes", "no list", bounded);

// Through the program, because the deadline is the launch's and not the
// catalogue's: nothing else stops a silent host from holding the chat closed
// before it has drawn anything.
const child = spawn(join(ROOT, "bin", "lm"), ["chat", "-p", "Say hello."], {
  cwd: silentWork,
  stdio: ["ignore", "ignore", "ignore"],
  // The launch also asks npm which harness releases exist, and this case cannot
  // have `PI_OFFLINE`, which would switch off the read it exists to measure. The
  // package registry is pointed at a refused port instead, so no case here
  // reaches the network or installs anything into the clone it is running from.
  env: { ...process.env, LM_TOOLS: silentWork, LM_LOG: "",
    PI_CODING_AGENT_DIR: join(silentWork, "agent"), npm_config_registry: "http://127.0.0.1:1" },
});
const patience = setTimeout(() => child.kill("SIGKILL"), 30_000);
await new Promise((r) => child.on("close", r));
clearTimeout(patience);
check("and the launch waiting on it still reaches the model", true,
      seen.some((p) => p.includes("/chat/completions")));

silent.closeAllConnections?.();
silent.close();
rmSync(silentWork, { recursive: true, force: true });
delete process.env.LM_OLLAMA;

// The harness's own offline switch is `PI_OFFLINE === undefined`, so a refresh
// under it must not reach for the machine at all.
check("and offline asks ollama nothing", undefined, await catalogue({ allowNetwork: false }));

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
