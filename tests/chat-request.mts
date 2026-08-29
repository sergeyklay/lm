// node tests/chat-request.mts
//
// What the chat asks the model for, read off the wire rather than off the
// source. The chat and a verb register the model twice and independently, so
// nothing `tests/request.mts` pins says anything about this half. What is pinned
// here is mostly the absence of two fields, and an absence is what a source
// reading cannot tell from a field the harness dropped on its way out.
//
// Two instruments, because the cheaper of them cannot see the defect the other
// can: the whole program in print mode, and a session on a model that has been
// through a catalogue refresh. The refresh is the one that matters, because it
// replaces the registered model with one the catalogue built, and print mode
// never runs one: a setting applied at the registration and not at the template
// survives the first instrument and is gone in the operator's own chat.
//
// The server answers 400, because the request is the whole subject. The runs
// therefore fail, and no case here asserts an exit code.

import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import { catalogue } from "../src/catalogue.mts";
import { modelId, providerConfig } from "../src/provider.mts";

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

// One ollama, stubbed: the completions it records and refuses, and the two
// endpoints a catalogue read asks. One tag advertises thinking and one does not,
// because what the request carries about thinking is per model and comes from the
// card rather than from this project.
const PLAIN = "phi3:mini-4k";
const bodies: any[] = [];
const paths: string[] = [];
const server: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    paths.push(req.url ?? "");
    if (req.url?.includes("/api/tags")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: modelId() }, { name: PLAIN }] }));
      return;
    }
    if (req.url?.includes("/api/show")) {
      const thinking = !raw.includes(PLAIN);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model_info: { "someArch.context_length": 4096 },
        capabilities: thinking ? ["completion", "thinking"] : ["completion"],
      }));
      return;
    }
    try { bodies.push(JSON.parse(raw)); } catch { bodies.push({ unparsed: raw }); }
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "recorded" } }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.LM_OLLAMA = `http://127.0.0.1:${(server.address() as any).port}`;

const work = mkdtempSync(join(tmpdir(), "lm-chat-request-"));
const budget = (b: any) => ("max_tokens" in b ? "max_tokens" : "") + ("max_completion_tokens" in b ? "max_completion_tokens" : "");

// The whole program, through its own entry point: `spawn` and not `spawnSync`,
// because a synchronous child blocks this recorder's event loop and the run
// records nothing at all.
async function throughTheProgram(extra: Record<string, string> = {}) {
  const before = bodies.length;
  const child = spawn(join(ROOT, "bin", "lm"), ["chat", "-p", "Say hello."], {
    cwd: work,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      LM_TOOLS: work,
      LM_LOG: "",
      PI_CODING_AGENT_DIR: join(work, "agent"),
      ...extra,
    },
  });
  await new Promise((r) => child.on("close", r));
  return bodies[before] ?? {};
}

const printed = await throughTheProgram();
check("the chat reached the completions endpoint", true, paths.some((p) => p.includes("/chat/completions")));
check("and asked for no answer budget under either name", "", budget(printed));
// The chat opens on a thinking model one notch below the harness's own default:
// open, because that is the difference between a person thinking with the model
// and a batch verb spending nothing on it. `bin/lm` seeds that level into the
// harness's settings rather than handing `--thinking` over, and this is the only
// case that holds the seeding: every case in `tests/chat.mts` calls the seed
// itself.
check("and opened one notch below the harness's default", "low", printed.reasoning_effort);

// The same launch on a card that claims no thinking, over the settings the launch
// above seeded. `off` is the only level the harness offers such a model, so the
// saved level has to arrive there rather than refusing the model or reaching the
// wire as an effort it cannot take.
const plainLaunch = await throughTheProgram({ LM_MODEL: PLAIN });
check("a launch on a card that claims no thinking still reaches the model", PLAIN, plainLaunch.model);
check("and opens on the one level that card has", false, "reasoning_effort" in plainLaunch);

// The harness's own path, the one print mode never takes: register the provider
// the way `bin/lm` does, refresh, and ask on what the refresh left behind.
const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
runtime.registerProvider("ollama", { ...providerConfig(), refreshModels: catalogue } as any);
check("the session opens on one model", 1, runtime.getModels("ollama").length);
await runtime.refresh({});
check("and a refresh replaces it with the catalogue's own", 2, runtime.getModels("ollama").length);

async function asked(model: any, level?: string) {
  const { session } = await createAgentSession({
    cwd: work,
    model,
    modelRuntime: runtime,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }),
    noTools: "all",
  });
  if (level) session.setThinkingLevel(level as any);
  const before = bodies.length;
  try { await session.prompt("hi"); } catch {
    // A refused request is what this suite asked the server for.
  }
  return bodies[before] ?? {};
}

const refreshed = await asked(runtime.getModel("ollama", modelId()));
check("a model the refresh built asks for no budget either", "", budget(refreshed));
check("and thinks at the level the session is at", "medium", refreshed.reasoning_effort);

// The level that reads as closed sends nothing at all on this endpoint, which is
// the state the model thinks in, so the registration maps it to the one form
// measured to close the channel. This is the case the whole declaration is for.
const closed = await asked(runtime.getModel("ollama", modelId()), "off");
check("and closing it reaches the wire as the form ollama honours", "none", closed.reasoning_effort);
const raised = await asked(runtime.getModel("ollama", modelId()), "high");
check("while another level reaches it under its own name", "high", raised.reasoning_effort);

// A card that advertises no thinking gets no level and no field: the harness
// offers `off` alone for it, and `off` on a model that cannot think is silence
// rather than an instruction.
const plain = await asked(runtime.getModel("ollama", PLAIN));
check("a model whose card claims no thinking is asked for none", false, "reasoning_effort" in plain);

// The budget the chat gave up is still the verb's, and it is still the field
// ollama honours. `tests/request.mts` pins the rest of that half.
const { resolveModel } = await import("../src/model.mts");
const verb = await resolveModel();
check("the verb keeps its own budget", 3000, verb.model.maxTokens);
check("and the chat's model declares none", 0, runtime.getModel("ollama", modelId())?.maxTokens);

server.close();
rmSync(work, { recursive: true, force: true });

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
