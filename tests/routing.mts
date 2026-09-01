// LM_ROUTING=1 node tests/routing.mts <model> [<model>...]
//
// The routing comparison of section 2.1 of the knowledge base: three channels
// over one catalogue, at four catalogue sizes. Calls the real model, so it is
// gated and is not one of the default suites. The inputs are tests/routing.json
// and this file is the disposable half - a model is given a row by naming it on
// the command line.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { request } from "node:http";

if (process.env.LM_ROUTING !== "1") {
  console.log("skipped: set LM_ROUTING=1 to call the model");
  process.exit(0);
}

const OLLAMA = process.env.LM_OLLAMA ?? "http://127.0.0.1:11434";
const DATA = new URL("routing.json", import.meta.url).pathname;
const data = JSON.parse(readFileSync(DATA, "utf8"));
const models = process.argv.slice(2);
if (models.length === 0) { console.error("usage: node tests/routing.mts <model>..."); process.exit(2); }

type Tool = { name: string; description: string; params: Record<string, string> };
const byName = new Map<string, Tool>(data.tools.map((t: Tool) => [t.name, t]));

// One stream per point of the sweep, so no catalogue is an extension of another
// and nothing is served out of what the runtime cached for an earlier size.
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
function shuffled<T>(items: T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The answer is always present and the rest of the catalogue is drawn from the
// other 59, which is what makes a miss a choice rather than an absence.
function catalogue(keep: string[], id: string, n: number): Tool[] {
  const rnd = mulberry32((data.seed + hash(`${id}:${n}`)) >>> 0);
  const rest = shuffled(data.tools.filter((t: Tool) => !keep.includes(t.name)), rnd);
  return shuffled([...keep.map((k) => byName.get(k)!), ...rest.slice(0, n - keep.length)], rnd);
}

const schema = (t: Tool) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, { type: v }])),
      required: Object.keys(t.params),
    },
  },
});

// node:http rather than fetch, because undici bounds the wait for the response
// headers at five minutes of its own and a cold twenty-gigabyte model can spend
// longer than that before the first byte. A sweep that dies there loses every
// model after the one it was on.
function post(path: string, payload: unknown): Promise<any> {
  const url = new URL(path, OLLAMA);
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
    }, (res) => {
      let out = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { out += c; });
      res.on("end", () => (res.statusCode === 200
        ? resolve(JSON.parse(out))
        : reject(new Error(`${res.statusCode} ${out}`))));
    });
    req.setTimeout(1_800_000, () => req.destroy(new Error("no answer in 30 minutes")));
    req.on("error", reject);
    req.end(data);
  });
}

async function chat(model: string, body: Record<string, unknown>) {
  return await post("/api/chat", {
    model, stream: false, think: false, keep_alive: "30m",
    // ...body wins, so a caller may turn thinking on for a control.
    options: { temperature: 0, num_ctx: Number(process.env.LM_CTX ?? 65536) },
    ...body,
  }) as { message?: { content?: string; tool_calls?: { function: { name: string } }[] };
           eval_count?: number; prompt_eval_count?: number };
}

// Native function calling: the whole schema goes into tools[] and the answer is
// read out of message.tool_calls.
async function viaTools(model: string, tools: Tool[], request: string) {
  const r = await chat(model, {
    messages: [{ role: "user", content: request }],
    tools: tools.map(schema),
  });
  return { name: r.message?.tool_calls?.[0]?.function?.name ?? "", prompt: r.prompt_eval_count ?? 0 };
}

// The catalogue goes as prose, one line per tool, and the answer is pinned by a
// response schema naming the whole enum. think is an argument because it is the
// one variable that decides whether an answer arrives at all on the pair that
// loses them: measured on ollama 0.32.15 with gpt-oss:20b, this framing returns
// an empty content under think false and the same empty content under think
// true, while two other framings answer under think true and lose it under
// false. The channel is measured as this project runs it, think false, and the
// control below is what tells that zero from a model that cannot route.
async function viaEnum(model: string, tools: Tool[], request: string, think = false) {
  const listing = tools.map((t) => `${t.name}: ${t.description}`).join("\n");
  const r = await chat(model, {
    think,
    messages: [{ role: "user", content: `Available tools:\n${listing}\n\nRequest: ${request}\n\nPick the single tool that serves this request.` }],
    format: { type: "object", properties: { tool: { type: "string", enum: tools.map((t) => t.name) } }, required: ["tool"] },
  });
  const prompt = r.prompt_eval_count ?? 0;
  const content = r.message?.content ?? "";
  // An empty content under a schema is a refusal and not an empty answer: the
  // pair ollama+gpt-oss returns one with done_reason "stop" and no diagnostic.
  if (content.trim() === "") return { name: "", empty: true, prompt };
  try { return { name: String(JSON.parse(content).tool ?? ""), empty: false, prompt }; }
  catch { return { name: "", empty: false, prompt }; }
}

