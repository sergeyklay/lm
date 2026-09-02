// node tests/chat.mts
//
// What the chat is offered. The registration is a walk over the registry
// directory, so the property under test is that nothing here knows the names:
// a fifth tool file has to be offered without a file being edited.

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerVerbs } from "../src/chat.mts";
import { initialSelection, seedThinkingLevel } from "../src/selection.mts";
import { list, meta } from "../src/registry.mts";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

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
  const names = registerVerbs({ registerTool: (t: any) => tools.push(t) }, list(dir));
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
// ever read is the pairing below: the rendered artefact and the tool's own
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
async function throughTheChat(dir: string, ui: any, printFlag = false) {
  const shown: Shown[] = [];
  const tools: any[] = [];
  registerVerbs({ registerTool: (t: any) => tools.push(t) }, list(dir), printFlag);
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

// The session with no dialog at all, which is what redirecting either stream
// gets: `throughTheChat` reads `hasUI` off whether a `ui` was passed, so passing
// none is that session. The person is the one who has to be told, so the line is
// read off stderr rather than out of the tool result, which reaches the model.
async function overStderr(run: () => Promise<{ text: string }>) {
  const was = process.stderr.write;
  let caught = "";
  (process.stderr as any).write = (s: any) => { caught += s; return true; };
  try { return { ran: await run(), caught }; }
  finally { (process.stderr as any).write = was; }
}

const NO_UI = await overStderr(() => throughTheChat(dialogTools, undefined));
check("a session with no dialog says on stderr which question it could not put",
  "lm: speaks could not ask you 'write it? [y/N]': this session is not interactive."
  + " Nothing was applied.\n", NO_UI.caught);
check("and nothing reached the side effect", "false", String(existsSync(applied)));
check("and nobody is told they declined a question that was never put to them",
  false, /Declined\./.test(NO_UI.ran.text));
check("and the model is told the question was never asked instead",
  true, /the question was never asked/.test(NO_UI.ran.text));
check("and the line the person read is not in what the model reads",
  false, /could not ask you/.test(NO_UI.ran.text));

// Typing the flag names the mode, and a diagnostic on the case the person chose
// is the noise `AGENTS.md` forbids. What the model reads does not change with it.
const TYPED = await overStderr(() => throughTheChat(dialogTools, undefined, true));
check("a session that typed -p named the mode and is told nothing", "", TYPED.caught);
check("and the model is still told the question was never asked",
  true, /the question was never asked/.test(TYPED.ran.text));
// Whatever these two did is theirs: the cases below read the same path for the
// side effect, and a leftover here would answer for them.
rmSync(applied, { force: true });

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

// ---- What the operator takes away. -----------------------------------------
// The URL `gh pr create` prints is the whole of what `lm pr` is for, and no line
// of `lm` names it: the tool never reads it back, and it reaches the operator by
// the carrier alone. `tests/pr-push.sh` pins that on the command line, where the
// stream is inherited. Here it is the other carrier, where `applyAsk` pipes the
// body's output back and the tool result is the screen, so the two cannot drift
// apart while only one of them is read. The verb is the shipped `tools/pr.sh`,
// against a throwaway repository whose only remote is a bare one beside it.

const PR_URL = "https://github.invalid/acme/widget/pull/42";
const prWork = mkdtempSync(join(tmpdir(), "lm-pr-"));
const prBin = join(prWork, "bin");
const prRepo = join(prWork, "repo");
const prOrigin = join(prWork, "origin.git");
mkdirSync(prBin, { recursive: true });
mkdirSync(prRepo, { recursive: true });
writeFileSync(join(prBin, "gh"), `#!/usr/bin/env bash\nprintf '%s\\n' '${PR_URL}'\n`);
chmodSync(join(prBin, "gh"), 0o755);

const ident = {
  GIT_AUTHOR_NAME: "lm", GIT_AUTHOR_EMAIL: "lm@example.invalid",
  GIT_COMMITTER_NAME: "lm", GIT_COMMITTER_EMAIL: "lm@example.invalid",
};
const inRepo = (...a: string[]) =>
  spawnSync("git", a, { cwd: prRepo, encoding: "utf8", env: { ...process.env, ...ident } });
spawnSync("git", ["init", "-q", "--bare", prOrigin]);
inRepo("init", "-q", "-b", "main", ".");
inRepo("remote", "add", "origin", prOrigin);
writeFileSync(join(prRepo, "f.txt"), "base\n");
inRepo("add", ".");
inRepo("commit", "-qm", "chore: seed the repository");
inRepo("push", "-q", "origin", "main");
inRepo("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
inRepo("checkout", "-q", "-b", "feat/widen");
writeFileSync(join(prRepo, "f.txt"), "base\nwidened\n");
inRepo("add", "f.txt");
inRepo("commit", "-qm", "feat: widen the file");

const prServer = createServer((req, res) => {
  req.on("data", () => {});
  req.on("end", () => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(sse("pr", JSON.stringify({
      title: "feat: widen the file",
      body: "Widens f.txt by one line so the pull request has something to describe.",
    })));
  });
});
await new Promise<void>((r) => prServer.listen(0, "127.0.0.1", r));

const prTools: any[] = [];
registerVerbs({ registerTool: (t: any) => prTools.push(t) }, list(TOOLS));
const before = { cwd: process.cwd(), path: process.env.PATH, ollama: process.env.LM_OLLAMA, log: process.env.LM_LOG };
process.chdir(prRepo);
// An installed gh is what would otherwise answer, and it would open a real pull
// request; the stub has to be what a bash spawned from here resolves.
process.env.PATH = `${prBin}:${process.env.PATH}`;
process.env.LM_OLLAMA = `http://127.0.0.1:${(prServer.address() as any).port}`;
process.env.LM_LOG = "";
let opened: any;
try {
  opened = await prTools.filter((t) => t.name === "pr")[0].execute("id", {}, undefined, undefined, {
    hasUI: true,
    ui: { confirm: async () => true, input: async () => undefined },
  });
} finally {
  process.chdir(before.cwd);
  process.env.PATH = before.path!;
  if (before.ollama === undefined) delete process.env.LM_OLLAMA; else process.env.LM_OLLAMA = before.ollama;
  if (before.log === undefined) delete process.env.LM_LOG; else process.env.LM_LOG = before.log;
  prServer.close();
}

const handedBack = (opened.content[0].text as string).trimEnd().split("\n");
check("the pull request's URL is the last thing the chat hands back",
  PR_URL, handedBack[handedBack.length - 1]);
rmSync(prWork, { recursive: true, force: true });

// ---- Which caller the record names. ----------------------------------------
// The two callers write the same fields, so a verb the chat ran for the operator
// reads back as one he ran himself. Each side is entered the way it is entered in
// earnest: `bin/lm` as a process of its own, and the registration above. The
// fixture refuses in `collect`, so neither side reaches a model.

const callerWork = mkdtempSync(join(tmpdir(), "lm-caller-"));
const callerTools = join(callerWork, "tools");
const callerLog = join(callerWork, "log.jsonl");
mkdirSync(callerTools, { recursive: true });
writeFileSync(join(callerTools, "refuses.sh"), [
  'name="refuses"', 'description="refuses before it reaches the model"',
  'collect() { echo "lm: nothing to work on" >&2; return 3; }',
  `schema() { echo '{"type":"object"}'; }`,
  "validate() { cat >/dev/null; }",
  "render() { cat; }",
  "",
].join("\n"));
writeFileSync(join(callerTools, "flow.sh"), [
  'name="flow"', 'description="runs the refusing verb and nothing beside it"',
  'verbs="refuses"', "",
].join("\n"));

const logged = () => readFileSync(callerLog, "utf8").trim().split("\n").map((l) => JSON.parse(l));

async function ranByTheChat(name: string) {
  const tools: any[] = [];
  registerVerbs({ registerTool: (t: any) => tools.push(t) }, list(callerTools));
  const was = { cwd: process.cwd(), log: process.env.LM_LOG };
  process.chdir(callerWork);
  process.env.LM_LOG = callerLog;
  try {
    await tools.filter((t) => t.name === name)[0].execute("id", {}, undefined, undefined, { hasUI: false });
  } finally {
    process.chdir(was.cwd);
    if (was.log === undefined) delete process.env.LM_LOG; else process.env.LM_LOG = was.log;
  }
}

spawnSync(join(ROOT, "bin/lm"), ["refuses"], { encoding: "utf8", cwd: callerWork,
  env: { ...process.env, LM_TOOLS: callerTools, LM_LOG: callerLog } });
await ranByTheChat("refuses");
const [typed, chatted] = logged();
check("a verb the operator typed names the command line", "cli", typed.caller);
check("and the same verb the chat ran names the chat", "chat", chatted.caller);
// Without the field these two records are one, so the case reads the whole record
// rather than the field: a run's timestamp and its wall clock are its own.
const perRun = ["ts", "ms"];
check("and nothing else in the record tells the two apart", ["caller"],
  Object.keys(typed).filter((k) => !perRun.includes(k)
    && JSON.stringify(typed[k]) !== JSON.stringify(chatted[k])));

// A delivery is where the tag already said something about its caller, and said it
// in a shape nothing parses. Both fields reach every verb a workflow runs.
await ranByTheChat("flow");
const fromWorkflow = logged().slice(-1)[0];
check("a verb a workflow ran for the chat names the chat too", "chat", fromWorkflow.caller);
check("beside the workflow it belonged to", true, /^flow-[0-9]+-[0-9]+$/.test(fromWorkflow.workflow));

// The set is the code's and not the caller's: a name it does not hold would put a
// value in the log that `lm stats` has no way to group by.
spawnSync(join(ROOT, "bin/lm"), ["refuses"], { encoding: "utf8", cwd: callerWork,
  env: { ...process.env, LM_TOOLS: callerTools, LM_LOG: callerLog, LM_CALLER: "scheduler" } });
check("a name outside the set is not a caller", "cli", logged().slice(-1)[0].caller);

rmSync(callerWork, { recursive: true, force: true });

// What the chat opens on. The chat remembers the model it was last on, and the
// harness reads that memory for itself when no --model is handed to it, so
// handing one over would overrule the memory on every launch. `LM_MODEL` names
// the verb's model and is the one way to aim a single launch elsewhere, so it is
// handed over whenever it is set.
const agentDir = mkdtempSync(join(tmpdir(), "lm-agent-"));
const settingsAt = (settings: Record<string, unknown>) => {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));
  return SettingsManager.create(process.cwd(), agentDir);
};

