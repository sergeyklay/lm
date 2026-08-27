// node tests/request.mts
//
// What the runner asks the model for, read off the wire rather than off the
// source: the answer budget and the field that carries it, and the switch that
// stops this model thinking. Both are settings of the model the harness sends
// for us, so nothing in the runner's own control flow would notice their loss:
// the answer would simply grow past the budget again, on a machine with a GPU.
//
// The server answers 400, because the request is the whole subject. The run
// therefore fails, and its exit code is not what any case here asserts.

import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerb, parseArgs, unattended } from "../src/verb.mts";

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

const cwd = process.cwd();
process.chdir(work);
process.env.LM_OLLAMA = `http://127.0.0.1:${port}`;
process.env.LM_LOG = "";
try {
  await runVerb(file, [], {});
} catch {
  // A refused request is what this suite asked the server for.
}
process.chdir(cwd);
server.close();
rmSync(work, { recursive: true, force: true });

const body = bodies[0] ?? {};
check("the runner reached the completions endpoint", true, paths.some((p) => p.includes("/chat/completions")));
check("and asked for a budget", 3000, body.max_tokens);
check("under the name ollama honours", false, "max_completion_tokens" in body);
check("and asked the model not to think", "none", body.reasoning_effort);
// Greedy sampling is what makes the same prompt give the same answer, which is
// what the golden fixtures and the authorship gate both rest on. The model's own
// modelfile asks for temperature 1, so silence here is not a neutral default.
check("and pinned the sampling", 0, body.temperature);

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
