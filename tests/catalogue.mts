// node tests/catalogue.mts
//
// What the chat is offered to choose from. The catalogue is read off ollama at
// refresh time rather than declared, so the cases drive it against a stubbed
// ollama and then through the harness's own composer, which is what decides
// whether a returned list reaches the selector at all: it replaces the offered
// models only when the refresh returns one, and leaves them alone otherwise.

import { createServer, type Server } from "node:http";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { catalogue } from "../src/catalogue.mts";
import { providerConfig, SERVED_CONTEXT_TOKENS } from "../src/provider.mts";

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
// is the whole of the per-model decision. `phi3:mini-4k` is a real tag on this
// machine and 4096 is what its card reports.
const CARDS: Record<string, number | null> = {
  "qwen3.8:27b": 262144,
  "phi3:mini-4k": 4096,
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
      res.end(JSON.stringify({ model_info: { "someArch.context_length": card }, capabilities: ["completion"] }));
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

  // What the chat sends is not this task's, so the entries carry what the single
  // registration already carried.
  check("the budget is the one the single entry declares", providerConfig().models[0].maxTokens, byId["qwen3.8:27b"]?.maxTokens);
  check("and the thinking switch is untouched", providerConfig().models[0].reasoning, byId["qwen3.8:27b"]?.reasoning);

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

// The harness's own offline switch is `PI_OFFLINE === undefined`, so a refresh
// under it must not reach for the machine at all.
check("and offline asks ollama nothing", undefined, await catalogue({ allowNetwork: false }));

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
