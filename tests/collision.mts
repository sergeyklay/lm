// LM_ROUTING=1 node tests/collision.mts <model> [<model>...]
//
// Does widening a description toward the act its apply() performs take a
// sibling's traffic? The catalogue is the six tool files this repository ships
// and the channel is the chat's own: src/chat.mts registers one function per
// file carrying that file's description, and reads the choice out of
// message.tool_calls. Calls the real model, so it is gated and is not one of
// the default suites. The inputs are the "collision" block of
// tests/routing.json and this file is the disposable half - a model is given a
// row by naming it on the command line.

import { readFileSync } from "node:fs";
import { request } from "node:http";

if (process.env.LM_ROUTING !== "1") {
  console.log("skipped: set LM_ROUTING=1 to call the model");
  process.exit(0);
}

const OLLAMA = process.env.LM_OLLAMA ?? "http://127.0.0.1:11434";
const DATA = new URL("routing.json", import.meta.url).pathname;
const data = JSON.parse(readFileSync(DATA, "utf8")).collision as {
  seed: number;
  arrangements: number;
  params: Record<string, string>;
  requests: { id: string; request: string; answer: string }[];
  catalogues: Record<string, Record<string, string>>;
};
const models = process.argv.slice(2);
if (models.length === 0) { console.error("usage: node tests/collision.mts <model>..."); process.exit(2); }

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

// Position in the catalogue is a variable of its own, so the two calls of a
// pair get the same arrangement and the descriptions are then the only thing
// that differs between them, and the arrangement is varied across rows so that
// a verdict is not one seating plan's luck. The first pair run here disagreed
// with the second on one request for exactly that reason. Sharing the
// arrangement costs nothing: what a shared prompt prefix is served out of the
// runtime's cache is the prompt evaluation, and the answer is generated either
// way.
function ordered(cat: Record<string, string>, id: string, k: number): [string, string][] {
  const a = Object.entries(cat);
  const rnd = mulberry32((data.seed + hash(`${k}:${id}`)) >>> 0);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const schema = ([name, description]: [string, string]) => ({
  type: "function",
  function: {
    name, description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(Object.entries(data.params).map(([k, v]) => [k, { type: v }])),
    },
  },
});

// node:http rather than fetch, for the reason tests/routing.mts gives: undici
// bounds the wait for the response headers at five minutes of its own and a
// cold model can spend longer than that before the first byte.
function post(path: string, payload: unknown): Promise<any> {
  const url = new URL(path, OLLAMA);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
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
    req.end(body);
  });
}

async function pick(model: string, tools: [string, string][], ask: string) {
  const r = await post("/api/chat", {
    model, stream: false, think: false, keep_alive: "30m",
    options: { temperature: 0, num_ctx: Number(process.env.LM_CTX ?? 65536) },
    messages: [{ role: "user", content: ask }],
    tools: tools.map(schema),
  }) as { message?: { tool_calls?: { function: { name: string } }[] } };
  return r.message?.tool_calls?.[0]?.function?.name ?? "(none)";
}

let loaded = "";
for (const model of models) {
  console.log(`\n${model}`);
  if (loaded && loaded !== model) await post("/api/chat", { model: loaded, messages: [], keep_alive: 0 }).catch(() => {});
  await post("/api/chat", { model, stream: false, keep_alive: "30m", messages: [{ role: "user", content: "ok" }] });
  loaded = model;
  for (const tag of Object.keys(data.catalogues)) {
    let total = 0;
    for (let k = 0; k < data.arrangements; k++) {
      let right = 0;
      const cells: string[] = [];
      for (const t of data.requests) {
        const got = await pick(model, ordered(data.catalogues[tag], t.id, k), t.request);
        if (got === t.answer) { right++; cells.push(`${t.id}=${got}`); }
        else cells.push(`${t.id}=${got} WANTED ${t.answer}`);
      }
      total += right;
      console.log(`${tag.padEnd(6)} arrangement ${k}  ${right}/${data.requests.length}  ${cells.join("  ")}`);
    }
    console.log(`${tag.padEnd(6)} total        ${total}/${data.arrangements * data.requests.length}`);
  }
}
