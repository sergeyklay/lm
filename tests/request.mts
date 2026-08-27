// node tests/request.mts
//
// What the runner asks the model for, read off the wire rather than off the
// source: the answer budget and the field that carries it, the switch that
// stops this model thinking, and which registration the operator's window
// reaches. All are settings of the model the harness sends for us, so nothing
// in the runner's own control flow would notice their loss: the answer would
// simply grow past the budget again, or shrink under a window sized for a
// smaller card, on a machine with a GPU.
//
// The server answers 400, because the request is the whole subject. The run
// therefore fails, and its exit code is not what any case here asserts.

import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerb, parseArgs, unattended } from "../src/verb.mts";
import { providerConfig } from "../src/provider.mts";

let fail = 0;

function check(name: string, want: unknown, got: unknown) {
  const w = String(want), g = String(got);
  if (w === g) console.log(`ok   ${name}`);
  else {
    console.log(`FAIL ${name}\n  want: ${w}\n  got:  ${g}`);
    fail = 1;
  }
}

// The capability has two affordances and they are not the same one twice: a person
// types the flag, and a composition or a script exports the variable instead.
const flagged = parseArgs("v", [], ["--yes"]);
check("the flag alone asks for it", true, flagged.ok && unattended(flagged.yes, {}));
check("and reaches the tool's own shell as well", "1", flagged.ok ? flagged.env.LM_YES : "absent");
check("the variable alone asks for it", true, unattended(false, { LM_YES: "1" }));
check("neither leaves the question to the human", false, unattended(false, {}));
check("and a variable set to anything else is not it", false, unattended(false, { LM_YES: "yes" }));

const work = mkdtempSync(join(tmpdir(), "lm-request-"));
const tools = join(work, "tools");
mkdirSync(tools, { recursive: true });
const file = join(tools, "asks.sh");
writeFileSync(file, [
  'name="asks"',
  'description="emit one changelog bullet"',
  'collect() { echo "Write one changelog bullet."; }',
  `schema() { echo '{"type":"object","properties":{"bullet":{"type":"string"}},"required":["bullet"]}'; }`,
  "validate() { cat >/dev/null; }",
  `render() { jq -r .bullet; }`,
  "apply() { cat >/dev/null; }",
  "",
].join("\n"));

// One run against a recording server, under the environment the case is about.
// The variables are removed again afterwards, because the next case's subject is
// the one it sets and not the one before it.
async function sent(env: Record<string, string> = {}) {
  const bodies: any[] = [];
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? "");
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { bodies.push(JSON.parse(raw)); } catch { bodies.push({ unparsed: raw }); }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "recorded" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;

  const cwd = process.cwd();
  process.chdir(work);
  process.env.LM_OLLAMA = `http://127.0.0.1:${port}`;
  process.env.LM_LOG = "";
  Object.assign(process.env, env);
  try {
    await runVerb(file, [], {});
  } catch {
    // A refused request is what this suite asked the server for.
  }
  process.chdir(cwd);
  for (const key of Object.keys(env)) delete process.env[key];
  server.close();
  return { body: bodies[0] ?? {}, paths };
}

const plain = await sent();
check("the runner reached the completions endpoint", true, plain.paths.some((p) => p.includes("/chat/completions")));
check("and asked for a budget", 3000, plain.body.max_tokens);
check("under the name ollama honours", false, "max_completion_tokens" in plain.body);
check("and asked the model not to think", "none", plain.body.reasoning_effort);
// Greedy sampling is what makes the same prompt give the same answer, which is
// what the golden fixtures and the authorship gate both rest on. The model's own
// modelfile asks for temperature 1, so silence here is not a neutral default.
check("and pinned the sampling", 0, plain.body.temperature);

// The window is not the budget. `clampMaxTokensToContext` in the harness asks for
// min(maxTokens, max(1, contextWindow - prompt - 4096)), so a window sized for a
// smaller card is a shorter answer if the verb's registration reads it: 5000 buys
// 824 tokens of answer on this fixture's prompt and 4096 buys 1. Neither is a
// window the server would serve either way, because /v1 drops options.num_ctx.
const narrow = await sent({ LM_CTX: "5000" });
check("a window sized for a smaller card leaves the verb's budget alone", 3000, narrow.body.max_tokens);
const tiny = await sent({ LM_CTX: "4096" });
check("and so does one under the harness's own safety margin", 3000, tiny.body.max_tokens);

// The budget is its own number on both runners, and a window sized for a smaller
// card does not overrule it.
const budgeted = await sent({ LM_MAX_TOKENS: "64" });
check("the budget is the variable's when it is set", 64, budgeted.body.max_tokens);
const both = await sent({ LM_MAX_TOKENS: "64", LM_CTX: "4096" });
check("and stays the variable's under a narrow window", 64, both.body.max_tokens);

// The chat is the half that does account against a window, so the variable still
// reaches the registration it shares with no verb.
process.env.LM_CTX = "5000";
check("the chat accounts against the window the operator set", 5000, providerConfig().models[0].contextWindow);
delete process.env.LM_CTX;
check("and against the declared one when they set nothing", 65536, providerConfig().models[0].contextWindow);

rmSync(work, { recursive: true, force: true });

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
