// node tests/chat.mts
//
// What the chat is offered. The registration is a walk over the registry
// directory, so the property under test is that nothing here knows the names:
// a fifth tool file has to be offered without a file being edited.

import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerVerbs } from "../src/chat.mts";
import { list, meta } from "../src/registry.mts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const TOOLS = join(ROOT, "tools");
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

function collect(dir: string) {
  const tools: any[] = [];
  const names = registerVerbs({ registerTool: (t: any) => tools.push(t) }, dir);
  return { tools, names };
}

const repo = collect(TOOLS);
check("every tool file in the registry is offered to the chat",
  list(TOOLS).map((f) => meta(f).name), repo.names);
check("and each is offered under its own name",
  repo.names, repo.tools.map((t) => t.name));
check("with the description the router already uses",
  list(TOOLS).map((f) => meta(f).description), repo.tools.map((t) => t.description));
check("and the same one in the system prompt's tool list",
  repo.tools.map((t) => t.description), repo.tools.map((t) => t.promptSnippet));

// The chat's model supplies what a human types and nothing else: the verb still
// writes its own prompt and asks the model itself.
const params = repo.tools[0].parameters;
check("a verb takes the arguments a human takes", ["text", "dry_run"], Object.keys(params.properties));
check("and no field of its own answer", "undefined", String(params.required));

const work = mkdtempSync(join(tmpdir(), "lm-chat-"));
writeFileSync(join(work, "fifth.sh"), [
  'name="fifth"',
  'description="a tool nobody edited a file for"',
  "collect() { echo hi; }",
  "schema() { echo '{}'; }",
  "validate() { cat >/dev/null; }",
  "render() { cat; }",
  "",
].join("\n"));
check("a tool file dropped into the registry is offered too", ["fifth"], collect(work).names);
rmSync(work, { recursive: true, force: true });

// ---- The dialog a person actually answers. ---------------------------------
// `tests/registry.mts` hands `applyAsk` an Ask of its own and never enters
// `src/chat.mts`, and the live case runs in print mode where `hasUI` is false,
// so the refusal there is the runner's rather than a person's. What no case had
// ever read is the composition below: the rendered artefact and the tool's own
// question, joined, because the human is approving something the chat has not
// shown them yet.

// The model is a recording server: the subject is the dialog, and a real answer
// would make this suite need a GPU to assert a string the model never sees.
function sse(name: string, args: string) {
  const base = { id: "1", object: "chat.completion.chunk", created: 0, model: "m" };
  const mk = (d: any, fr: any = null) =>
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: d, finish_reason: fr }] })}\n\n`;
  return mk({ role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: "" } }] })
    + mk({ tool_calls: [{ index: 0, function: { arguments: args } }] })
    + mk({}, "tool_calls") + "data: [DONE]\n\n";
}

const dialogWork = mkdtempSync(join(tmpdir(), "lm-dialog-"));
const dialogTools = join(dialogWork, "tools");
mkdirSync(dialogTools, { recursive: true });

const body = (apply: string) => [
  'name="speaks"', 'description="asks before it writes"',
  'collect() { echo "say something"; }',
  `schema() { echo '{"type":"object","properties":{"a":{"type":"string"}},"required":["a"]}'; }`,
  "validate() { cat >/dev/null; }",
  "render() { jq -r .a; }",
  apply, "",
].join("\n");

writeFileSync(join(dialogTools, "speaks.sh"),
  body('apply() { local j; j=$(cat); confirm "write it? [y/N]"; printf %s "$j" > applied.txt; }'));

const server = createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(sse("speaks", JSON.stringify({ a: "one line of answer" })));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

type Shown = { label: string; message: string };
// The chat is entered through the registration, not around it: a case that
// called runVerb directly would leave every line of src/chat.mts unrun.
async function throughTheChat(dir: string, ui: any) {
  const shown: Shown[] = [];
  const tools: any[] = [];
  registerVerbs({ registerTool: (t: any) => tools.push(t) }, dir);
  const ctx = {
    hasUI: ui !== undefined,
    ui: {
      confirm: (label: string, message: string) => { shown.push({ label, message }); return ui.confirm(); },
      input: (label: string, message: string) => { shown.push({ label, message }); return ui.input(); },
    },
  };
  const was = { cwd: process.cwd(), ollama: process.env.LM_OLLAMA, log: process.env.LM_LOG };
  process.chdir(dialogWork);
  process.env.LM_OLLAMA = `http://127.0.0.1:${(server.address() as any).port}`;
  // One log spans every repository, so a fixture run has to opt out of it.
  process.env.LM_LOG = "";
  try {
    const r = await tools[0].execute("id", {}, undefined, undefined, ctx);
    return { shown, text: r.content[0].text as string };
  } finally {
    process.chdir(was.cwd);
    if (was.ollama === undefined) delete process.env.LM_OLLAMA; else process.env.LM_OLLAMA = was.ollama;
    if (was.log === undefined) delete process.env.LM_LOG; else process.env.LM_LOG = was.log;
  }
}

const applied = join(dialogWork, "applied.txt");

const yes = await throughTheChat(dialogTools, { confirm: async () => true });
check("an approved dialog reaches the side effect", "true", String(existsSync(applied)));
check("and the tool committed the answer it rendered",
  '{"a":"one line of answer"}', existsSync(applied) ? readFileSync(applied, "utf8") : "");
check("the dialog is labelled with the verb", ["speaks"], yes.shown.map((s) => s.label));
check("and the human is shown the rendered artefact above the tool's own question",
  ["one line of answer\n\nwrite it? [y/N]"], yes.shown.map((s) => s.message));
check("an approved run says nothing about declining", "one line of answer", yes.text.trim());
rmSync(applied, { force: true });

const no = await throughTheChat(dialogTools, { confirm: async () => false });
check("a declined dialog leaves no side effect", "false", String(existsSync(applied)));
check("and the human read the artefact before declining it, not only before approving",
  ["one line of answer\n\nwrite it? [y/N]"], no.shown.map((s) => s.message));
check("and the chat reports the refusal in words, having no exit status",
  true, /Declined\. Nothing was applied\./.test(no.text));

// A body that asks twice and is refused on the first must receive no answer to
// the second. The channel tolerates being answered after it closes, so a
// swallowed write would look exactly like this from the exit code alone.
writeFileSync(join(dialogTools, "speaks.sh"),
  body('apply() { local j labels; j=$(cat); labels=$(ask "Labels?");'
     + ' confirm "write it? [y/N]"; printf "%s|%s" "$j" "$labels" > applied.txt; }'));

const shut = await throughTheChat(dialogTools, { input: async () => undefined, confirm: async () => true });
check("a dialog the human closed decides nothing", "false", String(existsSync(applied)));
check("and the second question is never put to them",
  ["Labels?"], shut.shown.map((s) => s.message));
check("and the chat reports that refusal too", true, /Declined\. Nothing was applied\./.test(shut.text));

server.close();
rmSync(dialogWork, { recursive: true, force: true });

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