// The model writes a program against the enumerated API. What is scored is that
// it parses, that the calls come in the order the task needs, and that it calls
// nothing the catalogue does not hold.
async function viaCode(model: string, tools: Tool[], request: string, order: string[]) {
  const api = tools.map((t) => `def ${t.name}(${Object.keys(t.params).join(", ")}): ...  # ${t.description}`).join("\n");
  // The sandbox has to be stated rather than implied. Asked only to «call only
  // these functions», the model reaches for `open` on a task that names a file,
  // and what is then measured is the wording and not the channel.
  const r = await chat(model, {
    messages: [{ role: "user", content: `${api}\n\nThe program below runs in a sandbox where those functions are the only names in scope: there are no imports, no builtins and no file objects, so nothing else can be called. Write it so that it does this:\n${request}\n\nAnswer with the program alone and no prose.` }],
  });
  const text = r.message?.content ?? "";
  const code = /```(?:python)?\n([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const py = spawnSync("python3", ["-c", `
import ast, json, sys
src = sys.stdin.read()
try: tree = ast.parse(src)
except SyntaxError: print(json.dumps({"parsed": False})); raise SystemExit
calls = [n.func.id for n in ast.walk(tree)
         if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
print(json.dumps({"parsed": True, "calls": calls}))`], { input: code, encoding: "utf8" });
  const out = JSON.parse(py.stdout || '{"parsed":false}') as { parsed: boolean; calls?: string[] };
  const tokens = r.eval_count ?? 0;
  if (!out.parsed) return { ok: false, why: "did not parse", tokens };
  const calls = out.calls ?? [];
  const outside = calls.filter((c) => !tools.some((t) => t.name === c));
  if (outside.length > 0) return { ok: false, why: `called outside the API: ${outside.join(", ")}`, tokens };
  const seen = calls.filter((c) => order.includes(c));
  return { ok: seen.join(",") === order.join(","), why: seen.join(" -> ") || "no call from the order", tokens };
}

let loaded = "";
for (const model of models) {
  console.log(`\n${model}`);
  // One model resident at a time: two of these do not fit in the card together,
  // and a swap inside a measured call is time nothing here is measuring.
  if (loaded) await post("/api/chat", { model: loaded, messages: [], keep_alive: 0 }).catch(() => {});
  await chat(model, { messages: [{ role: "user", content: "ok" }] });
  loaded = model;
  for (const n of data.sizes as number[]) {
    let tools = 0, enums = 0, empty = 0, prompt = 0, toolPrompt = 0;
    const missed: string[] = [];
    for (const task of data.tasks as { id: string; request: string; answer: string }[]) {
      const cat = catalogue([task.answer], task.id, n);
      const t = await viaTools(model, cat, task.request);
      toolPrompt += t.prompt;
      if (t.name === task.answer) tools++; else missed.push(`tools n=${n} ${task.id}: ${t.name || "(none)"} for ${task.answer}`);
      const e = await viaEnum(model, cat, task.request);
      if (e.empty) empty++;
      prompt += e.prompt;
      if (e.name === task.answer) enums++; else missed.push(`enum n=${n} ${task.id}: ${e.name || (e.empty ? "(empty)" : "(none)")} for ${task.answer}`);
    }
    // A zero is a fact about the question until a control says otherwise. Every
    // answer at this size was lost, so the same requests go again with thinking
    // on, which is the one variable that decides whether the pair returns
    // anything, and what comes back separates the runtime from the model.
    let control = "";
    if (empty === (data.tasks as unknown[]).length) {
      let answered = 0, right = 0;
      for (const task of data.tasks as { id: string; request: string; answer: string }[]) {
        const e = await viaEnum(model, catalogue([task.answer], task.id, n), task.request, true);
        if (!e.empty) answered++;
        if (e.name === task.answer) right++;
      }
      control = `  control(think) answered ${answered}/10 right ${right}/10`;
    }
    const ct = data.code_task as { id: string; request: string; answer_order: string[] };
    const code = await viaCode(model, catalogue(ct.answer_order, ct.id, n), ct.request, ct.answer_order);
    // The two token counts are the other half of what this sweep can say: how
    // long the code answer is at each catalogue size, and what one tool costs in
    // the enum prompt. Both are claims elsewhere in the knowledge base.
    console.log(`n=${String(n).padEnd(2)}  tools ${tools}/10  enum ${enums}/10  code ${code.ok ? 1 : 0}/1  empty ${empty}`
      + `  code_tokens ${code.tokens}  enum_prompt ${Math.round(prompt / (data.tasks as unknown[]).length)}`
      + `  tools_prompt ${Math.round(toolPrompt / (data.tasks as unknown[]).length)}  ${code.why}${control}`);
    for (const m of missed) console.log(`      ${m}`);
  }
}