const REMEMBERED = { defaultProvider: "ollama", defaultModel: "gpt-oss:20b" };
process.env.LM_MODEL = "phi3:mini";
check("with nothing remembered the chat opens on LM_MODEL",
  ["--provider", "ollama", "--model", "phi3:mini"],
  initialSelection(settingsAt({})));
check("and LM_MODEL set in the environment wins over what is remembered",
  ["--provider", "ollama", "--model", "phi3:mini"],
  initialSelection(settingsAt(REMEMBERED)));
check("and half a remembered choice is no choice",
  ["--provider", "ollama", "--model", "phi3:mini"],
  initialSelection(settingsAt({ defaultModel: "gpt-oss:20b" })));
delete process.env.LM_MODEL;
check("unset, a remembered model is left to the harness to read",
  [],
  initialSelection(settingsAt(REMEMBERED)));
check("with neither, the model this project ships with opens it",
  ["--provider", "ollama", "--model", "qwen3.8:27b"],
  initialSelection(settingsAt({})));

// The thinking level a model with nothing remembered opens at. The flag has no
// gate to put it behind: `--thinking` beats the harness's global default and the
// per-model level alike, and `bin/lm` has resolved no model yet, so it cannot
// know which per-model entry a launch would land on. The level is seeded into
// the harness's own settings instead, where the level remembered for a model
// outranks it. What it does to the request is `tests/chat-request.mts`.
const savedLevel = () => JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).defaultThinkingLevel;

check("no launch hands the harness a thinking level", false,
  initialSelection(settingsAt({})).includes("--thinking"));
// The settings file is written off a queue, so what reaches disk is read after
// the flush the harness's own launch gets from the work it does next.
const seeded = settingsAt({});
seedThinkingLevel(seeded);
await seeded.flush();
check("the level a model with nothing remembered opens at is seeded instead", "low", savedLevel());
const chosen = settingsAt({ defaultThinkingLevel: "high" });
seedThinkingLevel(chosen);
await chosen.flush();
check("and a level the operator saved is left alone", "high", savedLevel());
rmSync(agentDir, { recursive: true, force: true });

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
